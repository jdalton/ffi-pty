import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { setImmediate as turn, setTimeout as delay } from 'node:timers/promises'
import { PassThrough } from 'node:stream'
import { test, vi } from 'vitest'
import { dlopen } from 'node:ffi'
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnPty } from '../../src/pty.mts'
import { normalizeSpawnOptions } from '../../src/validation.mts'
import {
  createUnixBackend,
  waitForOutputDrain,
  type UnixBindings,
} from '../../src/unix-common.mts'

const require = createRequire(import.meta.url)

test(
  'queued and late writes cannot reach a file reusing an exited PTY descriptor (#987)',
  { skip: process.platform === 'win32', timeout: 10_000 },
  async () => {
    const bindings: UnixBindings =
      process.platform === 'darwin'
        ? { ...require('../../src/darwin/darwin.mts'), closeFd: closeSync }
        : require('../../src/linux/linux.mts').createLinuxBindings()
    const native = dlopen(
      process.platform === 'darwin'
        ? '/usr/lib/libSystem.B.dylib'
        : 'libc.so.6',
      {
        dup2: { arguments: ['int32', 'int32'], return: 'int32' },
      },
    ).functions
    const dir = mkdtempSync(join(tmpdir(), 'ffi-pty-reuse-'))
    const path = join(dir, 'sentinel')
    let master = -1
    const backend = createUnixBackend(
      normalizeSpawnOptions(process.execPath, [
        '-e',
        "process.stdin.setRawMode(true); process.stdin.pause(); console.log('READY'); setInterval(()=>{},1000)",
      ]),
      {
        ...bindings,
        spawn(options) {
          const child = bindings.spawn(options)
          master = child.masterFd
          return child
        },
      },
    )
    let replacement = -1
    try {
      await new Promise<void>(resolve =>
        backend.readable.on('data', chunk => {
          if (chunk.includes('READY')) resolve()
        }),
      )
      const writing = backend.write(Buffer.alloc(7 * 1024 * 1024, 120)).then(
        () => false,
        () => true,
      )
      await delay(20)
      await backend.kill('SIGKILL')
      await backend.exited
      const file = openSync(path, 'w+')
      if (file !== master) {
        assert.equal(native.dup2(file, master), master)
        closeSync(file)
      }
      replacement = master
      await assert.rejects(
        backend.write(Buffer.from('late input')),
        /closed|exited/i,
      )
      assert.equal(await writing, true)
      await backend.close()
      assert.equal(readFileSync(path).length, 0)
    } finally {
      await backend.close()
      if (replacement >= 0) closeSync(replacement)
      rmSync(dir, { recursive: true, force: true })
    }
  },
)

test(
  'closing a PTY cancels a large write when the child is not reading',
  { timeout: 10_000, skip: process.platform === 'win32' },
  async () => {
    const code =
      "setInterval(() => {}, 1000); process.stdin.setRawMode(true); process.stdin.pause(); console.log('STALL_READY');"
    const pty = await spawnPty(process.execPath, ['-e', code])
    let ready!: () => void
    const readySeen = new Promise<void>(resolve => (ready = resolve))
    const data = pty.onData(chunk => {
      if (chunk.includes('STALL_READY')) ready()
    })
    let writeDone = false
    let writeError: unknown
    try {
      await readySeen
      const write = pty.write(Buffer.alloc(7 * 1024 * 1024, 120)).then(
        () => {
          writeDone = true
        },
        (error: unknown) => {
          writeDone = true
          writeError = error
        },
      )
      await delay(50)
      assert.equal(writeDone, false, "the child's input queue should be full")
      // Prove timers run while the write is blocked, before a fast close can
      // complete in the same turn as its scheduling.
      await delay(0)
      assert.equal(
        writeDone,
        false,
        'the event loop advances during a blocked write',
      )
      await pty.close()
      const status = await pty.exited
      await write
      assert.ok(writeError instanceof Error, 'close rejects the pending write')
      assert.notEqual(status.signal, 0, 'close terminates the stalled child')
    } finally {
      data.dispose()
      await pty.close()
    }
  },
)

