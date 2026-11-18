import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { repositoryRoot } from '../../paths/repository.mts'
import { upstreamPaths } from '../../paths/upstream.mts'

export function formatUpstream(
  root = repositoryRoot,
  execute = execFileSync,
): void {
  const paths = upstreamPaths(root)
  const formatter = join(
    dirname(createRequire(import.meta.url).resolve('oxfmt/package.json')),
    'bin/oxfmt',
  )
  const args = [
    formatter,
    '--config',
    join(repositoryRoot, '.config/oxfmtrc.json'),
    paths.inventory,
    join(paths.fixtures, 'command-line.json'),
    join(root, 'test/fixtures/node-pty.d.mts'),
  ]
  // The pinned formatter normalizes imported JSDoc over two passes. Keep the
  // generated declaration stable so a sync does not leave format:check failing.
  for (let pass = 0; pass < 2; pass++) {
    execute(process.execPath, args, { cwd: root, stdio: 'pipe' })
  }
}
