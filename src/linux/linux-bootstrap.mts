import { fileURLToPath } from 'node:url'
import { dlopen } from 'node:ffi'
import { recoverTargetEnvironment } from '../unix-environment.mts'
import { consumeCredentials } from '../unix-credentials.mts'

export function execLinuxTarget(args: string[], env: NodeJS.ProcessEnv): never {
  const [executable, argv0, ...targetArgs] = consumeCredentials(args)
  if (!executable || !argv0) {
    throw new Error('Invalid Linux bootstrap arguments')
  }
  const { functions } = dlopen('libc.so.6', {
    signal: { arguments: ['int32', 'pointer'], return: 'pointer' },
  })
  functions.signal(13, 0n)
  functions.signal(25, 0n)
  process.execve!(
    executable,
    [argv0, ...targetArgs],
    recoverTargetEnvironment(env),
  )
  throw new Error('execve returned unexpectedly')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    execLinuxTarget(process.argv.slice(2), process.env)
  } catch (error) {
    process.stderr.write(`PTY child startup failed: ${String(error)}\n`)
    process.exitCode = 127
  }
}
