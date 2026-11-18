import type { SpawnOptions } from '../contract.mts'

export type BrokerRequest =
  | { type: 'start'; options: SpawnOptions }
  | { type: 'connected' }
  | { type: 'abort'; error?: string }
  | {
      type: 'command'
      id: number
      command: 'resize'
      cols: number
      rows: number
    }
  | { type: 'command'; id: number; command: 'kill'; signal: number }
  | { type: 'command'; id: number; command: 'close' }
  | { type: 'command'; id: number; command: 'clear' }
  | { type: 'command'; id: number; command: 'reparent'; handle: Buffer }

export type BrokerReply =
  | { type: 'startupPhase'; phase: string }
  | { type: 'pipes'; input: string; output: string }
  | { type: 'spawned'; pid: number }
  | { type: 'ack'; id: number; error?: string }
  | { type: 'exited'; exitCode: number; signal: number }
  | { type: 'error'; error: string }
  | { type: 'brokerDone' }
