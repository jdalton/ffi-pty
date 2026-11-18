import { spawnSync } from 'node:child_process'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  mkdtempSync,
  mkdirSync,
  cpSync,
  readFileSync,
  writeFileSync,
  rmSync,
  readdirSync,
  renameSync,
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { syncUpstream } from '../../scripts/sync-upstream.mts'

test('test synchronization uses deferred checkout preparation and preserves all upstream sources and assertions', () => {
  const root = mkdtempSync(join(tmpdir(), 'upstream-sync-'))
  try {
    const checkout = join(root, 'upstream/node-pty')
    cpSync(
      new URL('../upstream/node-pty/original/', import.meta.url),
      checkout,
      { recursive: true },
    )
    for (const file of readdirSync(join(checkout, 'src'))) {
      renameSync(
        join(checkout, 'src', file),
        join(checkout, 'src', file.replace(/\.txt$/, '')),
      )
    }
    mkdirSync(join(checkout, 'typings'))
    mkdirSync(join(root, 'test/fixtures'), { recursive: true })
    writeFileSync(
      join(checkout, 'typings/node-pty.d.ts'),
      "declare module 'node-pty' {\n  export const fixture: string;\n}\n",
    )
    writeFileSync(join(checkout, 'LICENSE'), 'MIT fixture')
    let prepared = 0
    const result = syncUpstream(root, actual => {
      assert.equal(actual, root)
      prepared++
      return 'revision'
    })
    assert.equal(prepared, 1)
    assert.equal(result.cases, 68)
    const base = join(root, 'test/upstream/node-pty')
    assert.equal(
      JSON.parse(readFileSync(join(base, 'inventory.json'), 'utf8')).files
        .length,
      6,
    )
    assert.equal(
      JSON.parse(readFileSync(join(base, 'command-line.json'), 'utf8')).length,
      22,
    )
    assert.deepEqual(
      readFileSync(join(base, 'original/src/terminal.test.ts.txt')),
      readFileSync(join(checkout, 'src/terminal.test.ts')),
    )
    assert.equal(readFileSync(join(base, 'LICENSE'), 'utf8'), 'MIT fixture')
    assert.match(
      readFileSync(join(root, 'test/fixtures/node-pty.d.mts'), 'utf8'),
      /export const fixture/,
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('sync CLI rejects extra arguments before touching the upstream checkout', () => {
  const result = spawnSync(
    process.execPath,
    ['scripts/sync-upstream.mts', '--unexpected'],
    { encoding: 'utf8', timeout: 5000 },
  )
  assert.equal(result.status, 1)
  assert.match(result.stderr, /Usage: pnpm run upstream:sync/)
})
