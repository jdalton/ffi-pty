import assert from 'node:assert/strict'
import type { execFileSync } from 'node:child_process'
import { test } from 'node:test'
import { formatUpstream } from '../../../scripts/fmt/upstream.mts'
import { repositoryRoot } from '../../../paths/repository.mts'

test('upstream formatting uses the pinned CLI and only generated fixtures, preserving original sources', () => {
  const calls: string[][] = []
  formatUpstream(repositoryRoot, ((_file: string, args: string[]) => {
    calls.push(args)
    return Buffer.alloc(0)
  }) as typeof execFileSync)
  assert.equal(calls.length, 2)
  assert.deepEqual(calls[0], calls[1])
  assert.ok(calls[0].some(arg => arg.endsWith('node-pty.d.mts')))
  assert.ok(calls[0].some(arg => arg.endsWith('command-line.json')))
  assert.equal(
    calls[0].some(arg => arg.includes('/original/')),
    false,
  )
})
