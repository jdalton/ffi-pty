import { spawnSync } from 'node:child_process'
import { repositoryRoot } from '../paths/repository.mts'

export function runCommands(commands: string[][], execute = spawnSync): void {
  for (const args of commands) {
    const result = execute('pnpm', args, {
      cwd: repositoryRoot,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    })
    if (result.error) {
      throw result.error
    }
    if (result.status !== 0) {
      throw new Error(
        `pnpm ${args.join(' ')} failed (${result.status ?? result.signal})`,
      )
    }
  }
}
