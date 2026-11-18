import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkFormat } from '../../../scripts/check/format.mts'
import { runFmt } from '../../../scripts/fmt/index.mts'

test('format checking targets the same files and configuration without writing them', () => {
  let check: string[][] = []
  let format: string[][] = []
  checkFormat(commands => {
    check = commands
  })
  runFmt(commands => {
    format = commands
  })
  assert.ok(check[0].includes('--check'))
  assert.deepEqual(
    check[0].filter(arg => arg !== '--check'),
    format[0],
  )
})
