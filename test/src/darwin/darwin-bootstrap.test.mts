import { spawnSync } from 'node:child_process'
import assert from 'node:assert/strict'
import { test } from 'vitest'
import { execTarget } from '../../../src/darwin/darwin-bootstrap.mts'

test('bootstrap rejects incomplete exec arguments before touching native state', () => {
  assert.throws(() => execTarget([], {}), /bootstrap arguments/)
  assert.throws(() => execTarget(['/bin/sh'], {}), /bootstrap arguments/)
})

test(
  'bootstrap without a terminal reports login_tty failure and exits 127',
  { skip: process.platform !== 'darwin' },
  () => {
    const result = spawnSync(
      process.execPath,
      [
        '--experimental-ffi',
        'src/darwin/darwin-bootstrap.mts',
        '/bin/sh',
        'sh',
      ],
      { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', timeout: 5000 },
    )
    assert.equal(result.status, 127)
    assert.match(result.stderr, /login_tty failed with errno/)
  },
)
