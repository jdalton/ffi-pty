import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { test } from 'vitest'

test(
  'diagnostic probe verifies a real terminal and reports its exit status',
  { timeout: 10_000 },
  () => {
    const text = execFileSync(
      process.execPath,
      ['--experimental-ffi', 'src/probe.mts'],
      { encoding: 'utf8', timeout: 8000 },
    )
    assert.match(text, /PTY_OK/)
    assert.match(text, /SIZE:80x24/)
    assert.match(text, /exitCode: 0/)
  },
)
