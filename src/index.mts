export {
  spawnPty as spawn,
  spawnPty,
  createPtyFromBackend,
  normalizeSpawnOptions,
  validateDimension,
  validateNativeString,
} from './pty.mts'
export { spawn as spawnSync, CompatibleTerminal, open } from './compat.mts'
export type {
  Backend,
  ExitStatus,
  FfiPty,
  SpawnOptions,
  SpawnOptionsInput,
} from './contract.mts'
export type {
  IBasePtyForkOptions,
  IPtyForkOptions,
  IWindowsPtyForkOptions,
} from './compat-options.mts'
