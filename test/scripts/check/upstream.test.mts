import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  cpSync,
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { checkUpstream } from '../../../scripts/check/upstream.mts'

test('upstream completeness gate rejects changed assertions and missing local adaptations without a submodule', () => {
  const root = mkdtempSync(join(tmpdir(), 'upstream-review-'))
  const fixtures = join(root, 'test/upstream/node-pty')
  try {
    cpSync(new URL('../../upstream/node-pty/', import.meta.url), fixtures, {
      recursive: true,
    })
    checkUpstream(root)
    const file = join(fixtures, 'original/src/terminal.test.ts.txt')
    const original = readFileSync(file)
    writeFileSync(file, 'changed')
    assert.throws(() => checkUpstream(root), /assertions changed/)
    writeFileSync(file, original)
    rmSync(join(fixtures, 'src/terminal.test.mts'))
    assert.throws(() => checkUpstream(root), /Missing upstream adaptation/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the committed upstream suite has a reviewed adaptation for every test file', () => {
  checkUpstream()
})

test('upstream review rejects added files before comparing individual assertions', () => {
  const root = mkdtempSync(join(tmpdir(), 'upstream-added-'))
  const fixtures = join(root, 'test/upstream/node-pty')
  try {
    cpSync(new URL('../../upstream/node-pty/', import.meta.url), fixtures, {
      recursive: true,
    })
    writeFileSync(join(fixtures, 'reviewed.json'), '{}')
    assert.throws(() => checkUpstream(root), /test files changed/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
