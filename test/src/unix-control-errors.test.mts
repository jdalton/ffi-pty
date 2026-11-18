import assert from 'node:assert/strict'
import { test, vi } from 'vitest'
import cp from 'node:child_process'
import { syncBuiltinESMExports } from 'node:module'
import { getRawPointer } from 'node:ffi'
import { createUnixControl } from '../../src/unix-control.mts'

test('Unix controls preserve ioctl errors and use the title fallback after process lookup fails', () => {
  const errno = Buffer.alloc(4)
  errno.writeInt32LE(9)
  const load = (() => ({
    lib: { getFunction: () => () => -1 },
    functions: {
      tcgetpgrp: () => 123,
      __errno_location: () => getRawPointer(errno),
    },
  })) as never
  const control = createUnixControl('linux', load)
  assert.throws(() => control.resize(4, 80, 24), /errno 9/)
  vi.spyOn(cp, 'execFileSync').mockImplementation(() => {
    throw new Error('ps failed')
  })
  syncBuiltinESMExports()
  try {
    assert.equal(control.title(4, 'shell'), 'shell')
    vi.spyOn(cp, 'execFileSync').mockImplementation(() => '  ')
    syncBuiltinESMExports()
    assert.equal(control.title(4, 'shell'), 'shell')
  } finally {
    vi.restoreAllMocks()
    syncBuiltinESMExports()
  }
})
