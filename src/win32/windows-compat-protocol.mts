import type { ExitStatus } from '../contract.mts'
export type CompatibilityRequest =
  | { type: 'start' | 'pause' | 'resume' }
  | { type: 'parent'; handle: Uint8Array; response: SharedArrayBuffer }
  | { type: 'command'; id: number; operation: string; args: unknown[] }
export type CompatibilityReply =
  | { type: 'ready'; pid: number }
  | { type: 'data'; data: Uint8Array }
  | { type: 'end' }
  | { type: 'exit'; status: ExitStatus }
  | { type: 'error'; error: string }
  | { type: 'ack'; id: number; error?: string }
