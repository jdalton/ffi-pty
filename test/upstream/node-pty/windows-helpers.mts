import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { terminal, until } from './suite.mts'
import type { TestContext } from 'node:test'

export function powershellArgs(...lines: string[]): string {
  return `-NoProfile -NonInteractive -EncodedCommand ${Buffer.from(lines.join('; '), 'utf16le').toString('base64')}`
}
export function windowArgs(delay = 0, keepAlive = 0) {
  return [
    '--experimental-ffi',
    fileURLToPath(new URL('./window-probe.mts', import.meta.url)),
    String(delay),
    String(keepAlive),
  ]
}
export async function readWindows(output: () => string) {
  const pattern = /console=(\d+) rootOwner=(\d+) end/
  await until(() => pattern.test(output()), 30_000)
  const match = pattern.exec(output())!
  return { console: BigInt(match[1]), rootOwner: BigInt(match[2]) }
}
export function toHandle(value: bigint) {
  const buffer = Buffer.alloc(8)
  buffer.writeBigUInt64LE(value)
  return buffer
}
export async function hostWindow(t: TestContext, useConptyDll: boolean) {
  const host = terminal(t, process.execPath, windowArgs(0, 60), {
    useConptyDll,
  })
  return (await readWindows(host.output)).console
}
export interface ProcessRow {
  ProcessId: number
  ParentProcessId: number
  Name: string
}
export function processTree(pid: number): ProcessRow[] {
  const rows = processSnapshot()
  const root = rows.find(row => row.ProcessId === pid)
  if (!root) {
    return []
  }
  const result = [root]
  for (let i = 0; i < result.length; i++) {
    result.push(
      ...rows.filter(
        row =>
          row.ParentProcessId === result[i].ProcessId &&
          !result.some(seen => seen.ProcessId === row.ProcessId),
      ),
    )
  }
  return result
}

export function processSnapshot(): ProcessRow[] {
  const { dlopen } = createRequire(import.meta.url)('node:ffi')
  const library = dlopen('kernel32.dll', {
    CreateToolhelp32Snapshot: {
      arguments: ['uint32', 'uint32'],
      return: 'pointer',
    },
    Process32FirstW: { arguments: ['pointer', 'pointer'], return: 'int32' },
    Process32NextW: { arguments: ['pointer', 'pointer'], return: 'int32' },
    CloseHandle: { arguments: ['pointer'], return: 'int32' },
    GetLastError: { arguments: [], return: 'uint32' },
  })
  const win = library.functions
  let snapshot = 0xff_ff_ff_ff_ff_ff_ff_ffn
  try {
    snapshot = win.CreateToolhelp32Snapshot(2, 0) // TH32CS_SNAPPROCESS
    if (snapshot === 0xff_ff_ff_ff_ff_ff_ff_ffn) {
      throw new Error('Process snapshot failed: ' + win.GetLastError())
    }
    // PROCESSENTRY32W has an eight-byte heap pointer on x64 and ARM64.
    // Its UTF-16 executable name starts at byte 44; alignment makes sizeof 568.
    const entry = Buffer.alloc(568)
    entry.writeUInt32LE(entry.length)
    const rows: ProcessRow[] = []
    let present = win.Process32FirstW(snapshot, entry)
    while (present) {
      rows.push({
        ProcessId: entry.readUInt32LE(8),
        ParentProcessId: entry.readUInt32LE(32),
        Name: entry.toString('utf16le', 44, 564).split('\0')[0],
      })
      present = win.Process32NextW(snapshot, entry)
    }
    const error = win.GetLastError()
    if (error !== 18) {
      // ERROR_NO_MORE_FILES
      throw new Error('Process enumeration failed: ' + error)
    }
    return rows
  } finally {
    if (snapshot !== 0xff_ff_ff_ff_ff_ff_ff_ffn) {
      win.CloseHandle(snapshot)
    }
    library.lib.close()
  }
}
