import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import {
  openHelperLockHandle,
  helperHandleAttributes,
  rejectReparsePath,
  canonicalHelperPath,
} from '../../../src/win32/windows-helper-lock.mts'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, vi } from 'vitest'
import {
  assertNotReparsePoint,
  closeWindowsHandlePair,
  lockWindowsHelper,
  type LockBindings,
} from '../../../src/win32/windows-helper-lock.mts'

export function fakeBindings(attributes: number[], failInfoAt = 0) {
  let infoCalls = 0
  let next = 1n
  const closed: bigint[] = []
  const native: LockBindings = {
    CreateFileW() {
      return next++
    },
    GetFileInformationByHandle(handle, info) {
      infoCalls++
      if (infoCalls === failInfoAt) return 0
      info.writeUInt32LE(attributes[Number(handle) - 1] ?? 0, 0)
      return 1
    },
    CloseHandle(handle) {
      closed.push(handle)
      return 1
    },
    GetLastError() {
      return 5
    },
  }
  return { native, closed }
}

test(
  'helper lock releases file and directory handles exactly once',
  { skip: process.platform !== 'win32' },
  () => {
    const directory = mkdtempSync(join(tmpdir(), 'pty-lock-'))
    const helper = join(directory, 'helper.exe')
    writeFileSync(helper, 'placeholder')
    try {
      const { native, closed } = fakeBindings([0x10, 0])
      const lock = lockWindowsHelper(helper, native)
      lock.release()
      lock.release()
      assert.deepEqual(closed, [2n, 1n])
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  },
)

test(
  'helper lock closes both handles if file inspection fails',
  { skip: process.platform !== 'win32' },
  () => {
    const directory = mkdtempSync(join(tmpdir(), 'pty-lock-'))
    const helper = join(directory, 'helper.exe')
    writeFileSync(helper, 'placeholder')
    try {
      const { native, closed } = fakeBindings([0x10, 0], 2)
      assert.throws(
        () => lockWindowsHelper(helper, native),
        /GetFileInformationByHandle/,
      )
      assert.deepEqual(closed, [2n, 1n])
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  },
)

test(
  'helper lock rejects a reparse parent and closes its handle',
  { skip: process.platform !== 'win32' },
  () => {
    const directory = mkdtempSync(join(tmpdir(), 'pty-lock-'))
    const helper = join(directory, 'helper.exe')
    writeFileSync(helper, 'placeholder')
    try {
      const { native, closed } = fakeBindings([0x10 | 0x4_00])
      assert.throws(() => lockWindowsHelper(helper, native), /reparse point/)
      assert.deepEqual(closed, [1n])
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  },
)

test('reparse attributes are rejected', () => {
  assert.throws(
    () => assertNotReparsePoint(0x4_00, 'helper.exe'),
    /reparse point/,
  )
  assert.doesNotThrow(() => assertNotReparsePoint(0, 'helper.exe'))
})

test('both handles are closed even when closing the first fails', () => {
  const closed: bigint[] = []
  const native = fakeBindings([0, 0]).native
  native.CloseHandle = handle => {
    closed.push(handle)
    if (handle === 1n) throw new Error('simulated close failure')
    return 1
  }
  assert.throws(
    () => closeWindowsHandlePair(native, 1n, 2n),
    /simulated close failure/,
  )
  assert.deepEqual(closed, [1n, 2n])
})

test('invalid helper handles and failed attribute queries report Win32 errors', () => {
  for (const handle of [0n, 0xff_ff_ff_ff_ff_ff_ff_ffn]) {
    const { native } = fakeBindings([])
    native.CreateFileW = () => handle
    assert.throws(
      () => openHelperLockHandle(native, 'C:\\helper.exe', 0, 0, 0),
      /Win32 error 5/,
    )
  }
  const { native } = fakeBindings([], 1)
  assert.throws(() => helperHandleAttributes(native, 1n), /Win32 error 5/)
  assert.throws(() => rejectReparsePath('relative.exe'), /absolute/)
})

test('helper handle cleanup skips absent handles and preserves false or non-Error close failures', () => {
  for (const mode of ['false', 'string']) {
    const { native, closed } = fakeBindings([])
    native.CloseHandle = handle => {
      closed.push(handle)
      if (mode === 'string') throw 'close error'
      return 0
    }
    assert.throws(
      () => closeWindowsHandlePair(native, 0n, 2n),
      /CloseHandle|close error/,
    )
    assert.deepEqual(closed, [2n])
  }
})

for (const mode of [
  'parent-not-directory',
  'file-is-directory',
  'file-reparse',
  'create-file',
  'cleanup',
]) {
  test(
    `helper lock refuses ${mode} and releases every acquired handle`,
    { skip: process.platform !== 'win32' },
    () => {
      const directory = mkdtempSync(join(tmpdir(), 'pty-lock-failure-'))
      const helper = join(directory, 'helper.exe')
      writeFileSync(helper, 'placeholder')
      try {
        const attrs =
          mode === 'parent-not-directory'
            ? [0]
            : [0x10, mode === 'file-reparse' ? 0x4_00 : 0x10]
        const { native, closed } = fakeBindings(attrs)
        if (mode === 'create-file') {
          let calls = 0
          native.CreateFileW = () => (++calls === 1 ? 1n : 0n)
        }
        if (mode === 'cleanup') {
          native.CloseHandle = handle => {
            closed.push(handle)
            throw new Error('cleanup failed')
          }
        }
        assert.throws(
          () => lockWindowsHelper(helper, native),
          /directory|reparse|CreateFile/,
        )
        assert.deepEqual(
          closed,
          ['parent-not-directory', 'create-file'].includes(mode)
            ? [1n]
            : [2n, 1n],
        )
      } finally {
        rmSync(directory, { recursive: true, force: true })
      }
    },
  )
}

test('helper lock rejects unsupported hosts and relative paths before touching filesystem state', () => {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
  try {
    Object.defineProperty(process, 'platform', { value: 'linux' })
    assert.throws(() => lockWindowsHelper('C:\\helper.exe'), /require Windows/)
    Object.defineProperty(process, 'platform', { value: 'win32' })
    assert.throws(() => lockWindowsHelper('helper.exe'), /must be absolute/)
  } finally {
    Object.defineProperty(process, 'platform', platform)
  }
})

test('canonical helper paths reject reparse ancestors and nonabsolute native resolutions', () => {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
  try {
    Object.defineProperty(process, 'platform', { value: 'linux' })
    assert.throws(
      () => canonicalHelperPath('C:\\helper.exe'),
      /require Windows/,
    )
    Object.defineProperty(process, 'platform', { value: 'win32' })
    vi.spyOn(fs, 'lstatSync').mockImplementation(
      () => ({ isSymbolicLink: () => true }) as never,
    )
    syncBuiltinESMExports()
    assert.throws(
      () => canonicalHelperPath('C:\\folder\\helper.exe'),
      /reparse point/,
    )
    vi.restoreAllMocks()
    vi.spyOn(fs, 'lstatSync').mockImplementation(
      () => ({ isSymbolicLink: () => false }) as never,
    )
    vi.spyOn(fs.realpathSync, 'native').mockImplementation(
      () => 'relative.exe' as never,
    )
    syncBuiltinESMExports()
    assert.throws(
      () => canonicalHelperPath('C:\\helper.exe'),
      /did not resolve to an absolute/,
    )
  } finally {
    vi.restoreAllMocks()
    syncBuiltinESMExports()
    Object.defineProperty(process, 'platform', platform)
  }
})
