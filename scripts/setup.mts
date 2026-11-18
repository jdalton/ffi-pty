import { repositoryRoot } from '../paths/repository.mts'
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, realpathSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export function installHooks(root = repositoryRoot, run = spawnSync) {
  // Native realpath expands Windows short (8.3) paths returned by temp directories.
  root = realpathSync.native(root)
  const git = (...args: string[]) =>
    run('git', args, { cwd: root, encoding: 'utf8' })
  const repository = git('rev-parse', '--show-toplevel')
  if (
    repository.status !== 0 ||
    relative(root, realpathSync.native(repository.stdout.trim())) !== ''
  ) {
    return false
  }
  const configured = git('config', '--get', 'core.hooksPath')
  if (!new Set<number | null>([0, 1]).has(configured.status)) {
    throw new Error(configured.stderr || 'Cannot read Git hook configuration')
  }
  const current = configured.stdout.trim()
  if (current && current !== '.githooks') {
    throw new Error(
      `Preserving existing hooksPath: ${current}. Integrate .githooks/pre-push manually.`,
    )
  }
  if (!current) {
    const directory = git('rev-parse', '--git-path', 'hooks')
    if (directory.status !== 0) {
      throw new Error('Cannot locate Git hooks')
    }
    const hooks = resolve(root, directory.stdout.trim())
    if (
      existsSync(hooks) &&
      readdirSync(hooks).some(name => !name.endsWith('.sample'))
    ) {
      throw new Error(
        'Existing Git hooks need manual integration; no hooks were replaced.',
      )
    }
  }
  const result = git('config', '--local', 'core.hooksPath', '.githooks')
  if (result.status !== 0) {
    throw new Error(result.stderr || 'Cannot install Git hooks')
  }
  return true
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  installHooks()
}
