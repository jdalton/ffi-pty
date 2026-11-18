import assert from 'node:assert/strict'
import { test } from 'vitest'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { setImmediate as turn } from 'node:timers/promises'
import {
  runCompatibilityWorker,
  compatibilityCommand,
} from '../../../src/win32/windows-compat-worker.mts'
import { normalizeCompatibleOptions } from '../../../src/compat-options.mts'
import type { Backend, ExitStatus } from '../../../src/contract.mts'
import type { CompatibilityReply } from '../../../src/win32/windows-compat-protocol.mts'

export class FakeCompatibilityPort extends EventEmitter {
  replies: CompatibilityReply[] = []
  closed = false
  postMessage(reply: CompatibilityReply) {
    this.replies.push(reply)
  }
  close() {
    this.closed = true
  }
}
test('worker applies the initial HWND before factory startup, acknowledges native results, and closes after exit', async () => {
  const port = new FakeCompatibilityPort()
  const options = normalizeCompatibleOptions('cmd.exe', [], {}, 'win32').spawn
  const calls: unknown[] = []
  let resolveExit!: (value: ExitStatus) => void
  const readable = new PassThrough()
  const backend: Backend = {
    pid: 7,
    readable,
    exited: new Promise(resolve => {
      resolveExit = resolve
    }),
    async write(data) {
      calls.push(data.toString())
    },
    async resize(cols, rows) {
      calls.push([cols, rows])
    },
    async kill(signal) {
      calls.push(signal)
    },
    async clear() {
      calls.push('clear')
    },
    async close() {
      calls.push('close')
    },
    async reparent(handle) {
      calls.push(handle.readBigUInt64LE())
    },
  }
  runCompatibilityWorker(port, options, async start => {
    assert.equal(start.parentWindow?.readBigUInt64LE(), 42n)
    return backend
  })
  const handle = Buffer.alloc(8)
  handle.writeBigUInt64LE(42n)
  const response = new Int32Array(new SharedArrayBuffer(8))
  port.emit('message', { type: 'parent', handle, response: response.buffer })
  await turn()
  assert.equal(Atomics.load(response, 0), 1)
  assert.equal(Atomics.load(response, 1), 1)
  port.emit('message', {
    type: 'command',
    id: 1,
    operation: 'write',
    args: [Buffer.from('input')],
  })
  await turn()
  assert.ok(port.replies.some(reply => reply.type === 'ack' && reply.id === 1))
  for (const [operation, args] of [
    ['resize', [80, 24]],
    ['kill', ['SIGTERM']],
    ['clear', []],
    ['close', []],
  ] as const) {
    await compatibilityCommand(backend, operation, [...args])
  }
  await assert.rejects(compatibilityCommand(backend, 'unknown', []), /Unknown/)
  port.emit('message', { type: 'pause' })
  assert.equal(readable.isPaused(), true)
  port.emit('message', { type: 'resume' })
  readable.end('output')
  resolveExit({ exitCode: 0, signal: 0 })
  await turn()
  await turn()
  assert.deepEqual(calls, [42n, 'input', [80, 24], 'SIGTERM', 'clear', 'close'])
  assert.ok(port.replies.some(reply => reply.type === 'data'))
  assert.equal(port.closed, true)
})
test('worker signals a rejected native parent request without claiming success', async () => {
  const port = new FakeCompatibilityPort()
  runCompatibilityWorker(
    port,
    normalizeCompatibleOptions('cmd.exe', [], {}, 'win32').spawn,
    async () => {
      throw new Error('failed')
    },
  )
  const response = new Int32Array(new SharedArrayBuffer(8))
  port.emit('message', {
    type: 'parent',
    handle: Buffer.alloc(8),
    response: response.buffer,
  })
  await turn()
  assert.equal(Atomics.load(response, 0), 1)
  assert.equal(Atomics.load(response, 1), 0)
  assert.ok(port.replies.some(reply => reply.type === 'error'))
})
