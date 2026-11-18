import assert from 'node:assert/strict'
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { delimiter, join } from 'node:path'
import { tmpdir } from 'node:os'
import { test } from 'vitest'
import { makePointerVector, resolveExecutable } from '../../src/unix-native.mts'

test('native pointer vectors keep NUL-terminated buffers and a null terminator', () => {
  const vector = makePointerVector(['program', 'argument'])
  assert.deepEqual(
    vector.buffers.map(buffer => buffer.toString()),
    ['program\0', 'argument\0'],
  )
  assert.notEqual(vector.pointers.readBigUInt64LE(0), 0n)
  assert.notEqual(vector.pointers.readBigUInt64LE(8), 0n)
  assert.equal(vector.pointers.readBigUInt64LE(16), 0n)
  assert.throws(() => makePointerVector(['bad\0value']), /NUL/)
})

test('executable lookup uses child cwd and relative PATH entries without changing parent env', () => {
  const root = mkdtempSync(join(tmpdir(), 'ffi-pty-path-'))
  const oldPath = process.env.PATH
  try {
    const first = join(root, 'first')
    const second = join(root, 'second')
    mkdirSync(join(first, 'tool'), { recursive: true }) // directories are not executable candidates
    mkdirSync(second)
    const executable = join(second, 'tool')
    writeFileSync(executable, '#!/bin/sh\nexit 0\n')
    chmodSync(executable, 0o755)

    const childEnv = { PATH: `first${delimiter}second` }
    assert.equal(resolveExecutable('tool', root, childEnv), executable)
    assert.equal(resolveExecutable('./second/tool', root, childEnv), executable)
    assert.throws(
      () => resolveExecutable('missing-tool', root, childEnv),
      /not found/,
    )
    assert.deepEqual(childEnv, { PATH: `first${delimiter}second` })
    assert.equal(process.env.PATH, oldPath)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test(
  'empty PATH entries search child cwd and omitted PATH uses the system fallback',
  { skip: process.platform === 'win32' },
  () => {
    const root = mkdtempSync(join(tmpdir(), 'ffi-empty-path-'))
    try {
      const file = join(root, 'tool')
      writeFileSync(file, '#!/bin/sh\n')
      chmodSync(file, 0o755)
      assert.equal(resolveExecutable('tool', root, { PATH: '' }), file)
      assert.match(resolveExecutable('sh', root, {}), /\/bin\/sh$/)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  },
)
