import assert from 'node:assert/strict'
import { test } from 'vitest'
import { helperPublisherPolicy } from '../../../src/win32/windows-helper-publisher.mts'

test('release publisher is fixed in reviewed source and cannot be changed at runtime', () => {
  assert.equal(
    helperPublisherPolicy.subject,
    'CN=John-David Dalton, O=John-David Dalton, L=Midlothian, S=va, C=US',
  )
  assert.ok(Object.isFrozen(helperPublisherPolicy))
  assert.throws(() => {
    helperPublisherPolicy.subject = 'CN=Other'
  })
})
