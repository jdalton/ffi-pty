import assert from 'node:assert/strict'
import { test } from 'vitest'
import { checkCompatibleType } from '../../src/compat-validation.mts'
test('optional type checking accepts undefined and empty arrays but rejects mixed arrays', () => {
  assert.doesNotThrow(() =>
    checkCompatibleType('optional', undefined, 'string'),
  )
  assert.doesNotThrow(() => checkCompatibleType('args', [], 'string', true))
  assert.throws(
    () => checkCompatibleType('args', ['a', 1], 'string', true),
    /args must be a string/,
  )
  assert.throws(
    () => checkCompatibleType('arg', ['a'], 'string'),
    /not a object/,
  )
})
