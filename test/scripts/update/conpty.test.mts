import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  readdirSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  conptyMembers,
  updateConpty,
  packConpty,
} from '../../../scripts/update/conpty.mts'
import { zipFixture } from '../../helpers/zip.mts'
import { prepareBundledConpty } from '../../../src/win32/conpty-assets.mts'
import { pathToFileURL } from 'node:url'

test('ConPTY update keeps both architectures together, writes pinned hashes, and leaves unchanged releases alone', async t => {
  const root = mkdtempSync(join(tmpdir(), 'conpty-update-'))
  try {
    mkdirSync(join(root, '.config'))
    mkdirSync(join(root, 'assets/conpty'), { recursive: true })
    writeFileSync(join(root, 'assets/conpty/LICENSE'), 'license')
    writeFileSync(
      join(root, '.config/external-tools.json'),
      JSON.stringify({
        minimumReleaseAgeDays: 7,
        tools: { conpty: { version: '1.0.0' } },
      }),
    )
    const release = {
      version: '1.0.1',
      source: 'source',
      published: '2026-01-01',
      sha512: 'hash',
    }
    const bytes = Buffer.from('MZfixture')
    const archive = zipFixture(
      Object.fromEntries(
        Object.values(conptyMembers)
          .flatMap(Object.values)
          .map(path => [path, bytes]),
      ),
    )
    const dependencies = {
      find: async () => release,
      download: async () => archive,
    }
    assert.deepEqual(await updateConpty(root, dependencies), {
      updated: true,
      version: '1.0.1',
    })
    const metadata = JSON.parse(
      readFileSync(join(root, '.config/external-tools.json'), 'utf8'),
    )
    assert.equal(metadata.tools.conpty.version, '1.0.1')
    for (const arch of ['x64', 'arm64']) {
      const path = prepareBundledConpty(
        arch,
        join(root, 'cache'),
        pathToFileURL(join(root, 'assets/conpty/')),
      )
      assert.deepEqual(readFileSync(path), bytes)
    }
    assert.deepEqual(
      await updateConpty(root, {
        ...dependencies,
        find: async () => undefined,
      }),
      { updated: false, version: '1.0.1' },
    )
    const before = readFileSync(
      join(root, '.config/external-tools.json'),
      'utf8',
    )
    await assert.rejects(
      updateConpty(root, {
        ...dependencies,
        download: async () => Buffer.alloc(0),
      }),
    )
    assert.equal(
      readFileSync(join(root, '.config/external-tools.json'), 'utf8'),
      before,
    )
    for (const failure of ['assets', 'metadata']) {
      const rename = fs.renameSync
      t.mock.method(fs, 'renameSync', (from, to) => {
        const target =
          failure === 'assets'
            ? join(root, 'assets/conpty')
            : join(root, '.config/external-tools.json')
        if (to === target && !String(from).endsWith('-previous')) {
          throw new Error('publication failed')
        }
        return rename(from, to)
      })
      syncBuiltinESMExports()
      try {
        await assert.rejects(
          updateConpty(root, dependencies),
          /publication failed/,
        )
        assert.equal(
          readFileSync(join(root, '.config/external-tools.json'), 'utf8'),
          before,
        )
        assert.equal(
          JSON.parse(
            readFileSync(join(root, 'assets/conpty/manifest.json'), 'utf8'),
          ).version,
          '1.0.1',
        )
      } finally {
        t.mock.restoreAll()
        syncBuiltinESMExports()
      }
    }
    assert.deepEqual(readdirSync(join(root, 'assets')), ['conpty'])
    assert.throws(
      () =>
        packConpty(
          zipFixture(
            Object.fromEntries(
              Object.values(conptyMembers)
                .flatMap(Object.values)
                .map(path => [path, Buffer.from('bad')]),
            ),
          ),
          release,
          join(root, 'invalid'),
        ),
      /PE asset/,
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
