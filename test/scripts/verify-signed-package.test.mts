import type { execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  existsSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { verifySignedPackage } from '../../scripts/verify-signed-package.mts'
import { peFixture } from './signing-policy.test.mts'

test('packed verification rejects absent or ambiguous archives and changed or unsigned helpers', () => {
  const root = mkdtempSync(join(tmpdir(), 'packed-sign-test-'))
  try {
    assert.throws(() => verifySignedPackage(root), /exactly one/)
    mkdirSync(join(root, 'artifacts'))
    writeFileSync(join(root, 'artifacts/one.tgz'), '')
    mkdirSync(join(root, 'build/ffi-pty/win32-x64'), { recursive: true })
    writeFileSync(join(root, 'build/ffi-pty/win32-x64/helper.exe'), peFixture())
    for (const failure of ['', 'extract', 'changed', 'inspect']) {
      let folder = ''
      const execute = ((_cmd, args, options) => {
        assert.equal(options.cwd, root)
        assert.ok(!args[1].includes(':'))
        assert.match(args[1], /one\.tgz$/)
        folder = args[3]
        if (failure === 'extract') {
          throw new Error('extract')
        }
        mkdirSync(join(folder, 'package/bin/win32-x64'), { recursive: true })
        const bytes = peFixture()
        if (failure === 'changed') {
          bytes[100] = 1
        }
        writeFileSync(join(folder, 'package/bin/win32-x64/helper.exe'), bytes)
        return Buffer.alloc(0)
      }) as typeof execFileSync
      let inspected = false
      const inspect = () => {
        inspected = true
        if (failure === 'inspect') {
          throw new Error('inspect')
        }
      }
      if (failure) {
        assert.throws(() => verifySignedPackage(root, 'x64', execute, inspect))
      } else {
        verifySignedPackage(root, 'x64', execute, inspect)
        assert.ok(inspected)
      }
      assert.equal(existsSync(folder), false)
    }
    writeFileSync(join(root, 'artifacts/two.tgz'), '')
    assert.throws(() => verifySignedPackage(root), /exactly one/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
