import assert from 'node:assert/strict'
import { test } from 'vitest'
import { createDarwinIoctl } from '../../../src/darwin/ioctl.mts'

for (const arch of ['arm64', 'x64'] as const) {
  test(`Darwin variadic ioctl uses the ${arch} ABI and returns the native status`, () => {
    let prepared = false
    let called = false
    const load = ((_path, _signature) => ({
      lib: { getSymbol: () => 10n },
      functions: {
        ffi_prep_cif_var(_cif, abi, fixed, total) {
          assert.equal(abi, arch === 'arm64' ? 1 : 2)
          assert.equal(fixed, 2)
          assert.equal(total, 3)
          prepared = true
          return 0
        },
        ffi_call(_cif, address, result: Buffer, values: Buffer) {
          assert.equal(address, 23n)
          assert.equal(values.length, 24)
          assert.notEqual(values.readBigUInt64LE(), 0n)
          result.writeInt32LE(-1)
          called = true
        },
      },
    })) as never
    assert.equal(
      createDarwinIoctl(23n, load, arch)(4, 99n, Buffer.alloc(8)),
      -1,
    )
    assert.ok(prepared && called)
  })
}
test('Darwin ioctl rejects an unsupported variadic ABI before making a call', () => {
  const load = (() => ({
    lib: { getSymbol: () => 1n },
    functions: {
      ffi_prep_cif_var: () => 2,
      ffi_call: () => assert.fail('must not call ioctl'),
    },
  })) as never
  assert.throws(
    () => createDarwinIoctl(1n, load),
    /Cannot prepare variadic ioctl: 2/,
  )
})
