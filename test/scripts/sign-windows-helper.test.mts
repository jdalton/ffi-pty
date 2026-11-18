import { spawnSync } from 'node:child_process'
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  existsSync,
  mkdtempSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  inspectSignedFile,
  signWindowsHelper,
  signingMain,
  signedFileHash,
  type SigningDependencies,
} from '../../scripts/sign-windows-helper.mts'
import { helperPublisherPolicy } from '../../src/win32/windows-helper-publisher.mts'
import { signingEnv, peFixture } from './signing-policy.test.mts'

test('signing validates Windows and PE targets before obtaining an identity', async () => {
  const deps = { platform: 'darwin' } as SigningDependencies
  await assert.rejects(
    signWindowsHelper('missing', 'x64', signingEnv, deps),
    /Windows/,
  )
  await assert.rejects(signingMain([]), /Usage/)
  await assert.rejects(signingMain(['file']), /Usage/)
  await assert.rejects(signingMain(['file', 'x64', 'extra']), /Usage/)
})

test('signing uses workload identity only, verifies the result, and removes the assertion on every failure path', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sign-test-'))
  const file = join(root, 'helper.exe')
  writeFileSync(file, peFixture())
  try {
    for (const failure of [
      '',
      'install',
      'token',
      'sign',
      'verify',
      'inspect',
    ]) {
      let folder = ''
      let calls = 0
      const deps: SigningDependencies = {
        platform: 'win32',
        install: async dir => {
          folder = dir
          if (failure === 'install') {
            throw new Error('install')
          }
          return {
            signtool: 'signtool.exe',
            dlib: 'dlib.dll',
            dotnet: 'dotnet',
          }
        },
        token: async () => {
          if (failure === 'token') {
            throw new Error('token')
          }
          return 'secret.assertion.token'
        },
        execute: ((_command, args, options) => {
          calls++
          const env = options.env
          assert.equal(
            readFileSync(env.AZURE_FEDERATED_TOKEN_FILE, 'utf8'),
            'secret.assertion.token',
          )
          assert.equal(env.DOTNET_ROOT_X64, 'dotnet')
          assert.equal(env.AZURE_CLIENT_ID, signingEnv.AZURE_CLIENT_ID)
          assert.equal(
            JSON.parse(readFileSync(join(folder, 'metadata.json'), 'utf8'))
              .CertificateProfileName,
            'ffi-pty',
          )
          if (failure === args[0]) {
            throw new Error(failure)
          }
          return Buffer.alloc(0)
        }) as SigningDependencies['execute'],
        inspect: () => {
          if (failure === 'inspect') {
            throw new Error('inspect')
          }
        },
      }
      if (failure) {
        await assert.rejects(
          signWindowsHelper(file, 'x64', signingEnv, deps),
          new RegExp(failure),
        )
      } else {
        assert.equal(
          await signWindowsHelper(file, 'x64', signingEnv, deps),
          signedFileHash(file),
        )
        assert.equal(calls, 2)
      }
      assert.equal(existsSync(folder), false)
    }
    const summary = join(root, 'summary.md')
    const sign = async () => 'a'.repeat(64)
    await signingMain([file, 'x64'], { GITHUB_STEP_SUMMARY: summary }, sign)
    assert.match(readFileSync(summary, 'utf8'), /Signed Windows x64/)
    await signingMain([file, 'arm64'], {}, sign)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('PowerShell evidence parsing handles UTF-8 BOM and refuses malformed or invalid evidence', () => {
  const inspect = (value: string) =>
    inspectSignedFile('file.exe', ((_cmd, args, options) => {
      assert.equal(options.env.SIGN_FILE, 'file.exe')
      assert.ok(args.includes('-NonInteractive'))
      return value
    }) as SigningDependencies['execute'])
  inspect(
    '\uFEFF' +
      JSON.stringify({
        status: 'Valid',
        subject: helperPublisherPolicy.subject,
        timestamp: true,
      }),
  )
  assert.throws(() => inspect('not json'))
  assert.throws(() => inspect(JSON.stringify({ status: 'NotSigned' })))
})

test('signing CLI rejects missing arguments without exposing credentials', () => {
  const result = spawnSync(
    process.execPath,
    ['scripts/sign-windows-helper.mts'],
    { encoding: 'utf8', timeout: 5000 },
  )
  assert.equal(result.status, 1)
  assert.match(result.stderr, /signing failed/)
})
