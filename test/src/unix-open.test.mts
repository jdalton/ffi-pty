import type * as UnixOpen from '../../src/unix-open.mts'
import assert from 'node:assert/strict'
import { test, vi } from 'vitest'
import { createRequire } from 'node:module'

test(
  'raw Unix PTY open rejects invalid dimensions before allocating descriptors',
  { skip: process.platform === 'win32' },
  () => {
    const { openUnixPty } = createRequire(import.meta.url)(
      '../../src/unix-open.mts',
    ) as typeof UnixOpen
    assert.throws(() => openUnixPty({ cols: -1 }), /cols/)
    assert.throws(() => openUnixPty({ rows: 65_536 }), /rows/)
  },
)

test(
  'raw PTY open closes both descriptors when the second stream fails',
  { skip: process.platform === 'win32' },
  () => {
    const require = createRequire(import.meta.url)
    const tty = require('node:tty')
    const fs = require('node:fs')
    const { syncBuiltinESMExports } = require('node:module')
    const { openUnixPty } =
      require('../../src/unix-open.mts') as typeof UnixOpen
    const descriptors: number[] = []
    vi.spyOn(tty, 'ReadStream').mockImplementation(function (fd: number) {
      descriptors.push(fd)
      if (descriptors.length === 2) throw new Error('stream setup failed')
      return {
        setEncoding() {},
        resume() {},
        destroy() {
          fs.closeSync(fd)
        },
      }
    })
    syncBuiltinESMExports()
    try {
      assert.throws(() => openUnixPty(), /stream setup failed/)
      assert.equal(descriptors.length, 2)
      for (const fd of descriptors) {
        assert.throws(() => fs.fstatSync(fd), { code: 'EBADF' })
      }
    } finally {
      vi.restoreAllMocks()
      syncBuiltinESMExports()
    }
  },
)

test('raw PTY open rejects unsupported platforms before loading native libraries', () => {
  const original = Object.getOwnPropertyDescriptor(process, 'platform')!
  try {
    Object.defineProperty(process, 'platform', { value: 'win32' })
    const { openUnixPty } = createRequire(import.meta.url)(
      '../../src/unix-open.mts',
    ) as typeof UnixOpen
    assert.throws(() => openUnixPty(), /supported only on Unix/)
  } finally {
    Object.defineProperty(process, 'platform', original)
  }
})
