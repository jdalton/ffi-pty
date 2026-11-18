import { helperPublisherPolicy } from '../src/win32/windows-helper-publisher.mts'

export const signingArchitectures = ['x64', 'arm64'] as const
export const timestampUrl = 'http://timestamp.acs.microsoft.com'
export const excludedCredentials = [
  'EnvironmentCredential',
  'ManagedIdentityCredential',
  'SharedTokenCacheCredential',
  'VisualStudioCredential',
  'VisualStudioCodeCredential',
  'AzureCliCredential',
  'AzurePowerShellCredential',
  'AzureDeveloperCliCredential',
  'InteractiveBrowserCredential',
]

export interface SigningConfiguration {
  tenant: string
  client: string
  endpoint: string
  account: string
  profile: string
}

export function requiredSetting(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]?.trim()
  if (!value || /[\r\n]/.test(value)) {
    throw new Error(`Missing or invalid ${key}`)
  }
  return value
}

export function signingConfiguration(
  env: NodeJS.ProcessEnv,
): SigningConfiguration {
  if (
    env.GITHUB_REPOSITORY !== 'jdalton/ffi-pty' ||
    env.GITHUB_REF !== 'refs/heads/main' ||
    env.GITHUB_EVENT_NAME !== 'workflow_dispatch'
  ) {
    throw new Error('Signing requires a manual run from jdalton/ffi-pty main')
  }
  const tenant = requiredSetting(env, 'AZURE_TENANT_ID')
  const client = requiredSetting(env, 'AZURE_CLIENT_ID')
  for (const value of [tenant, client]) {
    if (!/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(value)) {
      throw new Error('Invalid Azure identity ID')
    }
  }
  const endpoint = requiredSetting(env, 'AZURE_ARTIFACT_SIGNING_ENDPOINT')
  const account = requiredSetting(env, 'AZURE_ARTIFACT_SIGNING_ACCOUNT_NAME')
  const profile = requiredSetting(
    env,
    'AZURE_ARTIFACT_SIGNING_CERTIFICATE_PROFILE_NAME',
  )
  if (
    endpoint.replace(/\/$/, '') !== 'https://eus.codesigning.azure.net' ||
    account !== 'jdalton' ||
    profile !== 'ffi-pty'
  ) {
    throw new Error('Unexpected signing destination')
  }
  return { tenant, client, endpoint, account, profile }
}

export function signingMetadata(config: SigningConfiguration) {
  return {
    Endpoint: config.endpoint,
    CodeSigningAccountName: config.account,
    CertificateProfileName: config.profile,
    // Only workload identity may authenticate. Never fall back to a runner login.
    ExcludeCredentials: excludedCredentials,
  }
}

export function signArguments(
  file: string,
  dlib: string,
  metadata: string,
): string[] {
  return [
    'sign',
    '/fd',
    'SHA256',
    '/tr',
    timestampUrl,
    '/td',
    'SHA256',
    '/dlib',
    dlib,
    '/dmdf',
    metadata,
    file,
  ]
}

export interface SignedFileEvidence {
  status: string
  subject: string
  timestamp: boolean
}

export function assertSignedFile(evidence: SignedFileEvidence): void {
  if (evidence.status !== 'Valid') {
    throw new Error('Authenticode verification failed')
  }
  if (evidence.subject !== helperPublisherPolicy.subject) {
    throw new Error('Unexpected helper publisher')
  }
  if (evidence.timestamp !== true) {
    throw new Error('Signed helper has no verified timestamp')
  }
}

export function assertPeArchitecture(bytes: Buffer, arch: string): void {
  const expected = arch === 'x64' ? 0x86_64 : arch === 'arm64' ? 0xaa_64 : 0
  if (
    !expected ||
    bytes.length < 64 ||
    bytes.toString('ascii', 0, 2) !== 'MZ'
  ) {
    throw new Error('Invalid helper PE')
  }
  const offset = bytes.readUInt32LE(0x3c)
  if (
    offset > bytes.length - 6 ||
    bytes.readUInt32LE(offset) !== 0x45_50 ||
    bytes.readUInt16LE(offset + 4) !== expected
  ) {
    throw new Error('Helper architecture mismatch')
  }
}
