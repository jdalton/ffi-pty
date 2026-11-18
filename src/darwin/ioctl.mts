import { dlopen, getRawPointer } from 'node:ffi'

export function createDarwinIoctl(
  address: bigint,
  load = dlopen,
  arch = process.arch,
) {
  // Darwin ARM64 passes variadic arguments on the stack. A fixed-arity ioctl
  // binding puts its third argument in the wrong place. System libffi builds
  // the variadic call frame; no generated addon or private Node API is needed.
  const { lib, functions } = load('/usr/lib/libffi.dylib', {
    ffi_prep_cif_var: {
      arguments: [
        'pointer',
        'uint32',
        'uint32',
        'uint32',
        'pointer',
        'pointer',
      ],
      return: 'uint32',
    },
    ffi_call: {
      arguments: ['pointer', 'pointer', 'pointer', 'pointer'],
      return: 'void',
    },
  })
  const types = Buffer.alloc(24)
  for (const [index, name] of [
    'ffi_type_sint32',
    'ffi_type_uint64',
    'ffi_type_pointer',
  ].entries()) {
    types.writeBigUInt64LE(lib.getSymbol(name), index * 8)
  }
  const cif = Buffer.alloc(64)
  const abi = arch === 'arm64' ? 1 : 2
  const result = functions.ffi_prep_cif_var(
    cif,
    abi,
    2,
    3,
    lib.getSymbol('ffi_type_sint32'),
    types,
  )
  if (result !== 0) throw new Error(`Cannot prepare variadic ioctl: ${result}`)
  return (fd: number, request: bigint, data: Buffer): number => {
    const descriptor = Buffer.alloc(4)
    descriptor.writeInt32LE(fd)
    const operation = Buffer.alloc(8)
    operation.writeBigUInt64LE(request)
    const pointer = Buffer.alloc(8)
    pointer.writeBigUInt64LE(getRawPointer(data))
    const values = Buffer.alloc(24)
    for (const [index, value] of [descriptor, operation, pointer].entries()) {
      values.writeBigUInt64LE(getRawPointer(value), index * 8)
    }
    const output = Buffer.alloc(8)
    functions.ffi_call(cif, address, output, values)
    // The CIF retains types; values retains pointers, not their JS owners.
    void types
    void descriptor
    void operation
    void pointer
    void data
    return output.readInt32LE()
  }
}
