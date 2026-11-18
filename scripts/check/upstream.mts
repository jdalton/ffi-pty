import { readFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { upstreamPaths } from '../../paths/upstream.mts'
import type { UpstreamFile } from '../upstream-inventory.mts'

export function checkUpstream(root?: string): void {
  const paths = upstreamPaths(root)
  const { files } = JSON.parse(readFileSync(paths.inventory, 'utf8')) as {
    files: UpstreamFile[]
  }
  const reviewed = JSON.parse(
    readFileSync(join(paths.fixtures, 'reviewed.json'), 'utf8'),
  ) as Record<string, string>
  if (Object.keys(reviewed).length !== files.length) {
    throw new Error('Upstream test files changed; review their adaptations')
  }
  for (const file of files) {
    const hash = createHash('sha256')
      .update(
        readFileSync(join(paths.fixtures, 'original', file.file + '.txt')),
      )
      .digest('hex')
    if (reviewed[file.file] !== file.sha256 || hash !== file.sha256) {
      throw new Error(`Upstream assertions changed; review ${file.file}`)
    }
    if (
      file.cases.length &&
      !existsSync(
        join(paths.fixtures, file.file.replace('.test.ts', '.test.mts')),
      )
    ) {
      throw new Error(`Missing upstream adaptation: ${file.file}`)
    }
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  checkUpstream()
}
