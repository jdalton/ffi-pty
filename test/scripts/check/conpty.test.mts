import { spawnSync } from 'node:child_process'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { repositoryRoot } from '../../../paths/repository.mts'
import { verifyConptyAssets } from '../../../scripts/check/conpty.mts'

test('build verification rejects metadata drift, corrupt assets, and missing ConPTY licensing', () => {
  verifyConptyAssets()
  const root = mkdtempSync(join(tmpdir(), 'conpty-verify-'))
  try {
    mkdirSync(join(root, '.config'))
    cpSync(
      join(repositoryRoot, '.config/external-tools.json'),
      join(root, '.config/external-tools.json'),
    )
    cpSync(join(repositoryRoot, 'assets'), join(root, 'assets'), {
      recursive: true,
    })
    const file = join(root, 'assets/conpty/manifest.json'),
      source = readFileSync(file, 'utf8'),
      manifest = JSON.parse(source)
    manifest.version = '0.0.0'
    writeFileSync(file, JSON.stringify(manifest))
    assert.throws(() => verifyConptyAssets(root), /metadata/)
    writeFileSync(file, source)
    writeFileSync(join(root, 'assets/conpty/LICENSE'), 'missing')
    assert.throws(() => verifyConptyAssets(root), /license/)
    writeFileSync(join(root, 'assets/conpty/x64/conpty.dll.br'), 'corrupt')
    assert.throws(() => verifyConptyAssets(root))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('ConPTY verification CLI accepts the committed bundle', () => {
  const result = spawnSync(process.execPath, ['scripts/check/conpty.mts'], {
    encoding: 'utf8',
    timeout: 5000,
  })
  assert.equal(result.status, 0, result.stderr)
})
