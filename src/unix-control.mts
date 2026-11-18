import { dlopen, getInt32 } from 'node:ffi'
import { createDarwinIoctl } from './darwin/ioctl.mts'
export { createDarwinIoctl } from './darwin/ioctl.mts'
import { execFileSync } from 'node:child_process'
import type { PixelSize } from './compat-terminal.mts'

export function createUnixControl(platform = process.platform, load = dlopen) {
  const mac = platform === 'darwin'
  const { lib, functions } = load(
    mac ? '/usr/lib/libSystem.B.dylib' : 'libc.so.6',
    {
      tcgetpgrp: { arguments: ['int32'], return: 'int32' },
      [mac ? '__error' : '__errno_location']: {
        arguments: [],
        return: 'pointer',
      },
    },
  )
  const ioctl = mac
    ? createDarwinIoctl(lib.getSymbol('ioctl'), load)
    : lib.getFunction('ioctl', {
        arguments: ['int32', 'uint64', 'pointer'],
        return: 'int32',
      })
  return {
    resize(fd: number, cols: number, rows: number, pixels?: PixelSize) {
      const size = Buffer.alloc(8)
      size.writeUInt16LE(rows, 0)
      size.writeUInt16LE(cols, 2)
      size.writeUInt16LE(pixels?.width ?? 0, 4)
      size.writeUInt16LE(pixels?.height ?? 0, 6)
      if (ioctl(fd, mac ? 0x80_08_74_67n : 0x54_14n, size) !== 0) {
        throw new Error(
          `TIOCSWINSZ failed with errno ${getInt32(functions[mac ? '__error' : '__errno_location']())}`,
        )
      }
    },
    title(fd: number, fallback: string): string {
      try {
        const pid = functions.tcgetpgrp(fd) as number
        if (pid <= 0) return fallback
        return (
          execFileSync('/bin/ps', ['-p', String(pid), '-o', 'comm='], {
            encoding: 'utf8',
            timeout: 1000,
            stdio: ['ignore', 'pipe', 'ignore'],
          }).trim() || fallback
        )
      } catch {
        return fallback
      }
    },
  }
}

let cachedControl: ReturnType<typeof createUnixControl> | undefined
export function getUnixControl() {
  return (cachedControl ??= createUnixControl())
}
