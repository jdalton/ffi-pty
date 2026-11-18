import type { Readable } from 'node:stream'

export interface ExitStatus {
  exitCode: number | null
  signal: number
}

export interface SpawnOptions {
  file: string
  parentWindow?: Buffer | undefined
  conptyDll?: string | undefined
  commandLine?: string | undefined
  uid?: number | undefined
  gid?: number | undefined
  conptyInheritCursor?: boolean | undefined
  args: string[]
  cols: number
  rows: number
  cwd: string
  env: Record<string, string>
}

export interface SpawnOptionsInput {
  cols?: number | undefined
  rows?: number | undefined
  cwd?: string | undefined
  env?: Record<string, string> | undefined
  encoding?: 'utf8' | undefined
  signal?: AbortSignal | undefined
  uid?: never | undefined
  gid?: never | undefined
  pixelWidth?: never | undefined
  pixelHeight?: never | undefined
  useConptyDll?: never | undefined
  conptyInheritCursor?: never | undefined
  [key: string]: unknown
}

export interface Backend {
  pid: number
  readable: Readable
  clear?(): Promise<void>
  reparent?(handle: Buffer): Promise<void>
  write(data: Buffer): Promise<void>
  resize(cols: number, rows: number): Promise<void>
  kill(signal?: string): Promise<void>
  close(): Promise<void>
  exited: Promise<ExitStatus>
}

export interface FfiPty {
  readonly pid: number
  readonly cols: number
  readonly rows: number
  readonly exited: Promise<ExitStatus>
  onData(listener: (data: string) => void): { dispose(): void }
  onExit(listener: (status: ExitStatus) => void): { dispose(): void }
  write(data: string | Buffer): Promise<void>
  resize(cols: number, rows: number): Promise<void>
  kill(signal?: string): Promise<void>
  pause(): void
  resume(): void
  close(): Promise<void>
  [Symbol.asyncIterator](): AsyncIterableIterator<string>
}
