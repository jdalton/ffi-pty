import { dlopen } from 'node:ffi'

// Bind only after the caller has checked that direct Windows FFI is supported.
let bindings: any
export function initializeWindowsBindings(load = dlopen) {
  if (bindings) return bindings
  bindings = load('kernel32.dll', {
    CreateNamedPipeW: {
      arguments: [
        'pointer',
        'uint32',
        'uint32',
        'uint32',
        'uint32',
        'uint32',
        'uint32',
        'pointer',
      ],
      return: 'pointer',
    },
    CreatePipe: {
      arguments: ['pointer', 'pointer', 'pointer', 'uint32'],
      return: 'int32',
    },
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
    GetNamedPipeInfo: {
      arguments: ['pointer', 'pointer', 'pointer', 'pointer', 'pointer'],
      return: 'int32',
    },
    PeekNamedPipe: {
      arguments: [
        'pointer',
        'pointer',
        'uint32',
        'pointer',
        'pointer',
        'pointer',
      ],
      return: 'int32',
    },
    ConnectNamedPipe: { arguments: ['pointer', 'pointer'], return: 'int32' },
    CreatePseudoConsole: {
      arguments: ['uint32', 'pointer', 'pointer', 'uint32', 'pointer'],
      return: 'int32',
    },
    ClosePseudoConsole: { arguments: ['pointer'], return: 'void' },
    ResizePseudoConsole: { arguments: ['pointer', 'uint32'], return: 'int32' },
    InitializeProcThreadAttributeList: {
      arguments: ['pointer', 'uint32', 'uint32', 'pointer'],
      return: 'int32',
    },
    UpdateProcThreadAttribute: {
      arguments: [
        'pointer',
        'uint32',
        'uint64',
        'pointer',
        'uint64',
        'pointer',
        'pointer',
      ],
      return: 'int32',
    },
    DeleteProcThreadAttributeList: { arguments: ['pointer'], return: 'void' },
    CreateProcessW: {
      arguments: [
        'pointer',
        'pointer',
        'pointer',
        'pointer',
        'int32',
        'uint32',
        'pointer',
        'pointer',
        'pointer',
        'pointer',
      ],
      return: 'int32',
    },
    WaitForSingleObject: { arguments: ['pointer', 'uint32'], return: 'uint32' },
    GetExitCodeProcess: { arguments: ['pointer', 'pointer'], return: 'int32' },
    TerminateProcess: { arguments: ['pointer', 'uint32'], return: 'int32' },
    CreateJobObjectW: { arguments: ['pointer', 'pointer'], return: 'pointer' },
    SetInformationJobObject: {
      arguments: ['pointer', 'int32', 'pointer', 'uint32'],
      return: 'int32',
    },
    TerminateJobObject: { arguments: ['pointer', 'uint32'], return: 'int32' },
    OpenThread: { arguments: ['uint32', 'int32', 'uint32'], return: 'pointer' },
    CancelSynchronousIo: { arguments: ['pointer'], return: 'int32' },
    GetCurrentThreadId: { arguments: [], return: 'uint32' },
    CloseHandle: { arguments: ['pointer'], return: 'int32' },
    GetLastError: { arguments: [], return: 'uint32' },
    GetCurrentProcess: { arguments: [], return: 'pointer' },
    GetProcessHandleCount: {
      arguments: ['pointer', 'pointer'],
      return: 'int32',
    },
  }).functions
  return bindings
}

export function getWindowsBindings() {
  if (!bindings) throw new Error('Win32 bindings have not been initialized')
  return bindings
}

export const INVALID_HANDLE_VALUE = 0xff_ff_ff_ff_ff_ff_ff_ffn

export function utf16(value: string, terminate = true): Buffer {
  if (value.includes('\0')) throw new Error('NUL in Windows string')
  return Buffer.from(value + (terminate ? '\0' : ''), 'utf16le')
}

export function lastError(operation: string): Error {
  if (!bindings) {
    return new Error(
      `${operation} failed before Win32 bindings were initialized`,
    )
  }
  return new Error(
    `${operation} failed with Win32 error ${bindings.GetLastError()}`,
  )
}

export function getProcessHandleCount(): number {
  const native = getWindowsBindings()
  const count = Buffer.alloc(4)
  if (!native.GetProcessHandleCount(native.GetCurrentProcess(), count)) {
    throw new Error(
      `GetProcessHandleCount failed with Win32 error ${native.GetLastError()}`,
    )
  }
  return count.readUInt32LE()
}

/**
 * Keep the DLL loaded for the session; its handles must be resized and closed
 * by the same library that created them, rather than kernel32's implementation.
 */
export function withBundledConpty(native: any, path: string, load = dlopen) {
  const library = load(path, {
    ConptyClearPseudoConsole: {
      arguments: ['pointer', 'int32'],
      return: 'int32',
    },
    ConptyReparentPseudoConsole: {
      arguments: ['pointer', 'pointer'],
      return: 'int32',
    },
    ConptyCreatePseudoConsole: {
      arguments: ['uint32', 'pointer', 'pointer', 'uint32', 'pointer'],
      return: 'int32',
    },
    ConptyResizePseudoConsole: {
      arguments: ['pointer', 'uint32'],
      return: 'int32',
    },
    ConptyClosePseudoConsole: { arguments: ['pointer'], return: 'void' },
  })
  return {
    ...native,
    conptyLibrary: library,
    ConptyClearPseudoConsole: library.functions.ConptyClearPseudoConsole,
    ConptyReparentPseudoConsole: library.functions.ConptyReparentPseudoConsole,
    CreatePseudoConsole: library.functions.ConptyCreatePseudoConsole,
    ResizePseudoConsole: library.functions.ConptyResizePseudoConsole,
    ClosePseudoConsole: library.functions.ConptyClosePseudoConsole,
  }
}
