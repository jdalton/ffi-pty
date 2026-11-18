import assert from 'node:assert/strict'
import { test } from 'vitest'
import { EventEmitter } from 'node:events'
import { setImmediate as turn } from 'node:timers/promises'
import { createWindowsCompatibilityBackend } from '../../../src/win32/windows-compat.mts'
import type { CompatibilityRequest } from '../../../src/win32/windows-compat-protocol.mts'
import { normalizeCompatibleOptions } from '../../../src/compat-options.mts'

export class FakeCompatibilityWorker extends EventEmitter {
  requests: CompatibilityRequest[] = []
  terminated = 0
  parentResult = 1
  postMessage(request: CompatibilityRequest) {
    this.requests.push(request)
    if (request.type === 'parent') {
      const response = new Int32Array(request.response)
      Atomics.store(response, 1, this.parentResult)
      Atomics.store(response, 0, 1)
    }
    if (request.type === 'command') {
      queueMicrotask(() =>
        this.emit('message', { type: 'ack', id: request.id }),
      )
    }
  }
  async terminate() {
    this.terminated++
    return 0
  }
}
test('compatibility bridge returns actual HWND result synchronously and orders startup, commands, output and exit', async () => {
  const worker = new FakeCompatibilityWorker()
  const options = normalizeCompatibleOptions('cmd.exe', [], {}, 'win32').spawn
  options.conptyDll = 'fixture.dll'
  const backend = createWindowsCompatibilityBackend(options, worker)
  assert.equal(backend.pid, 0)
  assert.equal(backend.setParentWindow?.(Buffer.alloc(8)), true)
  assert.equal(worker.requests[0].type, 'parent')
  worker.parentResult = 0
  assert.equal(backend.setParentWindow?.(Buffer.alloc(8)), false)
  await turn()
  assert.equal(worker.requests[2].type, 'start')
  worker.emit('message', { type: 'ready', pid: 123 })
  await backend.ready
  assert.equal(backend.pid, 123)
  await backend.write(Buffer.from('data'))
  await backend.resize(80, 24)
  await backend.kill()
  await backend.clear?.()
  let output = ''
  backend.readable.on('data', data => {
    output += data
  })
  worker.emit('message', { type: 'data', data: Buffer.from('hello') })
  worker.emit('message', { type: 'end' })
  worker.emit('message', { type: 'exit', status: { exitCode: 0, signal: 0 } })
  assert.deepEqual(await backend.exited, { exitCode: 0, signal: 0 })
  assert.equal(output, 'hello')
  assert.equal(backend.setParentWindow?.(Buffer.alloc(8)), false)
  const cleanup = backend.close()
  assert.equal(backend.close(), cleanup)
  await cleanup
  assert.equal(worker.terminated, 1)
})
test('compatibility bridge rejects startup and pending operations when its worker fails', async () => {
  const worker = new FakeCompatibilityWorker()
  const backend = createWindowsCompatibilityBackend(
    normalizeCompatibleOptions('cmd.exe', [], {}, 'win32').spawn,
    worker,
  )
  assert.equal(backend.setParentWindow?.(Buffer.alloc(8)), false)
  worker.emit('error', new Error('startup failure'))
  await assert.rejects(backend.ready!, /startup failure/)
  await assert.rejects(backend.exited, /startup failure/)
  await assert.rejects(backend.write(Buffer.from('x')), /startup failure/)
  await assert.doesNotReject(backend.close())
  assert.ok(worker.terminated > 0)
})

test('worker exit settles a pending close even if the exit event beats its acknowledgement', async () => {
  const worker = new FakeCompatibilityWorker()
  worker.postMessage = request => {
    worker.requests.push(request)
  }
  const backend = createWindowsCompatibilityBackend(
    normalizeCompatibleOptions('cmd.exe', [], {}, 'win32').spawn,
    worker,
  )
  worker.emit('message', { type: 'ready', pid: 1 })
  await backend.ready
  const closing = backend.close()
  worker.emit('message', { type: 'end' })
  worker.emit('message', { type: 'exit', status: { exitCode: 0, signal: 0 } })
  worker.emit('exit', 0)
  await closing
  assert.equal(worker.terminated, 1)
})
