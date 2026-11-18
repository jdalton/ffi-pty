import { createWindowsCompatibilityBackend } from './windows-compat.mts'
import type { SpawnOptions } from '../contract.mts'
import { createWindowsController, dimensions } from './windows-controller.mts'
import {
  buildWindowsCommandLine,
  buildWindowsEnvironmentBlock,
} from './windows-commandline.mts'
import { createWindowsTransport } from './windows-selection.mts'
export { createWindowsTransport }
export {
  asError,
  dimensions,
  windowsSignalNumber,
} from './windows-controller.mts'
export { promiseWithTimeout } from './windows-timeout.mts'
export type { Backend, SpawnOptions } from '../contract.mts'

export async function createBackend(options: SpawnOptions) {
  if (process.platform !== 'win32') {
    throw new Error('Windows ConPTY backend requires Windows')
  }
  if (process.arch !== 'x64' && process.arch !== 'arm64') {
    throw new Error(`Unsupported Windows architecture: ${process.arch}`)
  }
  dimensions(options.cols, options.rows)
  if (
    !options.file ||
    options.file.includes('\0') ||
    options.cwd.includes('\0')
  ) {
    throw new Error('Invalid executable path or cwd')
  }
  buildWindowsCommandLine(options.file, options.args)
  buildWindowsEnvironmentBlock(options.env)

  return createWindowsController(
    options,
    await createWindowsTransport(
      undefined,
      undefined,
      Boolean(options.conptyInheritCursor || options.conptyDll),
    ),
  )
}

export function createCompatibleBackend(options: SpawnOptions) {
  return options.conptyDll
    ? createWindowsCompatibilityBackend(options)
    : createBackend(options)
}
