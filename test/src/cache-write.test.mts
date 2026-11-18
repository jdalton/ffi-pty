import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import assert from 'node:assert/strict'
import { test, vi } from 'vitest'
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  renameSync,
  existsSync,
  readdirSync,
  statSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  writeVerifiedCacheFile,
  flushCacheFile,
  sha256,
  tryCacheCompression,
} from '../../src/cache-write.mts'

test('cache write compresses an empty temporary file, verifies bytes, then publishes atomically', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ffi-cache-write-'))
  const destination = join(directory, 'asset.dll')
  const bytes = Buffer.from('verified bytes')
  const calls: string[] = []
  try {
    const result = writeVerifiedCacheFile(destination, bytes, sha256(bytes), {
      compress(path) {
        assert.equal(statSync(path).size, 0)
        assert.equal(existsSync(destination), false)
        calls.push('compress')
        return true
      },
      read(path) {
        calls.push('verify')
        assert.equal(existsSync(destination), false)
        return readFileSync(path)
      },
      rename(from, to) {
        calls.push('publish')
        renameSync(from, to)
      },
    })
    assert.equal(result.compressed, true)
    assert.deepEqual(calls, ['compress', 'verify', 'publish'])
    assert.deepEqual(readFileSync(destination), bytes)
    assert.deepEqual(readdirSync(directory), ['asset.dll'])
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('compression failure keeps verified plain bytes while corrupt input and failed publication leave no partial file', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ffi-cache-failure-'))
  const destination = join(directory, 'asset.dll')
  const bytes = Buffer.from('good')
  try {
    assert.throws(
      () => writeVerifiedCacheFile(destination, bytes, 'bad'),
      /payload checksum/,
    )
    assert.deepEqual(readdirSync(directory), [])
    const base = {
      compress: () => {
        throw new Error('unsupported')
      },
      read: readFileSync,
      rename: renameSync,
    }
    assert.equal(
      writeVerifiedCacheFile(destination, bytes, sha256(bytes), base)
        .compressed,
      false,
    )
    assert.throws(
      () =>
        writeVerifiedCacheFile(destination, bytes, sha256(bytes), {
          ...base,
          read: () => Buffer.from('corrupt'),
        }),
      /read-back/,
    )
    assert.throws(
      () =>
        writeVerifiedCacheFile(destination, bytes, sha256(bytes), {
          ...base,
          rename: () => {
            throw new Error('locked')
          },
        }),
      /locked/,
    )
    assert.deepEqual(readFileSync(destination), bytes)
    assert.deepEqual(readdirSync(directory), ['asset.dll'])
    assert.equal(tryCacheCompression(destination, 'linux'), false)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('cache durability flush runs normally and skips unsupported fsync only under Node permissions', () => {
  const calls: number[] = []
  flushCacheFile(7, false, descriptor => {
    calls.push(descriptor)
  })
  flushCacheFile(8, true, () => {
    throw new Error('blocked')
  })
  assert.deepEqual(calls, [7])
  assert.throws(
    () =>
      flushCacheFile(9, false, () => {
        throw new Error('disk failure')
      }),
    /disk failure/,
  )
})

test('optional compression fails safely for a missing Windows cache file', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ffi-no-compression-'))
  try {
    assert.equal(
      tryCacheCompression(join(directory, 'missing.dll'), 'win32'),
      false,
    )
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('a cleanup error never replaces the original cache publication error', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ffi-cache-cleanup-'))
  const original = new Error('publication denied')
  vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {
    throw new Error('cleanup denied')
  })
  syncBuiltinESMExports()
  try {
    const bytes = Buffer.from('data')
    assert.throws(
      () =>
        writeVerifiedCacheFile(join(directory, 'cache'), bytes, sha256(bytes), {
          compress: () => false,
          read: readFileSync,
          rename: () => {
            throw original
          },
        }),
      error => error === original,
    )
  } finally {
    vi.restoreAllMocks()
    syncBuiltinESMExports()
    rmSync(directory, { recursive: true, force: true })
  }
})
