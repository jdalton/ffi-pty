import { EventEmitter } from 'node:events'
import { PassThrough, Writable } from 'node:stream'
import type { BrokerReply } from '../../../src/win32/windows-protocol.mts'
import { encodeHelperReply } from '../../../src/win32/windows-helper-protocol.mts'
import {
  createHelperTransport,
  writePipe,
} from '../../../src/win32/windows-helper.mts'
import assert from 'node:assert/strict'
import { test } from 'vitest'
import {
  helperExecutablePath,
  helperStartupEnv,
} from '../../../src/win32/windows-helper.mts'

test('helper process receives only startup environment variables', () => {
  assert.deepEqual(
    helperStartupEnv({
      SystemRoot: 'C:\\Windows',
      TEMP: 'C:\\Temp',
      PATH: 'secret-path',
      NODE_OPTIONS: '--inspect',
    }),
    { SystemRoot: 'C:\\Windows', TEMP: 'C:\\Temp' },
  )
})

test('helper path is architecture-specific and rejects unsupported targets', () => {
  assert.match(helperExecutablePath('x64'), /win32-x64[\\/]helper\.exe$/)
  assert.match(helperExecutablePath('arm64'), /win32-arm64[\\/]helper\.exe$/)
  assert.throws(() => helperExecutablePath('ia32'), /No Windows helper/)
})

export function transportFixture() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: PassThrough
    stdin: Writable
    exitCode: number | null
    signalCode: string | null
    kill(): boolean
  }
  const writes: Buffer[] = []
  const errors: Error[] = []
  const replies: BrokerReply[] = []
  const start = {
    cols: 80,
    rows: 24,
    application: Buffer.from('x\0', 'utf16le'),
    commandLine: Buffer.from('x\0', 'utf16le'),
    cwd: Buffer.from('C:\\\0', 'utf16le'),
    environment: Buffer.alloc(4),
    inputName: 'input',
    outputName: 'output',
  }
  child.stdout = new PassThrough()
  child.stdin = new Writable({
    write(chunk, _encoding, callback) {
      writes.push(Buffer.from(chunk))
      callback()
    },
  })
  child.exitCode = null
  child.signalCode = null
  let kills = 0
  child.kill = () => {
    kills++
    child.exitCode = 0
    child.emit('close')
    return true
  }
  const transport = createHelperTransport(
    'helper.exe',
    (() => child) as never,
    (() => start) as never,
    'win32',
  )
  transport.onError(error => errors.push(error))
  transport.onMessage(reply => replies.push(reply))
  return { child, writes, errors, replies, transport, kills: () => kills }
}

test('native helper transport serializes START and control frames and reassembles split replies', async () => {
  const f = transportFixture()
  f.child.emit('spawn')
  await f.transport.ready
  await f.transport.send({ type: 'start', options: {} as never })
  await f.transport.send({ type: 'connected' })
  await assert.rejects(
    f.transport.send({ type: 'start', options: {} as never }),
    /already sent/,
  )
  assert.equal(f.writes.length, 2)
  const frame = encodeHelperReply({ type: 'pipes', input: '', output: '' })
  f.child.stdout.write(frame.subarray(0, 3))
  assert.deepEqual(f.replies, [])
  f.child.stdout.write(frame.subarray(3))
  assert.deepEqual(f.replies, [
    { type: 'pipes', input: 'input', output: 'output' },
  ])
  const remove = f.transport.onMessage(() => {
    throw 'observer failure'
  })
  const ignored = f.transport.onError(() => {
    throw new Error('ignored')
  })
  f.child.stdout.write(encodeHelperReply({ type: 'brokerDone' }))
  assert.equal(f.errors.at(-1)?.message, 'observer failure')
  remove()
  ignored()
  f.child.stdout.write(encodeHelperReply({ type: 'brokerDone' }))
  assert.equal(f.errors.length, 1)
  await f.transport.terminate()
  assert.equal(f.kills(), 1)
})

for (const mode of [
  'early-pipes',
  'invalid-frame',
  'truncated',
  'stdin-error',
  'spawn-error',
  'unknown-exit',
  'failed-exit',
]) {
  test(`native helper transport reports ${mode} and settles shutdown`, async () => {
    const f = transportFixture()
    if (mode === 'spawn-error') {
      f.child.emit('error', new Error('spawn failed'))
      await assert.rejects(f.transport.ready, /spawn failed/)
    } else {
      f.child.emit('spawn')
      await f.transport.ready
    }
    if (mode === 'early-pipes') {
      f.child.stdout.write(
        encodeHelperReply({ type: 'pipes', input: '', output: '' }),
      )
    }
    if (mode === 'invalid-frame') f.child.stdout.write(Buffer.alloc(32))
    if (mode === 'truncated') {
      f.child.stdout.write(Buffer.from([1]))
      f.child.stdout.emit('end')
    }
    if (mode === 'stdin-error') {
      f.child.stdin.emit('error', new Error('broken pipe'))
    }
    if (mode.endsWith('-exit')) {
      f.child.exitCode = mode === 'failed-exit' ? 7 : null
      f.child.signalCode = 'SIGTERM'
      f.child.emit('close')
      await f.transport.closed
    }
    await f.transport.terminate()
    assert.ok(f.errors.length > 0)
    if (mode === 'early-pipes' || mode === 'invalid-frame') {
      assert.equal(f.kills(), 1)
    }
  })
}

test('helper write failures reject and closed input cannot accept frames', async () => {
  const failing = new Writable({
    write(_chunk, _encoding, callback) {
      callback(new Error('write failed'))
    },
  })
  failing.on('error', () => {})
  await assert.rejects(writePipe(failing, Buffer.from('x')), /write failed/)
  const ended = new PassThrough()
  ended.end()
  await assert.rejects(writePipe(ended, Buffer.from('x')), /input is closed/)
  const destroyed = new PassThrough()
  destroyed.destroy()
  await assert.rejects(
    writePipe(destroyed, Buffer.from('x')),
    /input is closed/,
  )
  assert.throws(
    () => createHelperTransport('helper.exe', undefined, undefined, 'linux'),
    /requires Windows/,
  )
})
