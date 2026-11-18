import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runFmt } from '../../../scripts/fmt/index.mts'
test('fmt dispatches its repository commands without executing during import', () => {
  let calls: string[][] = []
  runFmt(commands => {
    calls = commands
  })
  for (const argument of ['.config/oxfmtrc.json']) {
    assert.ok(calls.flat().includes(argument), argument)
  }
  assert.ok(calls.length > 0)
})
