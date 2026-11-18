import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { execFileSync } from 'node:child_process'
import { changedFiles, planMain } from '../../../scripts/ci/plan.mts'
import { allRunners } from '../../../scripts/ci/runners.mts'
const sha = 'a'.repeat(40)

test('diff uses the PR base or previous push commit and preserves changed file statuses', () => {
  for (const event of [
    { before: sha },
    { before: 'b'.repeat(40), pull_request: { base: { sha } } },
  ]) {
    const calls: string[][] = []
    const execute = ((file, args) => {
      assert.equal(file, 'git')
      calls.push(args)
      return calls.length === 1
        ? ''
        : 'M\0src/linux/changed.mts\0D\0src/linux/removed.mts\0A\0src/win32/new.mts\0'
    }) as typeof execFileSync
    assert.deepEqual(changedFiles(event, execute), [
      { path: 'src/linux/changed.mts', deleted: false },
      { path: 'src/linux/removed.mts', deleted: true },
      { path: 'src/win32/new.mts', deleted: false },
    ])
    assert.deepEqual(calls, [
      ['fetch', '--no-tags', '--depth=1', 'origin', sha],
      ['diff', '--no-renames', '--name-status', '-z', sha, 'HEAD'],
    ])
  }
})
test('missing, malformed, zero and unavailable base revisions broaden the plan', () => {
  for (const before of [undefined, '--unsafe', '0'.repeat(40)]) {
    assert.equal(
      changedFiles({ before }, (() => {
        throw Error('must not execute')
      }) as never),
      undefined,
    )
  }
  assert.equal(
    changedFiles({ before: sha }, (() => {
      throw Error('unavailable history')
    }) as never),
    undefined,
  )
  assert.deepEqual(changedFiles({ before: sha }, (() => '') as never), [])
})
test('planner writes machine-readable output and a human-readable summary', () => {
  const writes: string[] = []
  const plan = planMain(
    {
      GITHUB_EVENT_PATH: 'event.json',
      GITHUB_OUTPUT: 'output',
      GITHUB_STEP_SUMMARY: 'summary',
    },
    (() => '') as never,
    ((_path, text) => writes.push(String(text))) as never,
    (() => JSON.stringify({ inputs: { target: 'windows-11-arm' } })) as never,
  )
  assert.deepEqual(plan.runner, ['windows-11-arm'])
  assert.equal(
    writes[0],
    'matrix={"runner":["windows-11-arm"]}\ndocs-only=false\n',
  )
  assert.match(writes[1], /Requested individual runner/)
})
test('removed platform files do not request unavailable runners', () => {
  const writes: string[] = []
  const execute = ((file, args) => {
    assert.equal(file, 'git')
    if (args[0] === 'fetch') {
      return ''
    }
    return 'D\0src/linux/musl/abi.mts\0D\0src/linux/musl/bootstrap.mts\0'
  }) as typeof execFileSync
  const plan = planMain(
    {
      GITHUB_EVENT_PATH: 'event.json',
      GITHUB_OUTPUT: 'output',
    },
    execute,
    ((_path, text) => writes.push(String(text))) as never,
    (() => JSON.stringify({ before: sha })) as never,
  )
  assert.deepEqual(plan.runner, ['ubuntu-22.04'])
  assert.equal(plan.docsOnly, true)
})
test('release planning avoids diff work and always requests every runner', () => {
  assert.deepEqual(
    planMain(
      {
        GITHUB_EVENT_NAME: 'release',
        GITHUB_EVENT_PATH: 'event',
        GITHUB_OUTPUT: 'output',
      },
      (() => {
        throw Error('no diff')
      }) as never,
      (() => {}) as never,
      (() => '{"inputs":{"target":"linux"}}') as never,
    ).runner,
    allRunners,
  )
  assert.throws(() => planMain({}), /Missing workflow/)
})

test('planner CLI writes the release matrix without fetching history', () => {
  const root = mkdtempSync(join(tmpdir(), 'ffi-plan-'))
  try {
    const event = join(root, 'event.json')
    const output = join(root, 'output')
    writeFileSync(event, '{}')
    const result = spawnSync(process.execPath, ['scripts/ci/plan.mts'], {
      env: {
        ...process.env,
        GITHUB_EVENT_PATH: event,
        GITHUB_OUTPUT: output,
        GITHUB_EVENT_NAME: 'release',
        GITHUB_STEP_SUMMARY: '',
      },
      encoding: 'utf8',
      timeout: 5000,
    })
    assert.equal(result.status, 0, result.stderr)
    assert.match(readFileSync(output, 'utf8'), /windows-2022/)
    assert.match(readFileSync(output, 'utf8'), /docs-only=false/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
