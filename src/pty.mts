import { createRequire } from 'node:module'
import { abortReason, bindAbortSignal, validateAbortSignal } from './abort.mts'
import type { Backend, FfiPty, SpawnOptionsInput } from './contract.mts'
import { createPtyFromBackend } from './events.mts'
import { normalizeSpawnOptions } from './validation.mts'

const require = createRequire(import.meta.url)
const supportedPlatforms = new Set(['darwin', 'linux', 'win32'])
const supportedArchitectures = new Set(['x64', 'arm64'])

export async function spawnPty(
  file: string,
  args: string[],
  options: SpawnOptionsInput = {},
): Promise<FfiPty> {
  const { signal, ...nativeOptions } = options
  validateAbortSignal(signal)
  if (signal?.aborted) throw abortReason(signal)
  const normalized = normalizeSpawnOptions(file, args, nativeOptions)
  const platform = loadPlatformBackend()
  const backendPromise = platform.createBackend(normalized)
  if (!signal) {
    const backend = await backendPromise
    return createPtyFromBackend(backend, normalized.cols, normalized.rows)
  }

  let abortListener!: () => void
  let backend: Backend | undefined
  let closeStarted = false
  const closeBackend = (value: Backend) => {
    if (closeStarted) return Promise.resolve()
    closeStarted = true
    return value.close()
  }
  const aborted = new Promise<never>((_resolve, reject) => {
    abortListener = () => reject(abortReason(signal))
    signal.addEventListener('abort', abortListener, { once: true })
  })
  try {
    backend = await Promise.race([backendPromise, aborted])
    if (signal.aborted) {
      await closeBackend(backend)
      backend = undefined
      throw abortReason(signal)
    }
    const terminal = createPtyFromBackend(
      backend,
      normalized.cols,
      normalized.rows,
    )
    backend = undefined
    bindAbortSignal(signal, () => terminal.close(), terminal.exited)
    return terminal
  } catch (error) {
    if (signal.aborted) {
      if (backend) void closeBackend(backend).catch(() => {})
      else if (!closeStarted) {
        void backendPromise.then(closeBackend).catch(() => {})
      }
      throw abortReason(signal)
    }
    throw error
  } finally {
    signal.removeEventListener('abort', abortListener)
  }
}

export function loadPlatformBackend(
  version = process.versions.node,
  os: string = process.platform,
  arch: string = process.arch,
  load: (name: string) => unknown = require,
) {
  const [major, minor] = version.split('.').map(Number)
  if (major < 26 || (major === 26 && minor < 4)) {
    throw new Error('ffi-pty requires Node.js 26.4 or newer')
  }
  if (!supportedPlatforms.has(os) || !supportedArchitectures.has(arch)) {
    throw new Error(`Unsupported FFI PTY platform: ${os}-${arch}`)
  }
  const backendFiles = {
    darwin: './darwin/darwin.mts',
    linux: './linux/linux.mts',
    win32: './win32/windows.mts',
  }
  const moduleName = backendFiles[os as keyof typeof backendFiles]
  let platform: {
    createBackend(
      options: ReturnType<typeof normalizeSpawnOptions>,
    ): Promise<Backend>
  }
  try {
    platform = load(moduleName) as typeof platform
  } catch (error) {
    throw new Error(`FFI PTY backend unavailable for ${os}`, {
      cause: error,
    })
  }
  return platform
}

export { createPtyFromBackend } from './events.mts'
export {
  normalizeSpawnOptions,
  validateDimension,
  validateNativeString,
} from './validation.mts'
export type {
  Backend,
  ExitStatus,
  FfiPty,
  SpawnOptions,
  SpawnOptionsInput,
} from './contract.mts'
