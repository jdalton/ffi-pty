import { resolve } from 'node:path'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { runCommands } from '../../scripts/commands.mts'

test('command runner preserves order and stops when a command fails', () => {
  const calls: string[][] = []
  const execute = ((_file: string, args: string[]) => {
    calls.push(args)
    return { status: args[0] === 'bad' ? 1 : 0 }
  }) as typeof spawnSync
  runCommands([['good']], execute)
  assert.throws(() => runCommands([['bad'], ['never']], execute), /failed/)
  assert.deepEqual(calls, [['good'], ['bad']])
})

test('command runner reports spawn errors and signal termination', () => {
  assert.throws(
    () =>
      runCommands([['test']], (() => ({
        error: new Error('spawn failed'),
      })) as typeof spawnSync),
    /spawn failed/,
  )
  assert.throws(
    () =>
      runCommands([['test']], (() => ({
        status: null,
        signal: 'SIGTERM',
      })) as typeof spawnSync),
    /SIGTERM/,
  )
})

test('command entrypoints dispatch their commands and fail when a child fails', () => {
  for (const [file, command] of [
    ['scripts/fix/index.mts', 'oxlint'],
    ['scripts/fmt/index.mts', 'oxfmt'],
    ['scripts/update/index.mts', 'scripts/update/conpty.mts'],
    ['scripts/check/index.mts', 'check:policy'],
    ['scripts/check/format.mts', 'oxfmt'],
    ['scripts/lint/index.mts', 'oxlint'],
  ]) {
    const script = resolve(file)
    for (const status of [0, 1]) {
      const result = spawnSync(
        process.execPath,
        [
          '-e',
          `
        const cp = require('node:child_process');
        cp.spawnSync = (file, args) => { console.log(JSON.stringify([file, ...args])); return {status: ${status}}; };
        require('node:module').syncBuiltinESMExports();
        process.argv[1] = ${JSON.stringify(script)};
        require(process.argv[1]);
      `,
        ],
        { encoding: 'utf8', timeout: 5000 },
      )
      assert.equal(result.status, status, result.stderr)
      assert.ok(result.stdout.includes(command), result.stdout)
    }
  }
})
