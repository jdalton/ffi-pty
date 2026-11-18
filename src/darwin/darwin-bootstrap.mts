import { consumeCredentials } from '../unix-credentials.mts'
import { recoverTargetEnvironment } from '../unix-environment.mts'
import { dlopen, getInt32 } from 'node:ffi'
import { execWithStartup, reportStartupFailure } from './darwin-startup.mts'
import { fileURLToPath } from 'node:url'

export function loginControllingTerminal(): void {
  const { functions } = dlopen('/usr/lib/libSystem.B.dylib', {
    login_tty: { arguments: ['int32'], return: 'int32' },
    __error: { arguments: [], return: 'pointer' },
  })
  if (functions.login_tty(0) !== 0) {
    throw new Error(
      `login_tty failed with errno ${getInt32(functions.__error())}`,
    )
  }
}

export function resetIgnoredSignals(): void {
  const { functions } = dlopen('/usr/lib/libSystem.B.dylib', {
    signal: { arguments: ['int32', 'pointer'], return: 'pointer' },
  })
  // Node ignores SIGPIPE and SIGXFSZ. Exec preserves ignored dispositions.
  functions.signal(13, 0n)
  functions.signal(25, 0n)
}

export function execTarget(argv: string[], env: NodeJS.ProcessEnv): never {
  const [executable, argv0, ...args] = consumeCredentials(argv)
  if (!executable || !argv0) {
    throw new Error('Invalid Darwin PTY bootstrap arguments')
  }
  resetIgnoredSignals()
  const targetEnv = recoverTargetEnvironment(env)
  return execWithStartup(executable, [argv0, ...args], targetEnv)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    loginControllingTerminal()
    execTarget(process.argv.slice(2), process.env)
  } catch (error) {
    reportStartupFailure(error)
    process.stderr.write(
      `PTY child bootstrap failed: ${error instanceof Error ? error.message : String(error)}\n`,
    )
    process.exitCode = 127
  }
}
