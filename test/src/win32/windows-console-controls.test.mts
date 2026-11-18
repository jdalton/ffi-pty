import assert from 'node:assert/strict'
import { test } from 'vitest'
import {
  validateWindowHandle,
  reparentConsole,
  runConsoleControl,
} from '../../../src/win32/windows-console-controls.mts'
test('ConPTY controls validate HWND width, preserve native byte order and propagate HRESULT failures', () => {
  const handle = Buffer.alloc(8)
  handle.writeBigUInt64LE(123n)
  validateWindowHandle(handle)
  assert.throws(() => validateWindowHandle(Buffer.alloc(4)), /8-byte/)
  assert.throws(
    () => validateWindowHandle('bad' as unknown as Buffer),
    /Buffer/,
  )
  const calls: unknown[] = []
  const native = {
    ConptyReparentPseudoConsole: (console: bigint, parent: bigint) => {
      calls.push([console, parent])
      return 0
    },
    ConptyClearPseudoConsole: (console: bigint, keep: number) => {
      calls.push([console, keep])
      return 0
    },
  }
  assert.equal(reparentConsole(native, 7n, handle), true)
  assert.equal(reparentConsole(native, 0n, handle), false)
  assert.equal(reparentConsole({}, 7n, handle), false)
  assert.equal(
    runConsoleControl(native, 7n, { type: 'command', id: 1, command: 'clear' }),
    true,
  )
  assert.equal(
    runConsoleControl(native, 7n, {
      type: 'command',
      id: 2,
      command: 'reparent',
      handle,
    }),
    true,
  )
  assert.deepEqual(calls, [
    [7n, 123n],
    [7n, 0],
    [7n, 123n],
  ])
  assert.equal(
    runConsoleControl({}, 7n, { type: 'command', id: 1, command: 'clear' }),
    true,
  )
  assert.equal(
    runConsoleControl({}, 7n, { type: 'command', id: 1, command: 'close' }),
    false,
  )
  assert.throws(
    () =>
      runConsoleControl({ ConptyClearPseudoConsole: () => -1 }, 7n, {
        type: 'command',
        id: 1,
        command: 'clear',
      }),
    /HRESULT/,
  )
  assert.throws(
    () =>
      runConsoleControl({ ConptyReparentPseudoConsole: () => -1 }, 7n, {
        type: 'command',
        id: 1,
        command: 'reparent',
        handle,
      }),
    /rejected/,
  )
})
