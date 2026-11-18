import assert from 'node:assert/strict'
import { test } from 'vitest'
import { isAbsolute } from 'node:path'
import {
  normalizeSpawnOptions,
  validateDimension,
  validateNativeString,
} from '../../src/validation.mts'

test('normalizes defaults and copies the requested arguments', () => {
  const args = ['-c', 'echo ok']
  const options = normalizeSpawnOptions('sh', args, { env: { PATH: '/bin' } })
  args.push('later')
  assert.deepEqual(options.args, ['-c', 'echo ok'])
  assert.equal(options.cols, 80)
  assert.equal(options.rows, 24)
  assert.equal(options.env.TERM, 'xterm-256color')
  assert.equal(isAbsolute(options.cwd), true)
})

test('rejects unsupported options and invalid native strings before allocation', () => {
  assert.throws(
    () => normalizeSpawnOptions('sh', [], { uid: 10 }),
    /Unsupported/,
  )
  assert.throws(() => normalizeSpawnOptions('sh', ['bad\0arg']), /NUL/)
  assert.throws(
    () => normalizeSpawnOptions('sh', [], { cols: 32_768 }),
    /32767/,
  )
  assert.throws(
    () => normalizeSpawnOptions('sh', [], { encoding: 'latin1' }),
    /UTF-8/,
  )
  assert.throws(
    () => normalizeSpawnOptions('sh', [], { env: { 'BAD=NAME': 'x' } }),
    /Invalid/,
  )
})

test('native string and dimension validators accept supported boundary values', () => {
  assert.equal(validateNativeString('ok', 'value'), undefined)
  assert.equal(validateDimension(32_767, 'cols'), undefined)
  assert.throws(() => validateNativeString('bad\0value', 'value'), /NUL/)
  assert.throws(() => validateDimension(0, 'rows'), /1 to 32767/)
})

test('rejects malformed spawn input before native allocation', () => {
  for (const [file, args, options] of [
    ['', [], {}],
    [null, [], {}],
    ['sh', null, {}],
    ['sh', [], null],
    ['sh', [], []],
    ['sh', [], { env: [] }],
    ['sh', [], { env: 1 }],
    ['sh', [], { env: { '': 'x' } }],
    ['sh', [], { env: { GOOD: undefined } }],
    ['sh', [], { env: { GOOD: 'bad\0value' } }],
    ['sh', [], { rows: NaN }],
    ['sh', [], { rows: 1.5 }],
    ['sh', [], { cols: -1 }],
    ['sh', [], { cwd: 1 }],
    ['sh', [], { encoding: null }],
  ]) {
    assert.throws(() =>
      normalizeSpawnOptions(file as never, args as never, options as never),
    )
  }
  const options = normalizeSpawnOptions('sh', [], {
    cwd: '.',
    cols: 1,
    rows: 32_767,
    env: { TERM: 'dumb' },
    encoding: 'utf8',
  })
  assert.equal(options.env.TERM, 'dumb')
  assert.equal(options.cols, 1)
  assert.equal(options.rows, 32_767)
  assert.equal(Object.getPrototypeOf(options.env), null)
})
