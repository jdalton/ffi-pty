import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runCheck } from '../../../scripts/check/index.mts'
test('check dispatches its repository commands without executing during import', () => {
  let calls: string[][] = []
  runCheck(commands => {
    calls = commands
  })
  for (const argument of [
    'check:policy',
    'format:check',
    'lint',
    'test:all',
    'test:build',
  ]) {
    assert.ok(calls.flat().includes(argument), argument)
  }
  assert.ok(calls.length > 0)
})
