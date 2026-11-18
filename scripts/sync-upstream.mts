import { formatUpstream } from './fmt/upstream.mts'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { prepareUpstream } from './upstream-checkout.mts'
import {
  inventoryUpstream,
  extractQuotingCases,
} from './upstream-inventory.mts'
import { upstreamPaths, upstreamRepository } from '../paths/upstream.mts'
import { repositoryRoot } from '../paths/repository.mts'

export function syncUpstream(root = repositoryRoot, prepare = prepareUpstream) {
  const revision = prepare(root)
  const paths = upstreamPaths(root)
  mkdirSync(paths.fixtures, { recursive: true })
  const files = inventoryUpstream(paths.checkout)
  for (const file of files) {
    const destination = join(paths.fixtures, 'original', file.file + '.txt')
    mkdirSync(resolve(destination, '..'), { recursive: true })
    writeFileSync(destination, readFileSync(join(paths.checkout, file.file)))
  }
  writeFileSync(
    paths.inventory,
    JSON.stringify(
      { repository: upstreamRepository, revision, files },
      null,
      2,
    ) + '\n',
  )
  writeFileSync(
    join(paths.fixtures, 'command-line.json'),
    JSON.stringify(
      extractQuotingCases(
        readFileSync(
          join(paths.checkout, 'src/windowsPtyAgent.test.ts'),
          'utf8',
        ),
      ),
      null,
      2,
    ) + '\n',
  )
  const declaration = readFileSync(
    join(paths.checkout, 'typings/node-pty.d.ts'),
    'utf8',
  )
    .replace("declare module 'node-pty' {\n", '')
    .replace(/\n}\s*$/, '\n')
    .replace(/^  /gm, '')
  writeFileSync(
    join(root, 'test/fixtures/node-pty.d.mts'),
    `/* oxlint-disable typescript/no-explicit-any -- Preserve upstream's contract. */\n// node-pty public contract at ${revision}.\n${declaration}`,
  )
  const license = join(paths.fixtures, 'LICENSE')
  if (existsSync(join(paths.checkout, 'LICENSE'))) {
    writeFileSync(license, readFileSync(join(paths.checkout, 'LICENSE')))
  }
  formatUpstream(root)
  return { revision, cases: files.flatMap(file => file.cases).length }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  if (process.argv.length > 2) {
    throw new Error('Usage: pnpm run upstream:sync')
  }
  const result = syncUpstream()
  console.log(
    `Synced ${result.cases} upstream test cases at ${result.revision}; review the coverage map before committing.`,
  )
}
