import assert from 'node:assert/strict'
import { test } from 'vitest'
import {
  initializeWindowsBindings,
  withBundledConpty,
  getWindowsBindings,
  lastError,
  utf16,
  getProcessHandleCount,
} from '../../../src/win32/windows-native.mts'

test('Win32 bindings initialize once, preserve error codes, and validate handle-count queries', () => {
  assert.throws(() => getWindowsBindings(), /not been initialized/)
  assert.match(lastError('OpenThread').message, /before Win32 bindings/)
  let calls = 0
  let success = true
  const native = {
    GetLastError: () => 5,
    GetCurrentProcess: () => 7n,
    GetProcessHandleCount(handle: bigint, result: Buffer) {
      assert.equal(handle, 7n)
      result.writeUInt32LE(42)
      return success ? 1 : 0
    },
  }
  const loader = (() => {
    calls++
    return { functions: native }
  }) as never
  assert.equal(initializeWindowsBindings(loader), native)
  assert.equal(initializeWindowsBindings(loader), native)
  assert.equal(calls, 1)
  assert.equal(getWindowsBindings(), native)
  assert.match(lastError('OpenThread').message, /Win32 error 5/)
  assert.equal(getProcessHandleCount(), 42)
  success = false
  assert.throws(
    () => getProcessHandleCount(),
    /GetProcessHandleCount failed.*5/,
  )
})

test('Win32 strings preserve Unicode, optionally terminate, and reject embedded NUL', () => {
  assert.equal(utf16('frog 🐸').toString('utf16le'), 'frog 🐸\0')
  assert.equal(utf16('name', false).toString('utf16le'), 'name')
  assert.throws(() => utf16('bad\0name'), /NUL/)
})

test('bundled ConPTY uses DLL create, resize, and close functions while retaining system bindings', () => {
  const create = () => 1
  const resize = () => 2
  const close = () => 3
  const functions = {
    ConptyCreatePseudoConsole: create,
    ConptyResizePseudoConsole: resize,
    ConptyClosePseudoConsole: close,
  }
  const library = { functions }
  const native = { CloseHandle: () => 4 }
  const result = withBundledConpty(native, 'C:\\cache\\conpty.dll', ((
    path: string,
  ) => {
    assert.equal(path, 'C:\\cache\\conpty.dll')
    return library
  }) as never)
  assert.equal(result.CreatePseudoConsole, create)
  assert.equal(result.ResizePseudoConsole, resize)
  assert.equal(result.ClosePseudoConsole, close)
  assert.equal(result.CloseHandle, native.CloseHandle)
  assert.equal(result.conptyLibrary, library)
})
