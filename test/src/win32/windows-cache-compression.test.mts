import assert from 'node:assert/strict'
import { test } from 'vitest'
import {
  compressCacheFile,
  type CompressionBindings,
} from '../../../src/win32/windows-cache-compression.mts'

test('NTFS compression uses LZNT1 on the open file and closes handles on success, unsupported filesystems, and errors', () => {
  const closed: bigint[] = []
  const native: CompressionBindings = {
    CreateFileW(path, access, share, _security, disposition, flags) {
      assert.equal(path.toString('utf16le'), 'C:\\cache\\asset.tmp\0')
      assert.equal(access, 0xc0_00_00_00)
      assert.equal(share, 7)
      assert.equal(disposition, 3)
      assert.equal(flags, 0x00_20_00_00)
      return 123n
    },
    DeviceIoControl(handle, code, input, length) {
      assert.equal(handle, 123n)
      assert.equal(code, 0x00_09_c0_40)
      assert.equal(input.readUInt16LE(), 1)
      assert.equal(length, 2)
      return 1
    },
    CloseHandle(handle) {
      closed.push(handle)
      return 1
    },
  }
  const path = 'C:\\cache\\asset.tmp'
  assert.equal(compressCacheFile(path, native), true)
  assert.equal(
    compressCacheFile(path, { ...native, DeviceIoControl: () => 0 }),
    false,
  )
  assert.throws(
    () =>
      compressCacheFile(path, {
        ...native,
        DeviceIoControl: () => {
          throw new Error('ffi failure')
        },
      }),
    /ffi failure/,
  )
  assert.deepEqual(closed, [123n, 123n, 123n])
  for (const handle of [0n, 0xff_ff_ff_ff_ff_ff_ff_ffn]) {
    assert.equal(
      compressCacheFile(path, { ...native, CreateFileW: () => handle }),
      false,
    )
  }
  assert.equal(closed.length, 3)
})
