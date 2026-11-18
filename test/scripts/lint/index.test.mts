import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runLint } from '../../../scripts/lint/index.mts'
test('lint dispatches its repository commands without executing during import', () => {
  let calls: string[][] = []
  runLint(commands => {
    calls = commands
  })
  for (const argument of ['--deny-warnings']) {
    assert.ok(calls.flat().includes(argument), argument)
  }
  assert.ok(calls.length > 0)
})
