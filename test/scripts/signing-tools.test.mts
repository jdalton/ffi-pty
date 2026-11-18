import type { execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'
import test from 'node:test'
import nock from 'nock'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  downloadTool,
  extractTool,
  installSigningTools,
  signingTools,
  type SigningTool,
} from '../../scripts/signing-tools.mts'

test('tool downloads enforce reviewed hashes and reject HTTP or integrity failures offline', async () => {
  const bytes = Buffer.from('fixture archive')
  const tool: SigningTool = {
    name: 'test',
    algorithm: 'sha256',
    url: 'https://api.nuget.org/fixture',
    digest: createHash('sha256').update(bytes).digest('hex'),
  }
  const mock = nock('https://api.nuget.org').get('/fixture').reply(200, bytes)
  assert.deepEqual(await downloadTool(tool), bytes)
  assert.ok(mock.isDone())
  nock('https://api.nuget.org').get('/fixture').reply(404)
  await assert.rejects(downloadTool(tool), /download failed/)
  nock('https://api.nuget.org').get('/fixture').reply(200, 'changed')
  await assert.rejects(downloadTool(tool), /checksum/)
})
test('tool extraction passes paths through environment variables and installs pinned tools in isolation', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'sign-tools-test-'))
  try {
    const execute = ((command, args, options) => {
      assert.equal(command, 'pwsh')
      assert.ok(args.includes('-NonInteractive'))
      assert.equal(options.env.SIGN_DESTINATION, join(folder, 'client'))
      assert.equal(readFileSync(options.env.SIGN_ARCHIVE, 'utf8'), 'archive')
      return Buffer.alloc(0)
    }) as typeof execFileSync
    extractTool(Buffer.from('archive'), folder, 'client', execute)
    const downloaded: string[] = []
    const extracted: string[] = []
    const tools = await installSigningTools(
      folder,
      async tool => {
        downloaded.push(tool.name)
        return Buffer.from(tool.name)
      },
      (bytes, _folder, name) => {
        assert.equal(bytes.toString(), name)
        extracted.push(name)
      },
    )
    assert.deepEqual(
      downloaded,
      signingTools.map(t => t.name),
    )
    assert.deepEqual(extracted, downloaded)
    assert.ok(tools.signtool.endsWith(join('x64', 'signtool.exe')))
    assert.ok(tools.dlib.endsWith('Azure.CodeSigning.Dlib.dll'))
    assert.equal(tools.dotnet, join(folder, 'dotnet'))
  } finally {
    rmSync(folder, { recursive: true, force: true })
  }
})
