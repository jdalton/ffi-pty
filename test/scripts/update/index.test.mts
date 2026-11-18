import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runUpdate } from '../../../scripts/update/index.mts'
test('update dispatches its repository commands without executing during import', () => {
  let calls: string[][] = []
  runUpdate(commands => {
    calls = commands
  })
  for (const argument of [
    'scripts/update/conpty.mts',
    'scripts/update/upstream.mts',
    'test:build',
  ]) {
    assert.ok(calls.flat().includes(argument), argument)
  }
  assert.ok(calls.length > 0)
})
