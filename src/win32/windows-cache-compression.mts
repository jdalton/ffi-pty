import { dlopen } from 'node:ffi'
import { encodeWindowsString } from './windows-launch.mts'

export interface CompressionBindings {
  CreateFileW(
    path: Buffer,
    access: number,
    share: number,
    security: bigint,
    disposition: number,
    flags: number,
    template: bigint,
  ): bigint
  DeviceIoControl(
    handle: bigint,
    code: number,
    input: Buffer,
    inputLength: number,
    output: bigint,
    outputLength: number,
    returned: Buffer,
    overlapped: bigint,
  ): number
  CloseHandle(handle: bigint): number
}
let bindings: CompressionBindings | undefined
export function loadCompressionBindings(): CompressionBindings {
  return (bindings ??= dlopen('kernel32.dll', {
    CreateFileW: {
      arguments: [
        'pointer',
        'uint32',
        'uint32',
        'pointer',
        'uint32',
        'uint32',
        'pointer',
      ],
      return: 'pointer',
    },
    DeviceIoControl: {
      arguments: [
        'pointer',
        'uint32',
        'pointer',
        'uint32',
        'pointer',
        'uint32',
        'pointer',
        'pointer',
      ],
      return: 'int32',
    },
    CloseHandle: { arguments: ['pointer'], return: 'int32' },
  }).functions as unknown as CompressionBindings)
}
export function compressCacheFile(
  path: string,
  native = loadCompressionBindings(),
): boolean {
  const handle = native.CreateFileW(
    encodeWindowsString(path),
    0xc0_00_00_00,
    7,
    0n,
    3,
    0x00_20_00_00,
    0n,
  )
  if (handle === 0n || handle === 0xff_ff_ff_ff_ff_ff_ff_ffn) return false
  try {
    const format = Buffer.alloc(2)
    format.writeUInt16LE(1) // COMPRESSION_FORMAT_DEFAULT (NTFS LZNT1).
    return (
      native.DeviceIoControl(
        handle,
        0x00_09_c0_40,
        format,
        2,
        0n,
        0,
        Buffer.alloc(4),
        0n,
      ) !== 0
    )
  } finally {
    native.CloseHandle(handle)
  }
}
