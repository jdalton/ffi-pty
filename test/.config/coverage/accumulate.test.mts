import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, writeFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  coverageBadge,
  coverageFailures,
  hash,
  mergeReceipts,
  relativeSource,
  sourceSnapshot,
  validateReceipt,
} from '../../../.config/coverage/accumulate.mts'

import { fixture } from './fixture.mts'

test('unions hits from suites, shards and repeated runs without averaging percentages', () => {
  const first = fixture()
  const second = fixture('second', [0, 1], '/another-checkout')
  second.suite = 'e2e'
  second.shard = '2'
  const result = mergeReceipts(
    [first, second],
    ['first/unit/1', 'second/e2e/2'],
  )
  assert.equal(result.total.lines.pct, 100)
  assert.equal(result.total.lines.total, 2)
  assert.equal(result.total.branches.pct, 100)
  assert.equal(mergeReceipts([first, fixture('second')]).total.lines.pct, 50)
})

test('refuses stale sources, mixed platforms, runtimes, failed runs and duplicate receipts', () => {
  for (const changes of [
    { platform: 'linux' },
    { arch: 'x64' },
    { node: 'v27.0.0' },
    { sources: { 'a.mts': hash('changed') } },
    { passed: false },
  ]) {
    assert.throws(() =>
      mergeReceipts([fixture(), { ...fixture('second'), ...changes }]),
    )
  }
  assert.throws(() => mergeReceipts([fixture(), fixture()]), /Duplicate/)
  assert.throws(() => mergeReceipts([]), /No coverage/)
  assert.throws(
    () => mergeReceipts([fixture()], ['missing/unit/2']),
    /Missing coverage receipt/,
  )
})

test('rejects missing files and corrupt or negative coverage counters', () => {
  const missing = fixture()
  missing.sources['b.mts'] = hash('missing')
  assert.throws(() => mergeReceipts([missing]), /Missing coverage source/)
  const corrupt = fixture()
  corrupt.reportHash = 'wrong'
  assert.throws(() => validateReceipt(corrupt), /corrupt/)
  for (const hit of [
    [-1, 0],
    [Infinity, 1],
    [0.5, 1],
  ]) {
    assert.throws(() => mergeReceipts([fixture('bad', hit)]), /hit count/)
  }
  const outside = fixture()
  const entry = Object.values(outside.report)[0]
  entry.path = '/outside/a.mts'
  outside.reportHash = hash(JSON.stringify(outside.report))
  assert.throws(() => mergeReceipts([outside]), /outside/)
})

test('checks unrounded line and branch ratios at the same threshold', () => {
  assert.deepEqual(
    coverageFailures({
      lines: { covered: 98, total: 100 },
      branches: { covered: 0, total: 0 },
    }),
    [],
  )
  assert.equal(
    coverageFailures({
      lines: { covered: 97_999, total: 100_000 },
      branches: { covered: 97, total: 100 },
    }).length,
    2,
  )
  assert.throws(() => coverageFailures({}, 101), /threshold/)
  assert.throws(
    () => coverageFailures({ lines: { covered: 2, total: 1 } }),
    /totals/,
  )
  assert.ok(
    coverageFailures({
      lines: { covered: 0, total: 0 },
      branches: { covered: 0, total: 0 },
    }).length,
  )
})

test('source fingerprints are stable, detect edits and reject paths outside the root', () => {
  const root = mkdtempSync(join(tmpdir(), 'vowen-coverage-'))
  try {
    writeFileSync(join(root, 'a.mts'), 'first')
    const first = sourceSnapshot(root, ['a.mts'])
    assert.deepEqual(first, sourceSnapshot(root, [join(root, 'a.mts')]))
    writeFileSync(join(root, 'a.mts'), 'second')
    assert.notDeepEqual(first, sourceSnapshot(root, ['a.mts']))
    assert.throws(() => relativeSource(root, '../outside'), /outside/)
    if (process.platform !== 'win32') {
      symlinkSync('/etc/hosts', join(root, 'escape'))
      assert.throws(() => sourceSnapshot(root, ['escape']), /outside/)
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('badges show measured values and reject markup injection or fabricated values', () => {
  assert.match(coverageBadge('macOS lines', 97.5), /97.50%/)
  assert.match(coverageBadge('macOS lines', 98), /238636/)
  assert.throws(() => coverageBadge('<script>', 100))
  assert.throws(() => coverageBadge('lines', NaN))
  assert.throws(() => coverageBadge('lines', 101))
})
