import assert from 'node:assert/strict'
import test from 'node:test'
import nock from 'nock'
import { signingRequest } from '../../scripts/signing-http.mts'

test('signing HTTP preserves binary bytes and status and never follows redirects', async () => {
  nock('https://example.test')
    .get('/data')
    .reply(200, Buffer.from([0, 255, 1]))
  assert.deepEqual(await signingRequest('https://example.test/data'), {
    status: 200,
    bytes: Buffer.from([0, 255, 1]),
  })
  nock('https://example.test')
    .get('/redirect')
    .reply(302, '', { Location: 'https://other.test/' })
  assert.equal(
    (await signingRequest('https://example.test/redirect')).status,
    302,
  )
})
test('signing HTTP rejects transport errors and aborted requests', async () => {
  nock('https://example.test').get('/error').replyWithError('fixture failure')
  await assert.rejects(
    signingRequest('https://example.test/error'),
    /fixture failure/,
  )
  await assert.rejects(
    signingRequest('https://example.test/abort', {
      signal: AbortSignal.abort(),
    }),
    /abort/i,
  )
})

test('signing HTTP stops oversized tool downloads instead of buffering them indefinitely', async () => {
  nock('https://example.test').get('/large').reply(200, 'oversized')
  await assert.rejects(
    signingRequest('https://example.test/large', { maxBytes: 4 }),
    /size limit/,
  )
})