test('paused output does not consume the post-exit drain timeout', async () => {
  const readable = new PassThrough()
  let received = ''
  let settled = false
  readable.on('data', (chunk: Buffer) => (received += chunk.toString()))
  readable.pause()
  const drained = waitForOutputDrain(readable, 25).then(result => {
    settled = true
    return result
  })
  await delay(60)
  assert.equal(settled, false, 'the paused interval does not expire the budget')
  readable.resume()
  readable.end(Buffer.from('pending'))
  assert.equal(await drained, true)
  assert.equal(received, 'pending')
  for (const event of ['resume', 'pause', 'end', 'close']) {
    assert.equal(
      readable.listenerCount(event),
      0,
      `${event} listener is removed`,
    )
  }
})

test('resuming restarts the remaining drain budget', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'Date'], now: 1000 })
  const readable = new PassThrough()
  readable.on('data', () => {})
  let settled = false
  const drained = waitForOutputDrain(readable, 80).then(result => {
    settled = true
    return result
  })
  await turn()
  vi.advanceTimersByTime(25)
  readable.pause()
  vi.advanceTimersByTime(100)
  assert.equal(settled, false, 'the paused interval does not expire the budget')
  readable.resume()
  await turn()
  vi.advanceTimersByTime(54)
  await Promise.resolve()
  assert.equal(settled, false, '54ms does not exhaust the remaining 55ms')
  vi.advanceTimersByTime(1)
  vi.useRealTimers()
  assert.equal(
    await drained,
    false,
    'a flowing stream expires after its remaining budget',
  )
  for (const event of ['resume', 'pause', 'end', 'close']) {
    assert.equal(
      readable.listenerCount(event),
      0,
      `${event} listener is removed`,
    )
  }
  readable.destroy()
})

test('unconsumed output still has a bounded drain deadline', async () => {
  const readable = new PassThrough()
  assert.equal(await waitForOutputDrain(readable, 25), false)
  readable.destroy()
})

test(
  'backend close resumes output while paused and remains bounded',
  { timeout: 5000, skip: process.platform === 'win32' },
  async () => {
    const code =
      "process.stdout.write('READY\\n'); setInterval(() => {}, 1000);"
    const input = normalizeSpawnOptions(process.execPath, ['-e', code])
    const backendFile =
      process.platform === 'darwin' ? 'darwin/darwin.mts' : 'linux/linux.mts'
    const backendModule = require(`../../src/${backendFile}`) as {
      createBackend(options: typeof input): Promise<{
        pid: number
        readable: PassThrough
        close(): Promise<void>
        exited: Promise<{ exitCode: number | null; signal: number }>
      }>
    }
    const backend = await backendModule.createBackend(input)
    let ready!: () => void
    const readySeen = new Promise<void>(resolve => (ready = resolve))
    backend.readable.on('data', (chunk: Buffer) => {
      if (chunk.includes('READY')) {
        backend.readable.pause()
        ready()
      }
    })
    try {
      await readySeen
      await Promise.race([
        backend.close(),
        delay(3000).then(() => {
          throw new Error('close did not finish while output was paused')
        }),
      ])
      assert.notEqual((await backend.exited).signal, 0)
    } finally {
      await backend.close()
    }
  },
)

