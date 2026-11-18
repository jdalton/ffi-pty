import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { repositoryRoot } from '../../paths/repository.mts'
import { upstreamPaths, upstreamRelative } from '../../paths/upstream.mts'
import { prepareUpstream } from '../upstream-checkout.mts'
import { syncUpstream } from '../sync-upstream.mts'

export function updateUpstream(
  root = repositoryRoot,
  prepare = prepareUpstream,
  execute = execFileSync,
  sync = syncUpstream,
) {
  prepare(root)
  const { checkout } = upstreamPaths(root)
  const git = (args: string[], cwd = checkout) =>
    execute('git', args, { cwd, encoding: 'utf8' }).toString().trim()
  git(['fetch', '--depth', '1', '--filter=blob:none', 'origin', 'main'])
  const revision = git(['rev-parse', 'FETCH_HEAD'])
  git(['checkout', '--detach', revision])
  // Import first: a failed sync must not stage an unreviewed upstream pin.
  const result = sync(root, () => revision)
  git(['add', '--', upstreamRelative], root)
  return result
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const result = updateUpstream()
  console.log(
    `Updated upstream tests to ${result.revision}; review imported assertions before committing.`,
  )
}
