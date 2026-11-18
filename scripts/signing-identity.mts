import { signingRequest } from './signing-http.mts'
import { requiredSetting } from './signing-policy.mts'

export async function githubIdentityToken(
  env: NodeJS.ProcessEnv,
  request = signingRequest,
): Promise<string> {
  const url = new URL(requiredSetting(env, 'ACTIONS_ID_TOKEN_REQUEST_URL'))
  if (
    url.protocol !== 'https:' ||
    !url.hostname.endsWith('.actions.githubusercontent.com')
  ) {
    throw new Error('Unexpected GitHub OIDC endpoint')
  }
  url.searchParams.set('audience', 'api://AzureADTokenExchange')
  const response = await request(url, {
    headers: {
      Authorization: `Bearer ${requiredSetting(env, 'ACTIONS_ID_TOKEN_REQUEST_TOKEN')}`,
    },
    signal: AbortSignal.timeout(30_000),
  })
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`GitHub OIDC request failed (${response.status})`)
  }
  const body = JSON.parse(response.bytes.toString('utf8')) as {
    value?: unknown
  }
  if (
    typeof body.value !== 'string' ||
    !/^[\w-]+\.[\w-]+\.[\w-]+$/.test(body.value)
  ) {
    throw new Error('GitHub returned an invalid identity token')
  }
  return body.value
}
