import type { BrokerRequest } from './windows-protocol.mts'

export interface ConsoleControls {
  ConptyClearPseudoConsole?(console: bigint, keepCursorRow: number): number
  ConptyReparentPseudoConsole?(console: bigint, parent: bigint): number
}
export function validateWindowHandle(handle: Buffer): void {
  if (!Buffer.isBuffer(handle) || handle.length !== 8) {
    throw new TypeError(
      'hwnd must be a Buffer the size of an HWND (8-byte Buffer)',
    )
  }
}
export function reparentConsole(
  native: ConsoleControls,
  console: bigint,
  handle: Buffer,
): boolean {
  validateWindowHandle(handle)
  if (!console || !native.ConptyReparentPseudoConsole) return false
  return (
    native.ConptyReparentPseudoConsole(console, handle.readBigUInt64LE()) >= 0
  )
}
export function runConsoleControl(
  native: ConsoleControls,
  console: bigint,
  request: Extract<BrokerRequest, { type: 'command' }>,
): boolean {
  if (request.command === 'clear') {
    const result = native.ConptyClearPseudoConsole?.(console, 0) ?? 0
    if (result < 0) {
      throw new Error(`ConptyClearPseudoConsole failed with HRESULT ${result}`)
    }
    return true
  }
  if (request.command === 'reparent') {
    if (!reparentConsole(native, console, Buffer.from(request.handle))) {
      throw new Error('ConPTY rejected parent window')
    }
    return true
  }
  return false
}
