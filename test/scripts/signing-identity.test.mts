import assert from 'node:assert/strict'
import test from 'node:test'
import nock from 'nock'
import { githubIdentityToken } from '../../scripts/signing-identity.mts'

const origin = 'https://test.actions.githubusercontent.com'
const env = {
  ACTIONS_ID_TOKEN_REQUEST_URL: origin + '/token?api-version=2',
  ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'request-token',
}
test('OIDC uses GitHub bearer authorization and Azure audience without exposing returned tokens', async () => {
  const mock = nock(origin, {
    reqheaders: { authorization: 'Bearer request-token' },
  })
    .get('/token')
    .query({ 'api-version': '2', audience: 'api://AzureADTokenExchange' })
    .reply(200, { value: 'header.payload.signature' })
  assert.equal(await githubIdentityToken(env), 'header.payload.signature')
  assert.ok(mock.isDone())
})
test('OIDC refuses missing settings, non-GitHub endpoints, failed requests and malformed tokens', async () => {
  for (const url of [
    'http://test.actions.githubusercontent.com/token',
    'https://evil.example/token',
  ]) {
    await assert.rejects(
      githubIdentityToken({ ...env, ACTIONS_ID_TOKEN_REQUEST_URL: url }),
      /endpoint/,
    )
  }
  await assert.rejects(githubIdentityToken({}), /Missing/)
  await assert.rejects(
    githubIdentityToken({
      ACTIONS_ID_TOKEN_REQUEST_URL: env.ACTIONS_ID_TOKEN_REQUEST_URL,
    }),
    /Missing/,
  )
  for (const [status, body] of [
    [403, {}],
    [200, {}],
    [200, { value: 'invalid' }],
  ]) {
    const mock = nock(origin)
      .get('/token')
      .query(true)
      .reply(status as number, body)
    await assert.rejects(githubIdentityToken(env), /failed|invalid/)
    assert.ok(mock.isDone())
  }
})
