import { checkCompatibleType } from './compat-validation.mts'
import { validateAbortSignal } from './abort.mts'
import { prepareBundledConpty } from './win32/conpty-assets.mts'
import { normalizeSpawnOptions, validateNativeString } from './validation.mts'
import type { SpawnOptions } from './contract.mts'

export interface IBasePtyForkOptions {
  name?: string | undefined
  cols?: number | undefined
  rows?: number | undefined
  cwd?: string | undefined
  env?: Record<string, string | undefined> | undefined
  encoding?: string | null | undefined
  handleFlowControl?: boolean | undefined
  flowControlPause?: string | undefined
  flowControlResume?: string | undefined
  signal?: AbortSignal
}
export interface IPtyForkOptions extends IBasePtyForkOptions {
  uid?: number | undefined
  gid?: number | undefined
}
export interface IWindowsPtyForkOptions extends IPtyForkOptions {
  useConpty?: boolean | undefined
  useConptyDll?: boolean | undefined
  conptyInheritCursor?: boolean | undefined
}
export interface CompatibleOptions {
  spawn: SpawnOptions
  encoding: BufferEncoding | null
  name: string
  handleFlowControl: boolean
  flowControlPause: string
  flowControlResume: string
  signal?: AbortSignal
}

export function normalizeCompatibleOptions(
  file: string | undefined,
  args: string[] | string | undefined,
  input: IWindowsPtyForkOptions = {},
  platform: string = process.platform,
): CompatibleOptions {
  if (!input || typeof input !== 'object') {
    throw new TypeError('Invalid options')
  }
  validateAbortSignal(input.signal)
  for (const [name, type] of Object.entries({
    name: 'string',
    cols: 'number',
    rows: 'number',
    cwd: 'string',
    env: 'object',
    uid: 'number',
    gid: 'number',
    encoding: 'string',
  })) {
    checkCompatibleType(
      name,
      input[name as keyof IWindowsPtyForkOptions] || undefined,
      type,
    )
  }
  if (Array.isArray(args)) checkCompatibleType('args', args, 'string', true)
  const windows = platform === 'win32'
  const env = compatibleEnvironment(input.env, windows)
  const name = input.name || env.TERM || (windows ? 'Windows Shell' : 'xterm')
  validateNativeString(name, 'name')
  if (!windows) {
    env.TERM = name
    env.PWD = input.cwd || process.cwd()
  }
  const encoding = compatibleEncoding(input.encoding, windows)
  validateCredentials(input)
  const spawn = compatibleSpawnOptions(file, args, input, windows, env)
  applyPlatformOptions(spawn, input, windows)
  const pause = input.flowControlPause || '\x13'
  const resume = input.flowControlResume || '\x11'
  validateNativeString(pause, 'flowControlPause')
  validateNativeString(resume, 'flowControlResume')
  return {
    spawn,
    encoding,
    name,
    handleFlowControl: !!input.handleFlowControl,
    flowControlPause: pause,
    flowControlResume: resume,
    signal: input.signal,
  }
}

export function compatibleEnvironment(
  source: IPtyForkOptions['env'],
  windows: boolean,
): Record<string, string> {
  const env: Record<string, string> = {}
  const inherited = source ?? process.env
  for (const [key, value] of Object.entries(inherited)) {
    if (value !== undefined) env[key] = value
  }
  if (!windows && inherited === process.env) {
    for (const key of [
      'TMUX',
      'TMUX_PANE',
      'STY',
      'WINDOW',
      'WINDOWID',
      'TERMCAP',
      'COLUMNS',
      'LINES',
    ]) {
      delete env[key]
    }
  }
  return env
}

export function compatibleEncoding(
  value: IPtyForkOptions['encoding'],
  _windows: boolean,
): BufferEncoding | null {
  const encoding = value === undefined ? 'utf8' : value
  if (encoding !== null && !Buffer.isEncoding(encoding)) {
    throw new TypeError('Unknown encoding')
  }
  return encoding
}
export function validateCredentials(input: IPtyForkOptions): void {
  for (const key of ['uid', 'gid'] as const) {
    const value = input[key]
    if (
      value !== undefined &&
      (!Number.isInteger(value) || value < -1 || value > 0xff_ff_ff_fe)
    ) {
      throw new TypeError(`Invalid ${key}`)
    }
  }
}
export function applyPlatformOptions(
  spawn: SpawnOptions,
  input: IWindowsPtyForkOptions,
  windows: boolean,
): void {
  if (!windows) {
    if (input.uid !== undefined && input.uid !== -1) spawn.uid = input.uid
    if (input.gid !== undefined && input.gid !== -1) spawn.gid = input.gid
    return
  }
  if (input.useConptyDll) spawn.conptyDll = prepareBundledConpty()
  if (input.conptyInheritCursor) spawn.conptyInheritCursor = true
}

export function compatibleSpawnOptions(
  file: string | undefined,
  args: string[] | string | undefined,
  input: IWindowsPtyForkOptions,
  windows: boolean,
  env: Record<string, string>,
): SpawnOptions {
  file ||= windows ? 'cmd.exe' : 'sh'
  args ??= []
  if (typeof args === 'string' && !windows) {
    throw new TypeError('args as a string is not supported on Unix')
  }
  const spawn = normalizeSpawnOptions(
    file,
    typeof args === 'string' ? [] : args,
    {
      cols: input.cols || 80,
      rows: input.rows || 24,
      cwd: input.cwd || process.cwd(),
      env,
    },
  )
  if (typeof args === 'string') {
    validateNativeString(args, 'args')
    spawn.commandLine = args
  }
  if (windows && !Object.hasOwn(env, 'TERM')) delete spawn.env.TERM
  return spawn
}
