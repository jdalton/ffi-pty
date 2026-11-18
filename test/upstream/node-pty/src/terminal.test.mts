// Adapted from node-pty's MIT-licensed terminal.test.ts.
import assert from 'node:assert/strict'
import { checkCompatibleType } from '../../../../src/compat-validation.mts'
import { normalizeCompatibleOptions } from '../../../../src/compat-options.mts'
import { upstreamTest } from '../suite.mts'
import { mockTerminal } from '../mock-terminal.mts'

upstreamTest('terminal', 1, {}, () => {
  assert.throws(
    () => normalizeCompatibleOptions('a', [], { name: {} as string }),
    /name must be a string/,
  )
})
upstreamTest('terminal', 2, {}, () => {
  for (const [value, type] of [
    ['test', 'string'],
    [1, 'number'],
    [{}, 'object'],
  ] as const) {
    assert.doesNotThrow(() => checkCompatibleType('foo', value, type))
  }
  for (const [value, type] of [
    ['test', 'number'],
    [1, 'object'],
    [{}, 'string'],
  ] as const) {
    assert.throws(() => checkCompatibleType('foo', value, type))
  }
})
upstreamTest('terminal', 3, {}, () => {
  for (const [value, type] of [
    ['test', 'string'],
    [1, 'number'],
    [{}, 'object'],
  ] as const) {
    assert.doesNotThrow(() => checkCompatibleType('foo', [value], type, true))
  }
  for (const [value, type] of [
    ['test', 'number'],
    [1, 'object'],
    [{}, 'string'],
  ] as const) {
    assert.throws(() => checkCompatibleType('foo', [value], type, true))
  }
})
upstreamTest('terminal', 4, {}, async t => {
  const { term, readable } = mockTerminal()
  t.after(() => term.close())
  assert.equal(term.handleFlowControl, true)
  term.write('abc')
  assert.equal(readable.isPaused(), true)
  term.write('123')
  assert.equal(readable.isPaused(), false)
})
