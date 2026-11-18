import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  isTestLane,
  laneBudgets,
  testLane,
  midTests,
  slowTests,
} from '../../scripts/test-lanes.mts'
import { testFiles, runTests } from '../../scripts/test.mts'
import { repositoryRoot } from '../../paths/repository.mts'

test('test lanes partition every unit file exactly once and keep unknown files in fast', () => {
  const all = testFiles(repositoryRoot)
  const partitioned = ['fast', 'mid', 'slow'].flatMap(lane =>
    testFiles(repositoryRoot, lane),
  )
  assert.deepEqual(partitioned.toSorted(), all)
  assert.equal(new Set(partitioned).size, all.length)
  assert.equal(testLane('new.test.mts'), 'fast')
  assert.equal(testLane('test\\src\\pty.test.mts'), 'slow')
  for (const name of [...midTests, ...slowTests]) {
    assert.ok(all.some(file => file.endsWith(`/${name}`)))
  }
  assert.equal(isTestLane('unit'), false)
})

test('lane runners enforce batch deadlines without enabling coverage', () => {
  assert.deepEqual(laneBudgets, { fast: 30_000, mid: 60_000, slow: 120_000 })
  for (const lane of ['fast', 'mid', 'slow'] as const) {
    assert.equal(
      runTests([lane], repositoryRoot, ((_exe, args, options) => {
        assert.equal(options.timeout, laneBudgets[lane])
        assert.equal(options.killSignal, 'SIGKILL')
        assert.ok(args.includes('--experimental-ffi'))
        assert.ok(args.includes('run'))
        assert.ok(args.includes('--config'))
        assert.ok(!args.includes('--test'))
        return { status: 0 }
      }) as never),
      0,
    )
  }
})

test('slow native and upstream batches each keep their budget and both run when one fails', () => {
  const calls: string[][] = []
  const result = runTests(['slow'], repositoryRoot, ((_exe, args, options) => {
    assert.equal(options.timeout, laneBudgets.slow)
    calls.push(args)
    return { status: calls.length === 1 ? 1 : 0 }
  }) as never)
  assert.equal(result, 1)
  assert.equal(calls.length, 2)
  assert.ok(!calls[0].some(arg => arg.startsWith('test/upstream/')))
  assert.ok(calls[1].some(arg => arg.startsWith('test/upstream/')))
})
