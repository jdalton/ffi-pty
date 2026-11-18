import { spawnSync } from 'node:child_process'
import assert from 'node:assert/strict'
import { test } from 'vitest'
import { execLinuxTarget } from '../../../src/linux/linux-bootstrap.mts'

test('Linux credential bootstrap rejects missing executable arguments before native calls', () => {
  assert.throws(() => execLinuxTarget([], {}), /Invalid Linux/)
  assert.throws(() => execLinuxTarget(['exe'], {}), /Invalid Linux/)
})

test(
  'Linux bootstrap execs the target and reports startup failures',
  { skip: process.platform !== 'linux' },
  () => {
    const file = 'src/linux/linux-bootstrap.mts'
    const success = spawnSync(
      process.execPath,
      [
        '--experimental-ffi',
        file,
        process.execPath,
        'node',
        '-e',
        'console.log("EXEC_OK")',
      ],
      { encoding: 'utf8', timeout: 5000 },
    )
    assert.equal(success.status, 0, success.stderr)
    assert.match(success.stdout, /EXEC_OK/)
    const failure = spawnSync(
      process.execPath,
      ['--experimental-ffi', file, '/missing-ffi-executable', 'missing'],
      { encoding: 'utf8', timeout: 5000 },
    )
    assert.equal(failure.status, 127)
    assert.match(failure.stderr, /PTY child startup failed/)
  },
)
