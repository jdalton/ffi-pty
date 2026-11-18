import assert from 'node:assert/strict'
import { test } from 'vitest'
import {
  credentialArguments,
  consumeCredentials,
  applyCredentials,
} from '../../src/unix-credentials.mts'

test('credentials are encoded separately from target arguments and groups change before users', () => {
  const calls: unknown[] = []
  assert.deepEqual(credentialArguments({}), [])
  const encoded = credentialArguments({ uid: 10, gid: 20 })
  assert.deepEqual(
    consumeCredentials([...encoded, 'exe', 'argv0'], value =>
      calls.push(value),
    ),
    ['exe', 'argv0'],
  )
  assert.deepEqual(calls, [{ uid: 10, gid: 20 }])
  assert.deepEqual(consumeCredentials(['exe']), ['exe'])
  applyCredentials(
    { uid: 10, gid: 20 },
    value => calls.push(['group', value]),
    value => calls.push(['user', value]),
  )
  assert.deepEqual(calls.slice(1), [
    ['group', 20],
    ['user', 10],
  ])
  applyCredentials(
    {},
    () => assert.fail(),
    () => assert.fail(),
  )
  for (const value of ['null', '{"uid":-1}', '{"gid":1.2}', 'broken']) {
    assert.throws(() => consumeCredentials(['--ffi-credentials', value]))
  }
})

test('credential marker requires a JSON payload', () => {
  assert.throws(() => consumeCredentials(['--ffi-credentials']), SyntaxError)
})
