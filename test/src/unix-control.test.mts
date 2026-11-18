import assert from 'node:assert/strict'
import { test } from 'vitest'
import { createRequire } from 'node:module'
import { dlopen } from 'node:ffi'
import { createDarwinIoctl, getUnixControl } from '../../src/unix-control.mts'
import { normalizeSpawnOptions } from '../../src/validation.mts'

const require = createRequire(import.meta.url)
test(
  'Unix controls resize character and pixel dimensions and preserve foreground process lookup',
  { skip: process.platform === 'win32', timeout: 10_000 },
  async () => {
    const platform = require(
      process.platform === 'darwin'
        ? '../../src/darwin/darwin.mts'
        : '../../src/linux/linux.mts',
    )
    const backend = platform.createBackendSync(
      normalizeSpawnOptions('/bin/cat', []),
    )
    try {
      await backend.ready
      const control = getUnixControl()
      assert.equal(control, getUnixControl())
      control.resize(backend.masterFd, 91, 31, { width: 910, height: 620 })
      const { lib } = dlopen(
        process.platform === 'darwin'
          ? '/usr/lib/libSystem.B.dylib'
          : 'libc.so.6',
      )
      try {
        const ioctl =
          process.platform === 'darwin'
            ? createDarwinIoctl(lib.getSymbol('ioctl'))
            : lib.getFunction('ioctl', {
                arguments: ['int32', 'uint64', 'pointer'],
                return: 'int32',
              })
        const size = Buffer.alloc(8)
        assert.equal(
          ioctl(
            backend.masterFd,
            process.platform === 'darwin' ? 0x40_08_74_68n : 0x54_13n,
            size,
          ),
          0,
        )
        assert.deepEqual(
          [0, 2, 4, 6].map(offset => size.readUInt16LE(offset)),
          [31, 91, 910, 620],
        )
        control.resize(backend.masterFd, 80, 24)
        assert.match(control.title(backend.masterFd, 'fallback'), /cat/)
        assert.equal(control.title(-1, 'fallback'), 'fallback')
        assert.throws(() => control.resize(-1, 80, 24), /TIOCSWINSZ/)
      } finally {
        lib.close()
      }
    } finally {
      await backend.close()
    }
  },
)
