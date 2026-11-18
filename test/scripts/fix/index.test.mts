import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runFix } from '../../../scripts/fix/index.mts'
test('fix dispatches its repository commands without executing during import', () => {
  let calls: string[][] = []
  runFix(commands => {
    calls = commands
  })
  for (const argument of ['--fix', 'format']) {
    assert.ok(calls.flat().includes(argument), argument)
  }
  assert.ok(calls.length > 0)
})
