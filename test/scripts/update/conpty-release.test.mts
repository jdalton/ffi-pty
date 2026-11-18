import assert from 'node:assert/strict'
import { test, afterEach } from 'node:test'
import nock from 'nock'
import { createHash } from 'node:crypto'
import {
  compareVersions,
  findConptyRelease,
  downloadConpty,
  nugetJson,
  conptyPackage as name,
  nugetBase,
} from '../../../scripts/update/conpty-release.mts'

afterEach(() => {
  assert.ok(nock.isDone())
  nock.cleanAll()
})
test('ConPTY selection skips previews, fresh and unlisted releases and uses numeric version ordering', async () => {
  const api = nock('https://api.nuget.org')
  api.get(`/v3-flatcontainer/${name}/index.json`).reply(200, {
    versions: ['1.2.1', '1.2.9', '1.2.10', '1.2.11', '1.2.12', '1.3.0-preview'],
  })
  const now = Date.parse('2026-11-20')
  for (const [version, published, listed] of [
    ['1.2.12', '2026-11-19', true],
    ['1.2.11', '2026-10-01', false],
    ['1.2.10', '2026-10-01', true],
  ]) {
    api.get(`/v3/registration5-semver1/${name}/${version}.json`).reply(200, {
      published,
      listed,
      catalogEntry: 'https://api.nuget.org/catalog.json',
    })
  }
  const bytes = Buffer.from('archive'),
    hash = createHash('sha512').update(bytes).digest('base64')
  api
    .get('/catalog.json')
    .reply(200, { packageHashAlgorithm: 'SHA512', packageHash: hash })
  const release = await findConptyRelease('1.2.1', 7, now)
  assert.equal(release?.version, '1.2.10')
  api
    .get(`/v3-flatcontainer/${name}/1.2.10/${name}.1.2.10.nupkg`)
    .reply(200, bytes)
  assert.deepEqual(await downloadConpty(release!), bytes)
  assert.ok(compareVersions('1.2.10', '1.2.9') > 0)
  assert.equal(compareVersions('1.2.0', '1.2'), 0)
})
test('NuGet checks fail closed on unexpected origins, HTTP failures, invalid age and archive hashes', async () => {
  await assert.rejects(nugetJson('https://other.test/index'), /origin/)
  await assert.rejects(findConptyRelease('1.0.0', -1), /age/)
  nock('https://api.nuget.org').get('/missing').reply(404)
  await assert.rejects(nugetJson('https://api.nuget.org/missing'), /404/)
  const release = {
    version: '1.0.0',
    published: '2026-01-01',
    source: `${nugetBase}/${name}/1.0.0/${name}.1.0.0.nupkg`,
    sha512: 'bad',
  }
  nock('https://api.nuget.org')
    .get(`/v3-flatcontainer/${name}/1.0.0/${name}.1.0.0.nupkg`)
    .reply(200, 'bad')
  await assert.rejects(downloadConpty(release), /checksum/)
  await assert.rejects(
    downloadConpty({ ...release, source: 'https://other.test' }),
    /source/,
  )
})

test('NuGet selection rejects missing hashes and returns no release when none is eligible', async () => {
  const api = nock('https://api.nuget.org')
  const index = `/v3-flatcontainer/${name}/index.json`
  api.get(index).reply(200, { versions: [null, '1.0.0', '2.0.0-preview'] })
  assert.equal(await findConptyRelease('1.0.0', 7), undefined)
  for (const catalog of [
    { packageHashAlgorithm: 'SHA256', packageHash: 'a'.repeat(86) + '==' },
    { packageHashAlgorithm: 'SHA512', packageHash: 'invalid' },
  ]) {
    api.get(index).reply(200, { versions: ['2.0.0'] })
    api.get(`/v3/registration5-semver1/${name}/2.0.0.json`).reply(200, {
      listed: true,
      published: '2020-01-01',
      catalogEntry: 'https://api.nuget.org/hash.json',
    })
    api.get('/hash.json').reply(200, catalog)
    await assert.rejects(findConptyRelease('1.0.0', 7), /Missing NuGet SHA512/)
  }
})
