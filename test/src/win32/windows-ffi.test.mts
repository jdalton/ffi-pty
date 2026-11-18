import { createRequire } from 'node:module'
import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { createConnection, type Socket } from 'node:net'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'vitest'
import {
  ffiWorkerOptions,
  createKillOnCloseJob,
  createFfiTransport,
  rehydrateWindowsStart,
} from '../../../src/win32/windows-ffi.mts'
import type { WindowsStart } from '../../../src/win32/windows-launch.mts'
import type { SpawnOptions } from '../../../src/contract.mts'
import type { BrokerReply } from '../../../src/win32/windows-protocol.mts'
import {
  classifyWindowsVersion,
  detectWindowsVersion,
} from '../../../src/win32/windows-version.mts'

const require = createRequire(import.meta.url)

const modern =
  process.platform === 'win32' &&
  classifyWindowsVersion(detectWindowsVersion()) === 'ffi'

test('FFI worker does not replay host preloads or inherit NODE_OPTIONS (#974)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ffi-pty-preload-'))
  try {
    const preload = join(dir, 'preload.cjs')
    writeFileSync(
      preload,
      `if (!require('node:worker_threads').isMainThread) throw new Error('host preload ran in worker')`,
    )
    const moduleUrl = new URL(
      '../../../src/win32/windows-ffi.mts',
      import.meta.url,
    ).href
    const source = `
      const { Worker } = require('node:worker_threads');
      const { fileURLToPath } = require('node:url');
      const { ffiWorkerOptions } = require(fileURLToPath(${JSON.stringify(moduleUrl)}));
      const options = ffiWorkerOptions(42n);
      const worker = new Worker(
        "require('node:worker_threads').parentPort.postMessage({args:process.execArgv, options:process.env.NODE_OPTIONS, job:require('node:worker_threads').workerData.jobHandle.toString()})",
        {...options, eval:true}
      );
      worker.on('message', value => console.log(JSON.stringify(value)));
      worker.on('error', error => { console.error(error); process.exitCode=1 });
    `
    const result = execFileSync(
      process.execPath,
      ['--experimental-ffi', '--require', preload, '-e', source],
      {
        env: {
          ...process.env,
          NODE_OPTIONS: `--require ${JSON.stringify(preload)}`,
        },
        encoding: 'utf8',
        timeout: 10_000,
      },
    )
    assert.deepEqual(JSON.parse(result), {
      args: ['--experimental-ffi'],
      job: '42',
    })
    assert.equal(
      ffiWorkerOptions(42n, undefined, {
        SystemRoot: 'C:\\Windows',
        NODE_OPTIONS: '--inspect',
      }).env?.SystemRoot,
      'C:\\Windows',
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('direct transport factory refuses non-Windows systems before loading kernel32', () => {
  if (process.platform === 'win32') return
  assert.throws(() => createFfiTransport(), /requires Windows/)
})

test('rehydrates structured-cloned launch bytes into Buffers before Win32 FFI', () => {
  const start = {
    cols: 80,
    rows: 24,
    application: Uint8Array.from([65, 0]),
    commandLine: Uint8Array.from([66, 0]),
    cwd: Uint8Array.from([67, 0]),
    environment: Uint8Array.from([0, 0]),
    inputName: 'in',
    outputName: 'out',
  } as unknown as WindowsStart
  const result = rehydrateWindowsStart(start)
  for (const field of [
    'application',
    'commandLine',
    'cwd',
    'environment',
  ] as const) {
    assert.ok(Buffer.isBuffer(result[field]))
    assert.deepEqual([...result[field]], [...start[field]])
  }
})

test('main thread creates and configures its kill-on-close job', () => {
  let configured: Buffer | undefined
  let closed = false
  const native = {
    CreateJobObjectW: () => 42n,
    SetInformationJobObject: (_job: bigint, _class: number, info: Buffer) => {
      configured = info
      return 1
    },
    CloseHandle: () => {
      closed = true
      return 1
    },
  }
  assert.equal(createKillOnCloseJob(native as never), 42n)
  assert.equal(configured?.length, 144)
  assert.equal(configured?.readUInt32LE(16), 0x00_00_20_00)
  assert.equal(closed, false)
})

test(
  'direct FFI starts in this process and keeps the event loop responsive',
  { skip: !modern, timeout: 30_000 },
  async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ffi-pty-direct-'))
    const report = join(dir, 'child.json')
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    )
    const options: SpawnOptions = {
      file: process.execPath,
      args: [
        '-e',
        `require('node:fs').writeFileSync(${JSON.stringify(report)}, JSON.stringify({pid:process.pid,ppid:process.ppid})); setInterval(()=>{},1000)`,
      ],
      cwd: process.cwd(),
      env,
      cols: 80,
      rows: 24,
    }
    const transport = createFfiTransport()
    const sockets: Socket[] = []
    let serial = 0
    const replies: BrokerReply[] = []
    transport.onMessage(reply => {
      replies.push(reply)
      if (reply.type === 'pipes') {
        for (const path of [reply.input, reply.output]) {
          const socket = createConnection(path)
          sockets.push(socket)
        }
        void Promise.all(
          sockets.map(
            socket =>
              new Promise<void>((resolve, reject) => {
                socket.once('connect', resolve)
                socket.once('error', reject)
              }),
          ),
        ).then(() => transport.send({ type: 'connected' }))
      }
    })
    try {
      await transport.ready
      await transport.send({ type: 'start', options })
      const deadline = Date.now() + 5000
      let child: { pid: number; ppid: number } | undefined
      while (Date.now() < deadline) {
        try {
          child = JSON.parse(readFileSync(report, 'utf8')) as {
            pid: number
            ppid: number
          }
          break
        } catch {
          await delay(10)
        }
      }
      assert.ok(child, 'target did not write its process report')
      assert.equal(
        child.ppid,
        process.pid,
        'CreateProcess should spawn directly from this process',
      )
      let heartbeat = 0
      const timer = setInterval(() => heartbeat++, 10)
      await delay(100)
      clearInterval(timer)
      assert.ok(
        heartbeat >= 5,
        `event loop heartbeat only advanced ${heartbeat} times`,
      )
      await transport.send({ type: 'command', id: ++serial, command: 'close' })
      await transport.closed
      assert.ok(replies.some(reply => reply.type === 'exited'))
    } finally {
      await transport.terminate()
      await Promise.all(
        sockets.map(
          socket =>
            new Promise<void>(resolve => {
              if (socket.closed) return resolve()
              socket.once('close', resolve)
              socket.destroy()
            }),
        ),
      )
      rmSync(dir, { recursive: true, force: true })
    }
  },
)

