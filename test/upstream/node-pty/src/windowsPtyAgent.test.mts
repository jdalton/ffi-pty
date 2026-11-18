// Adapted from node-pty's MIT-licensed windowsPtyAgent.test.ts.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { EventEmitter } from 'node:events'
import { setImmediate as turn } from 'node:timers/promises'
import { vi } from 'vitest'
import { argsToCommandLine } from '../../../../src/win32/windows-commandline.mts'
import { createWindowsCompatibilityBackend } from '../../../../src/win32/windows-compat.mts'
import { normalizeCompatibleOptions } from '../../../../src/compat-options.mts'
import type { CompatibilityRequest } from '../../../../src/win32/windows-compat-protocol.mts'
import { upstreamTest, inventory, terminal, windows } from '../suite.mts'

const cases = JSON.parse(
  readFileSync(new URL('../command-line.json', import.meta.url), 'utf8'),
) as Array<{
  title: string
  file: string
  args: string[] | string
  expected: string
}>
// Titles repeat between describe groups; preserve source order rather than using
// titles as keys. One upstream test contains two command-line assertions.
let offset = 0
for (let id = 1; id <= 21; id++) {
  const title = inventory.files.find(
    file => file.file === 'src/windowsPtyAgent.test.ts',
  )!.cases[id - 1].title
  const rows = [cases[offset++]]
  while (offset < cases.length && cases[offset].title === title) {
    rows.push(cases[offset++])
  }
  upstreamTest('windowsPtyAgent', id, {}, () => {
    assert.ok(rows.length)
    for (const row of rows) {
      assert.equal(argsToCommandLine(row.file, row.args), row.expected)
    }
  })
}
export class ConnectionWorker extends EventEmitter {
  requests: CompatibilityRequest[] = []
  disposed = false
  postMessage(request: CompatibilityRequest) {
    this.requests.push(request)
  }
  async terminate() {
    this.disposed = true
    return 0
  }
}
export function connection(timeout = 1000) {
  const worker = new ConnectionWorker()
  const options = normalizeCompatibleOptions('cmd.exe', [], {}, 'win32').spawn
  const backend = createWindowsCompatibilityBackend(options, worker, timeout)
  return { worker, backend }
}
upstreamTest('windowsPtyAgent', 22, {}, async () => {
  vi.useFakeTimers({ toFake: ['setTimeout'] })
  const { worker, backend } = connection(10)
  let responsive = false
  setImmediate(() => {
    responsive = true
  })
  await turn()
  vi.advanceTimersByTime(10)
  vi.useRealTimers()
  await assert.rejects(
    backend.ready!,
    /Timed out waiting for ConPTY output worker/,
  )
  assert.equal(responsive, true)
  assert.equal(worker.disposed, true)
  assert.equal(backend.pid, 0)
  worker.emit('message', { type: 'ready', pid: 123 })
  assert.equal(backend.pid, 0)
})
upstreamTest('windowsPtyAgent', 23, {}, async () => {
  const { worker, backend } = connection()
  const error = new Error('worker failed')
  worker.emit('error', error)
  await assert.rejects(backend.ready!, candidate => candidate === error)
  assert.equal(worker.disposed, true)
  assert.equal(backend.pid, 0)
  assert.equal(worker.requests.length, 0)
})
upstreamTest('windowsPtyAgent', 24, {}, async () => {
  const { worker, backend } = connection()
  let errors = 0
  backend.readable.on('error', () => {
    errors++
  })
  await backend.kill()
  worker.emit('message', { type: 'ready', pid: 123 })
  worker.emit('error', new Error('late error'))
  await turn()
  assert.equal(worker.requests.length, 0)
  assert.equal(errors, 0)
  assert.equal(backend.pid, 0)
})
upstreamTest('windowsPtyAgent', 25, windows, async t => {
  const { term } = terminal(t, 'cmd.exe')
  assert.equal(term.pid, 0)
  await term.ready
  assert.ok(term.pid > 0)
})
upstreamTest('windowsPtyAgent', 26, windows, async t => {
  const { term, output } = terminal(t, 'cmd.exe', '/c echo hello')
  await term.exited
  assert.match(output(), /hello/)
})
upstreamTest('windowsPtyAgent', 27, windows, async t => {
  const events: string[] = []
  const { term } = terminal(t, 'cmd.exe')
  events.push('returned')
  assert.equal(term.pid, 0)
  await turn()
  events.push('async work')
  await term.ready
  events.push('ready')
  assert.ok(term.pid > 0)
  assert.deepEqual(events.slice(0, 2), ['returned', 'async work'])
})
