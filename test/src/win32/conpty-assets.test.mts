import assert from 'node:assert/strict'
import { test } from 'vitest'
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import {
  prepareBundledConpty,
  verifyConptyDirectory,
  conptyAssets,
} from '../../../src/win32/conpty-assets.mts'
import { writeVerifiedCacheFile } from '../../../src/cache-write.mts'

for (const arch of ['x64', 'arm64']) {
  test(`bundled ${arch} ConPTY extracts synchronously, verifies both signed files, and reuses the cache`, () => {
    const cache = mkdtempSync(join(tmpdir(), 'ffi-conpty-'))
    try {
      let writes = 0
      const write: typeof writeVerifiedCacheFile = (...args) => {
        writes++
        return writeVerifiedCacheFile(...args)
      }
      const path = prepareBundledConpty(arch, cache, conptyAssets, write)
      assert.equal(typeof path, 'string')
      assert.equal(writes, 2)
      assert.equal(readFileSync(path).subarray(0, 2).toString(), 'MZ')
      assert.equal(
        readFileSync(join(dirname(path), 'OpenConsole.exe'))
          .subarray(0, 2)
          .toString(),
        'MZ',
      )
      assert.equal(prepareBundledConpty(arch, cache, conptyAssets, write), path)
      assert.equal(writes, 2)
      assert.equal(readdirSync(cache).length, 1)
      writeFileSync(path, 'corrupt')
      assert.throws(() => prepareBundledConpty(arch, cache))
      assert.equal(readdirSync(cache).length, 1)
    } finally {
      rmSync(cache, { recursive: true, force: true })
    }
  })
}
test('bundled ConPTY rejects unsupported architectures and removes staging after write failures', () => {
  const cache = mkdtempSync(join(tmpdir(), 'ffi-conpty-failure-'))
  try {
    assert.throws(() => prepareBundledConpty('ia32', cache), /architecture/)
    assert.throws(
      () =>
        prepareBundledConpty('x64', cache, conptyAssets, () => {
          throw new Error('disk full')
        }),
      /disk full/,
    )
    assert.deepEqual(readdirSync(cache), [])
    assert.equal(
      verifyConptyDirectory(cache, { missing: { size: 1, sha256: 'bad' } }),
      false,
    )
  } finally {
    rmSync(cache, { recursive: true, force: true })
  }
})