for (const code of ['EINTR', 'EAGAIN', 'EWOULDBLOCK', 'ZERO', 'EPIPE']) {
  test(`Unix writes ${code === 'EPIPE' ? 'reject' : 'retry'} ${code} without dropping bytes`, async () => {
    const source = new PassThrough()
    let finished = false
    let attempts = 0
    let written = ''
    const backend = createUnixBackend(
      normalizeSpawnOptions(process.execPath, []),
      {
        spawn: () => ({ pid: 42, masterFd: 99, slaveName: 'fake' }),
        wait: () => (finished ? { exitCode: 0, signal: 0 } : null),
        kill: () => {
          finished = true
          source.end()
        },
        resize: async () => {},
        closeFd: () => {},
      },
      {
        initialize: () => {},
        read: () => source,
        write(_fd, bytes, offset, length) {
          if (++attempts === 1) {
            if (code === 'ZERO') return 0
            throw Object.assign(new Error(code), { code })
          }
          written += bytes.subarray(offset, offset + length).toString()
          return length
        },
      },
    )
    try {
      if (code === 'EPIPE') {
        await assert.rejects(backend.write(Buffer.from('hello')), /EPIPE/)
        await backend.write(Buffer.from('after error'))
        assert.equal(written, 'after error')
      } else {
        await backend.write(Buffer.from('hello'))
        assert.equal(written, 'hello')
      }
      assert.equal(attempts, 2)
    } finally {
      await backend.close()
    }
  })
}

for (const failure of ['initialize', 'read']) {
  test(`Unix ${failure} failure closes the master and reaps the child even when cleanup throws`, async () => {
    const closed: number[] = []
    const signals: string[] = []
    let waited = false
    assert.throws(
      () =>
        createUnixBackend(
          normalizeSpawnOptions(process.execPath, []),
          {
            spawn: () => ({ pid: 42, masterFd: 99, slaveName: 'fake' }),
            wait: () => {
              waited = true
              return { exitCode: 1, signal: 0 }
            },
            kill(_pid, signal) {
              signals.push(signal)
              throw new Error('already exited')
            },
            resize: async () => {},
            closeFd(fd) {
              closed.push(fd)
              throw new Error('already closed')
            },
          },
          {
            initialize() {
              if (failure === 'initialize') throw new Error('initialize failed')
            },
            read() {
              throw new Error('read failed')
            },
            write: () => 0,
          },
        ),
      new RegExp(`${failure} failed`),
    )
    await delay(0)
    assert.deepEqual(closed, [99])
    assert.deepEqual(signals, ['SIGTERM'])
    assert.equal(waited, true)
  })
}

for (const failure of [
  'wait-error',
  'wait-string',
  'EIO',
  'EACCES',
  'escalate',
]) {
  test(`Unix backend handles ${failure} and closes its stream`, async () => {
    const source = new PassThrough()
    let finished = false
    const signals: string[] = []
    const backend = createUnixBackend(
      normalizeSpawnOptions(process.execPath, []),
      {
        spawn: () => ({ pid: 42, masterFd: 99, slaveName: 'fake' }),
        wait() {
          if (failure === 'wait-error') throw new Error('wait failed')
          if (failure === 'wait-string') throw 'wait failed'
          return finished ? { exitCode: 0, signal: 0 } : null
        },
        kill(_pid, signal) {
          signals.push(signal)
          if (failure === 'escalate' && signal === 'SIGTERM') {
            throw new Error('denied')
          }
          finished = true
          source.end()
          if (failure === 'escalate') throw new Error('already exited')
        },
        resize: async () => {},
        closeFd: () => {},
      },
      { initialize: () => {}, read: () => source, write: () => 0 },
    )
    const errors: string[] = []
    backend.readable.on('error', error => errors.push(error.message))
    backend.readable.resume()
    if (failure.startsWith('wait-')) {
      await assert.rejects(backend.exited, /wait failed/)
    } else if (failure !== 'escalate') {
      source.emit('error', Object.assign(new Error(failure), { code: failure }))
      finished = true
      await backend.exited
      assert.deepEqual(errors, failure === 'EIO' ? [] : ['EACCES'])
    }
    await backend.close()
    assert.equal(source.destroyed, true)
    await assert.rejects(backend.resize(80, 24), /closed/)
    await backend.kill()
    if (failure === 'escalate') {
      assert.deepEqual(signals, ['SIGTERM', 'SIGKILL'])
    }
  })
}

