import assert from 'node:assert/strict'
import test from 'node:test'
import {
  signingConfiguration,
  signingMetadata,
  requiredSetting,
  assertPeArchitecture,
  assertSignedFile,
  signArguments,
  signingArchitectures,
} from '../../scripts/signing-policy.mts'
import { helperPublisherPolicy } from '../../src/win32/windows-helper-publisher.mts'

export const signingEnv = {
  GITHUB_REPOSITORY: 'jdalton/ffi-pty',
  GITHUB_REF: 'refs/heads/main',
  GITHUB_EVENT_NAME: 'workflow_dispatch',
  AZURE_TENANT_ID: '11111111-1111-1111-1111-111111111111',
  AZURE_CLIENT_ID: '22222222-2222-2222-2222-222222222222',
  AZURE_ARTIFACT_SIGNING_ENDPOINT: 'https://eus.codesigning.azure.net/',
  AZURE_ARTIFACT_SIGNING_ACCOUNT_NAME: 'jdalton',
  AZURE_ARTIFACT_SIGNING_CERTIFICATE_PROFILE_NAME: 'ffi-pty',
}
export function peFixture(arch = 'x64'): Buffer {
  const bytes = Buffer.alloc(128)
  bytes.write('MZ')
  bytes.writeUInt32LE(64, 0x3c)
  bytes.writeUInt32LE(0x45_50, 64)
  bytes.writeUInt16LE(arch === 'x64' ? 0x86_64 : 0xaa_64, 68)
  return bytes
}

test('signing accepts only manual main runs in the expected repository and exact Azure destination', () => {
  const config = signingConfiguration(signingEnv)
  assert.equal(config.account, 'jdalton')
  for (const [key, value] of Object.entries(signingEnv)) {
    assert.throws(() =>
      signingConfiguration({ ...signingEnv, [key]: value + 'wrong' }),
    )
    assert.throws(() => signingConfiguration({ ...signingEnv, [key]: '' }))
  }
  assert.equal(requiredSetting({ KEY: ' ok ' }, 'KEY'), 'ok')
  assert.throws(() => requiredSetting({}, 'KEY'))
  assert.throws(() => requiredSetting({ KEY: 'a\nb' }, 'KEY'))
  const metadata = signingMetadata(config)
  assert.equal(metadata.CertificateProfileName, 'ffi-pty')
  assert.ok(metadata.ExcludeCredentials.includes('AzureCliCredential'))
  assert.ok(!metadata.ExcludeCredentials.includes('WorkloadIdentityCredential'))
  assert.deepEqual(signArguments('a file.exe', 'client.dll', 'metadata.json'), [
    'sign',
    '/fd',
    'SHA256',
    '/tr',
    'http://timestamp.acs.microsoft.com',
    '/td',
    'SHA256',
    '/dlib',
    'client.dll',
    '/dmdf',
    'metadata.json',
    'a file.exe',
  ])
})

test('signing rejects malformed PE files and mismatched target architectures', () => {
  for (const arch of signingArchitectures) {
    assertPeArchitecture(peFixture(arch), arch)
  }
  assert.throws(() => assertPeArchitecture(peFixture(), 'x86'))
  assert.throws(() => assertPeArchitecture(Buffer.alloc(2), 'x64'))
  assert.throws(() => assertPeArchitecture(Buffer.alloc(128), 'x64'))
  assert.throws(() => assertPeArchitecture(peFixture(), 'arm64'))
  const badOffset = peFixture()
  badOffset.writeUInt32LE(500, 0x3c)
  assert.throws(() => assertPeArchitecture(badOffset, 'x64'))
  const badSignature = peFixture()
  badSignature.writeUInt32LE(0, 64)
  assert.throws(() => assertPeArchitecture(badSignature, 'x64'))
})

test('signed file evidence requires valid Authenticode, exact approved publisher and timestamp', () => {
  const good = {
    status: 'Valid',
    subject: helperPublisherPolicy.subject,
    timestamp: true,
  }
  assertSignedFile(good)
  assert.throws(
    () => assertSignedFile({ ...good, status: 'HashMismatch' }),
    /verification/,
  )
  assert.throws(
    () => assertSignedFile({ ...good, subject: 'CN=Other' }),
    /publisher/,
  )
  assert.throws(
    () => assertSignedFile({ ...good, timestamp: false }),
    /timestamp/,
  )
})
