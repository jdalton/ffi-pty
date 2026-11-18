import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { repositoryRoot, windowsHelperPath } from '../../paths/repository.mts'

test('repository paths resolve independently of the working directory and reject unsupported architectures', () => {
  assert.ok(existsSync(join(repositoryRoot, 'package.json')))
  for (const arch of ['x64', 'arm64']) {
    assert.equal(
      windowsHelperPath(repositoryRoot, arch),
      resolve(repositoryRoot, `build/ffi-pty/win32-${arch}/helper.exe`),
    )
    assert.equal(
      windowsHelperPath(repositoryRoot, arch, true),
      resolve(repositoryRoot, `dist/bin/win32-${arch}/helper.exe`),
    )
  }
  assert.throws(
    () => windowsHelperPath(repositoryRoot, '../x86'),
    /architecture/,
  )
})
