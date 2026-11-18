import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  collectCoverage,
  collectMain,
  coverageScope,
} from '../../../.config/coverage/collect.mts'
import { fixture } from './fixture.mts'

for (const scenario of [
  'passed',
  'failed',
  'changed',
  'added',
  'spawn-error',
] as const) {
  test(`collection records ${scenario} without accepting incomplete evidence`, () => {
    const root = mkdtempSync(join(tmpdir(), 'vowen-collect-'))
    writeFileSync(join(root, 'a.mts'), 'same source')
    const config = {
      include: ['*.mts'],
      exclude: [],
      platformExclude: {},
      threshold: 98,
    }
    const options = {
      root,
      config,
      run: 'first',
      suite: 'unit',
      shard: '1',
      command: ['node', '--test'],
      tool: '/fixture/c8',
      execute: ((_file: string, args: string[]) => {
        const directory = args
          .find(value => value.startsWith('--reports-dir='))!
          .slice('--reports-dir='.length)
        if (scenario === 'changed') {
          writeFileSync(join(root, 'a.mts'), 'changed')
        }
        if (scenario === 'added') {
          writeFileSync(join(root, 'b.mts'), 'added')
        }
        writeFileSync(
          join(directory, 'coverage-final.json'),
          JSON.stringify(fixture('first', [1, 1], root).report),
        )
        return {
          status: scenario === 'failed' ? 1 : 0,
          ...(scenario === 'spawn-error'
            ? { error: new Error('spawn failed') }
            : {}),
        }
      }) as never,
    }
    try {
      assert.deepEqual(coverageScope(root, config).files, ['a.mts'])
      if (
        scenario === 'changed' ||
        scenario === 'added' ||
        scenario === 'spawn-error'
      ) {
        assert.throws(() => collectCoverage(options), /changed|spawn failed/)
      } else {
        const result = collectCoverage(options)
        const receipt = JSON.parse(
          readFileSync(join(result.directory, 'receipt.json'), 'utf8'),
        )
        assert.equal(receipt.passed, scenario === 'passed')
        assert.throws(() => collectCoverage(options), /EEXIST/)
      }
      assert.throws(
        () => collectCoverage({ ...options, run: '../escape' }),
        /Invalid/,
      )
      assert.throws(
        () => collectCoverage({ ...options, command: [] }),
        /Missing/,
      )
      assert.throws(
        () => coverageScope(root, { ...config, include: ['missing/*.mts'] }),
        /empty/,
      )
      assert.throws(() => collectMain([]), /run/)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
}
