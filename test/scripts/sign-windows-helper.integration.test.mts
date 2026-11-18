import { repositoryRoot, windowsHelperPath } from '../../paths/repository.mts'
import assert from 'node:assert/strict'
import test from 'node:test'
import { join } from 'node:path'
import {
  mkdtempSync,
  copyFileSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { verifyHelperAtPath } from '../../src/win32/windows-helper-trust.mts'
import { helperPublisherPolicy } from '../../src/win32/windows-helper-publisher.mts'
import {
  inspectSignedFile,
  signedFileHash,
} from '../../scripts/sign-windows-helper.mts'

const enabled =
  process.platform === 'win32' && process.env.FFI_PTY_TEST_SIGNED_HELPER === '1'
test(
  'Azure-signed packaged helper passes publisher checks and rejects tampering and wrong publishers',
  { skip: !enabled, timeout: 120_000 },
  async () => {
    const root = repositoryRoot
    const source = windowsHelperPath(root, process.arch)
    const packed = windowsHelperPath(root, process.arch, true)
    assert.equal(signedFileHash(packed), signedFileHash(source))
    inspectSignedFile(packed)
    const folder = mkdtempSync(join(tmpdir(), 'signed-helper-test-'))
    const copy = join(folder, 'helper.exe')
    try {
      copyFileSync(packed, copy)
      const approved = await verifyHelperAtPath(
        copy,
        helperPublisherPolicy,
        undefined,
        { retain: lock => lock.release() },
      )
      assert.equal(approved.kind, 'native')
      assert.equal(
        (await verifyHelperAtPath(copy, { subject: 'CN=Wrong publisher' }))
          .kind,
        'node',
      )
      const bytes = readFileSync(copy)
      const pe = bytes.readUInt32LE(0x3c)
      const section = pe + 24 + bytes.readUInt16LE(pe + 20)
      const data = bytes.readUInt32LE(section + 20)
      bytes[data] ^= 1
      writeFileSync(copy, bytes)
      assert.equal(
        (await verifyHelperAtPath(copy, helperPublisherPolicy)).kind,
        'node',
      )
      assert.equal(
        (
          await verifyHelperAtPath(
            join(folder, 'missing.exe'),
            helperPublisherPolicy,
          )
        ).kind,
        'node',
      )
    } finally {
      rmSync(folder, { recursive: true, force: true })
    }
  },
)
