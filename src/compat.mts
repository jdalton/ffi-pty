import { createRequire } from 'node:module'
import { bindAbortSignal } from './abort.mts'
import type * as UnixOpen from './unix-open.mts'
import type { OpenOptions } from './unix-open.mts'
import { loadPlatformBackend } from './pty.mts'
import {
  CompatibleTerminal,
  type CompatibleBackend,
} from './compat-terminal.mts'
import {
  normalizeCompatibleOptions,
  type IWindowsPtyForkOptions,
} from './compat-options.mts'
import type { SpawnOptions } from './contract.mts'

export function spawn(
  file?: string,
  args?: string[] | string,
  options?: IWindowsPtyForkOptions,
): CompatibleTerminal {
  const config = normalizeCompatibleOptions(file, args, options)
  const platform = loadPlatformBackend() as {
    createBackend(options: SpawnOptions): Promise<CompatibleBackend>
    createCompatibleBackend?(
      options: SpawnOptions,
    ): CompatibleBackend | Promise<CompatibleBackend>
    createBackendSync?(options: SpawnOptions): CompatibleBackend
  }
  const terminal = new CompatibleTerminal(config, () =>
    platform.createCompatibleBackend
      ? platform.createCompatibleBackend(config.spawn)
      : platform.createBackendSync
        ? platform.createBackendSync(config.spawn)
        : platform.createBackend(config.spawn),
  )
  bindAbortSignal(config.signal, () => terminal.close(), terminal.exited)
  return terminal
}
export const fork = spawn
export const createTerminal = spawn
export { CompatibleTerminal } from './compat-terminal.mts'
export type {
  IPty,
  IEvent,
  IDisposable,
  CompatibleExit,
} from './compat-terminal.mts'
export type {
  IBasePtyForkOptions,
  IPtyForkOptions,
  IWindowsPtyForkOptions,
} from './compat-options.mts'

export function open(
  options?: OpenOptions,
): ReturnType<typeof UnixOpen.openUnixPty> {
  const { openUnixPty } = createRequire(import.meta.url)(
    './unix-open.mts',
  ) as typeof UnixOpen
  return openUnixPty(options)
}