export function transportFixture() {
  const { EventEmitter } = require('node:events')
  const { FfiTransport } = require('../../../src/win32/windows-ffi.mts')
  const worker = new EventEmitter()
  const sent: unknown[] = []
  const closed: bigint[] = []
  const errors: Error[] = []
  worker.postMessage = (value: unknown) => sent.push(value)
  const native = {
    OpenThread: () => 9n,
    CloseHandle: (handle: bigint) => {
      closed.push(handle)
      return 1
    },
    TerminateJobObject: () => 1,
    CancelSynchronousIo: () => 1,
    GetLastError: () => 5,
  }
  const transport = new FfiTransport(7n, undefined, native, () => worker)
  transport.onError((error: Error) => errors.push(error))
  return { transport, worker, native, sent, closed, errors }
}

test('FFI transport forwards replies, isolates listener failures, and closes handles once after normal exit', async () => {
  const f = transportFixture()
  const replies: BrokerReply[] = []
  const remove = f.transport.onMessage((reply: BrokerReply) =>
    replies.push(reply),
  )
  f.transport.onMessage(() => {
    throw new Error('observer failed')
  })
  f.transport.onError(() => {
    throw new Error('error observer failed')
  })
  f.worker.emit('message', { kind: 'threadId', threadId: 42 })
  f.worker.emit('message', { kind: 'threadId', threadId: 42 })
  await f.transport.send({ type: 'connected' })
  f.worker.emit('message', { kind: 'reply', reply: { type: 'brokerDone' } })
  remove()
  f.worker.emit('message', { kind: 'error', error: 'worker failure' })
  f.worker.emit('error', new Error('worker event'))
  f.worker.emit('exit', 0)
  await f.transport.closed
  await f.transport.terminate()
  assert.deepEqual(f.closed, [9n, 7n])
  assert.deepEqual(replies, [{ type: 'brokerDone' }])
  assert.deepEqual(f.sent, [{ type: 'connected' }])
  assert.deepEqual(
    f.errors.map(error => error.message),
    ['observer failed', 'worker failure', 'worker event'],
  )
  await assert.rejects(f.transport.send({ type: 'connected' }), /closed/)
})

for (const code of [0, 2]) {
  test(`FFI transport reports unexpected worker exit ${code} without a completion reply`, async () => {
    const f = transportFixture()
    f.worker.emit('exit', code)
    await f.transport.closed
    assert.ok(f.errors.some(error => /before brokerDone/.test(error.message)))
    assert.equal(
      f.errors.some(error => /exited with code/.test(error.message)),
      code !== 0,
    )
  })
}

