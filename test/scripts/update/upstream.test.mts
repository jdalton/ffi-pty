import assert from 'node:assert/strict'
import type { execFileSync } from 'node:child_process'
import { test } from 'node:test'
import { updateUpstream } from '../../../scripts/update/upstream.mts'

test('upstream updater imports fetched tests before staging the new pin', () => {
  const calls: string[] = []
  const execute = ((_file: string, args: string[]) => {
    calls.push(args.join(' '))
    return args[0] === 'rev-parse' ? 'new-revision' : ''
  }) as typeof execFileSync
  const result = updateUpstream(
    '/fixture',
    () => {
      calls.push('prepare')
      return 'old'
    },
    execute,
    (root, prepare) => {
      calls.push('sync')
      return { revision: prepare!(root), cases: 68 }
    },
  )
  assert.deepEqual(result, { revision: 'new-revision', cases: 68 })
  assert.deepEqual(calls, [
    'prepare',
    'fetch --depth 1 --filter=blob:none origin main',
    'rev-parse FETCH_HEAD',
    'checkout --detach new-revision',
    'sync',
    'add -- upstream/node-pty',
  ])
})

test('upstream updater does not stage a pin after failed imports', () => {
  const calls: string[] = []
  const execute = ((_file: string, args: string[]) => {
    calls.push(args[0])
    return 'revision'
  }) as typeof execFileSync
  assert.throws(
    () =>
      updateUpstream(
        '/fixture',
        () => 'old',
        execute,
        () => {
          throw new Error('import failed')
        },
      ),
    /import failed/,
  )
  assert.equal(calls.includes('add'), false)
})
