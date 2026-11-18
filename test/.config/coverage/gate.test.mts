import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gateCoverage, gateMain } from '../../../.config/coverage/gate.mts'
import { fixture } from './fixture.mts'

test('gate merges complete evidence, writes measured badges, and rejects stale sources', () => {
  const root = mkdtempSync(join(tmpdir(), 'vowen-gate-'))
  try {
    writeFileSync(join(root, 'a.mts'), 'same source')
    for (const [run, hit] of [
      ['first', [1, 0]],
      ['second', [0, 1]],
    ] as const) {
      writeFileSync(
        join(root, `${run}.json`),
        JSON.stringify(fixture(run, [...hit], root)),
      )
    }
    const plan = join(root, 'plan.json')
    writeFileSync(
      plan,
      JSON.stringify({
        receipts: ['first.json', 'second.json'],
        expected: ['first/unit/1', 'second/unit/1'],
      }),
    )
    assert.deepEqual(gateCoverage(root, plan), [])
    assert.match(
      readFileSync(
        join(root, '.cache/coverage/darwin-arm64/combined/lines.svg'),
        'utf8',
      ),
      /100.00%/,
    )
    writeFileSync(join(root, 'a.mts'), 'changed')
    assert.throws(() => gateCoverage(root, plan), /current sources/)
    writeFileSync(plan, '{}')
    assert.throws(() => gateCoverage(root, plan), /plan/)
    assert.throws(() => gateMain([]), /Usage/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