for (const failure of [
  'post',
  'terminate',
  'open',
  'cancel',
  'close',
  'cancel-not-found',
  'cancel-error',
]) {
  test(`FFI transport bounds cleanup and preserves errors when ${failure} fails`, async () => {
    const f = transportFixture()
    const fail = () => {
      throw new Error(failure)
    }
    if (failure === 'post') f.worker.postMessage = fail
    if (failure === 'terminate') f.native.TerminateJobObject = fail
    if (failure === 'open') f.native.OpenThread = fail
    if (failure === 'cancel') f.native.CancelSynchronousIo = fail
    if (failure === 'close') f.native.CloseHandle = fail
    if (failure.startsWith('cancel-')) {
      f.native.CancelSynchronousIo = () => 0
      f.native.GetLastError = () => (failure === 'cancel-not-found' ? 1168 : 5)
    }
    try {
      if (failure === 'post') {
        await assert.rejects(f.transport.send({ type: 'connected' }), /post/)
      }
      await f.transport.send({ type: 'abort', error: 'stop requested' })
      f.worker.emit('message', { kind: 'threadId', threadId: 42 })
      f.transport.requestAbort(new Error('duplicate abort'))
      f.transport.terminateJob()
      f.transport.cancelSynchronousIo()
      await assert.rejects(
        f.transport.send({ type: 'connected' }),
        /stop requested/,
      )
    } finally {
      f.worker.emit('exit', 1)
      await f.transport.closed
    }
    if (failure === 'cancel-not-found') assert.deepEqual(f.errors, [])
    else assert.ok(f.errors.length > 0)
  })
}

test('FFI transport releases its job if worker construction throws', () => {
  const { FfiTransport } = require('../../../src/win32/windows-ffi.mts')
  const closed: bigint[] = []
  assert.throws(
    () =>
      new FfiTransport(
        7n,
        undefined,
        {
          CloseHandle: (handle: bigint) => {
            closed.push(handle)
            return 1
          },
        },
        () => {
          throw new Error('worker constructor')
        },
      ),
    /worker constructor/,
  )
  assert.deepEqual(closed, [7n])
})

test('kill-on-close job creation rejects invalid handles and closes a job after configuration failure', () => {
  const closed: bigint[] = []
  const native = {
    CreateJobObjectW: () => 0n,
    SetInformationJobObject: () => 0,
    CloseHandle: (handle: bigint) => {
      closed.push(handle)
      return 1
    },
  }
  assert.throws(() => createKillOnCloseJob(native), /CreateJobObject/)
  native.CreateJobObjectW = () => 0xff_ff_ff_ff_ff_ff_ff_ffn
  assert.throws(() => createKillOnCloseJob(native), /CreateJobObject/)
  native.CreateJobObjectW = () => 7n
  assert.throws(() => createKillOnCloseJob(native), /SetInformationJobObject/)
  assert.deepEqual(closed, [7n])
})

test('transport reports false Win32 cleanup returns and retries a failed job close', async () => {
  const f = transportFixture()
  f.native.OpenThread = () => 0n
  f.native.TerminateJobObject = () => 0
  f.native.CloseHandle = () => 0
  try {
    f.worker.emit('message', { kind: 'threadId', threadId: 42 })
    await f.transport.send({ type: 'abort' })
    f.transport.closeJob()
    assert.ok(f.errors.some(error => /OpenThread/.test(error.message)))
    assert.ok(f.errors.some(error => /TerminateJobObject/.test(error.message)))
    assert.ok(f.errors.some(error => /CloseHandle/.test(error.message)))
    const remove = f.transport.onError(() => {
      throw new Error('removed observer')
    })
    remove()
    f.transport.report('string error')
    assert.equal(f.errors.at(-1)?.message, 'string error')
  } finally {
    f.native.CloseHandle = () => 1
    f.worker.emit('exit', 0)
    await f.transport.closed
  }
})

test('FFI transport rejects unsupported host platforms and CPU architectures before loading bindings', () => {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
  const arch = Object.getOwnPropertyDescriptor(process, 'arch')!
  try {
    Object.defineProperty(process, 'platform', { value: 'linux' })
    assert.throws(() => createFfiTransport(), /requires Windows/)
    Object.defineProperty(process, 'platform', { value: 'win32' })
    Object.defineProperty(process, 'arch', { value: 'ia32' })
    assert.throws(
      () => createFfiTransport(),
      /Unsupported Windows FFI architecture/,
    )
  } finally {
    Object.defineProperty(process, 'platform', platform)
    Object.defineProperty(process, 'arch', arch)
  }
})

test('job close exceptions reach observers and keep the handle available for retry', async () => {
  const f = transportFixture()
  f.native.CloseHandle = () => {
    throw new Error('close threw')
  }
  f.transport.closeJob()
  assert.ok(f.errors.some(error => error.message === 'close threw'))
  f.native.CloseHandle = () => 1
  f.worker.emit('exit', 0)
  await f.transport.closed
})

test('transport refuses new commands after normal worker exit', async () => {
  const f = transportFixture()
  f.worker.emit('message', { kind: 'reply', reply: { type: 'brokerDone' } })
  f.worker.emit('exit', 0)
  await f.transport.closed
  await assert.rejects(
    f.transport.send({ type: 'connected' }),
    /transport is closed/,
  )
})

test(
  'direct FFI refuses older Windows versions that require a helper',
  { skip: process.platform !== 'win32' || modern },
  () => {
    assert.throws(() => createFfiTransport(), /requires Windows build 26100/)
  },
)