test('failed stream initialization escalates to SIGKILL and reaps an unresponsive child', async () => {
  const signals: string[] = []
  let pollsAfterKill = 0
  let reaped = false
  assert.throws(
    () =>
      createUnixBackend(
        normalizeSpawnOptions(process.execPath, []),
        {
          spawn: () => ({ pid: 42, masterFd: 99, slaveName: 'fake' }),
          wait() {
            if (signals.includes('SIGKILL') && ++pollsAfterKill > 1) {
              reaped = true
              return { exitCode: null, signal: 9 }
            }
            return null
          },
          kill(_pid, signal) {
            signals.push(signal)
            if (signal === 'SIGKILL') throw new Error('already exiting')
          },
          closeFd: () => {},
          resize: async () => {},
        },
        {
          initialize() {
            throw new Error('poll failed')
          },
          read: () => new PassThrough(),
          write: () => 0,
        },
      ),
    /poll failed/,
  )
  for (let count = 0; count < 100 && !reaped; count++) await delay(20)
  assert.equal(reaped, true)
  assert.deepEqual(signals, ['SIGTERM', 'SIGKILL'])
})

test('post-exit drain deadline closes inherited output and rejects input and resize during drain', async () => {
  const source = new PassThrough()
  const backend = createUnixBackend(
    normalizeSpawnOptions(process.execPath, []),
    {
      spawn: () => ({ pid: 42, masterFd: 99, slaveName: 'fake' }),
      wait: () => ({ exitCode: 0, signal: 0 }),
      kill: () => assert.fail('reaped child must not be signalled'),
      closeFd: () => {},
      resize: async () => assert.fail('reaped child must not resize'),
    },
    {
      initialize: () => {},
      read: () => source,
      write: () => assert.fail('reaped child must not receive input'),
    },
  )
  await assert.rejects(backend.write(Buffer.from('late')), /exited/)
  await assert.rejects(backend.resize(80, 24), /exited/)
  await backend.kill()
  assert.deepEqual(await backend.exited, { exitCode: 0, signal: 0 })
  assert.equal(source.destroyed, true)
  await backend.close()
})

test('output backpressure pauses the native stream and resumes without dropping buffered bytes', async () => {
  const source = new PassThrough()
  let finished = false
  const backend = createUnixBackend(
    normalizeSpawnOptions(process.execPath, []),
    {
      spawn: () => ({ pid: 42, masterFd: 99, slaveName: 'fake' }),
      wait: () => (finished ? { exitCode: 0, signal: 0 } : null),
      kill: () => {
        finished = true
        source.end()
      },
      closeFd: () => {},
      resize: async () => {},
    },
    { initialize: () => {}, read: () => source, write: () => 0 },
  )
  const bytes = Buffer.alloc(256 * 1024, 120)
  source.write(bytes)
  assert.equal(source.isPaused(), true)
  let count = 0
  backend.readable.on('data', chunk => {
    count += chunk.length
  })
  source.end()
  finished = true
  await backend.exited
  assert.equal(count, bytes.length)
  await backend.close()
})

test('in-flight writes reject when the child is reaped before output has drained', async () => {
  const source = new PassThrough()
  let writing = false
  const backend = createUnixBackend(
    normalizeSpawnOptions(process.execPath, []),
    {
      spawn: () => ({ pid: 42, masterFd: 99, slaveName: 'fake' }),
      wait: () => (writing ? { exitCode: 0, signal: 0 } : null),
      kill: () => assert.fail('already reaped'),
      closeFd: () => {},
      resize: async () => {},
    },
    {
      initialize: () => {},
      read: () => source,
      write: () => {
        writing = true
        return 0
      },
    },
  )
  try {
    await assert.rejects(backend.write(Buffer.from('pending')), /exited/)
  } finally {
    source.end()
    await backend.close()
  }
})
