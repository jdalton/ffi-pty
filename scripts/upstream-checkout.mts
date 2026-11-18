import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { repositoryRoot } from '../paths/repository.mts'
import {
  upstreamPaths,
  upstreamRepository,
  upstreamRelative,
} from '../paths/upstream.mts'

/**
 * Initialize lazily when update or test sync needs upstream; never during setup
 * or test execution.
 */
export function prepareUpstream(
  root = repositoryRoot,
  execute = execFileSync,
  exists = existsSync,
): string {
  const paths = upstreamPaths(root)
  const git = (args: string[], cwd = root) =>
    execute('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
      .toString()
      .trim()
  const index = git(['ls-files', '--stage', '--', upstreamRelative])
  const match = /^160000 ([a-f0-9]{40}) 0\t/.exec(index)
  if (!match) {
    throw new Error('node-pty must be registered as a pinned submodule')
  }
  git(['submodule', 'init', '--', upstreamRelative])
  const restoring = !exists(resolve(paths.checkout, '.git'))
  if (restoring) {
    if (exists(paths.checkout) && readdirSync(paths.checkout).length) {
      throw new Error(
        'Upstream checkout contains untracked files; preserve them before syncing',
      )
    }
    const gitdir = resolve(
      root,
      git(['rev-parse', '--git-path', `modules/${upstreamRelative}`]),
    )
    if (exists(gitdir)) {
      // Deinitializing removes the checkout, but Git keeps its objects. Reuse
      // them without fetching or expanding the sparse checkout.
      mkdirSync(paths.checkout, { recursive: true })
      writeFileSync(resolve(paths.checkout, '.git'), `gitdir: ${gitdir}\n`)
      git(['config', 'core.worktree', paths.checkout], paths.checkout)
    } else {
      mkdirSync(dirname(gitdir), { recursive: true })
      git([
        'clone',
        '--depth',
        '1',
        '--filter=blob:none',
        '--no-checkout',
        `--separate-git-dir=${gitdir}`,
        upstreamRepository,
        paths.checkout,
      ])
    }
  } else if (git(['status', '--porcelain'], paths.checkout)) {
    throw new Error(
      'Upstream checkout has local changes; preserve them before syncing',
    )
  }
  git(
    ['sparse-checkout', 'set', '--cone', 'src', 'typings', 'fixtures'],
    paths.checkout,
  )
  const revision = match[1]
  try {
    git(['cat-file', '-e', `${revision}^{commit}`], paths.checkout)
  } catch {
    git(
      ['fetch', '--depth', '1', '--filter=blob:none', 'origin', revision],
      paths.checkout,
    )
  }
  git(
    ['checkout', '--detach', ...(restoring ? ['--force'] : []), revision],
    paths.checkout,
  )
  return revision
}
