import {
  createHelperVerifier,
  readSystemDirectory,
} from '../../../src/win32/windows-helper-trust.mts'
import assert from 'node:assert/strict'
import { test } from 'vitest'
import {
  classifyAuthenticodeResult,
  buildAuthenticodeVerifierEnv,
  getVerifiedHelper,
  runPowerShellAuthenticodeVerifier,
  systemPowerShellPath,
  verifyHelperAtPath,
  type AuthenticodeResult,
} from '../../../src/win32/windows-helper-trust.mts'
import type { HelperPublisherPolicy } from '../../../src/win32/windows-helper-publisher.mts'
import type { WindowsHelperLock } from '../../../src/win32/windows-helper-lock.mts'

const policy: HelperPublisherPolicy = {
  subject: 'CN=PTY Test',
  issuer: 'CN=Test CA',
}
const valid: AuthenticodeResult = {
  status: 'Valid',
  subject: policy.subject,
  issuer: policy.issuer,
}

test('Authenticode trust requires exact valid status, subject, and configured issuer', () => {
  assert.deepEqual(classifyAuthenticodeResult('helper.exe', policy, valid), {
    kind: 'native',
    path: 'helper.exe',
    subject: policy.subject,
  })
  assert.equal(
    classifyAuthenticodeResult('helper.exe', policy, {
      ...valid,
      status: 'HashMismatch',
    }).kind,
    'node',
  )
  assert.equal(
    classifyAuthenticodeResult('helper.exe', policy, {
      ...valid,
      subject: 'CN=Other',
    }).kind,
    'node',
  )
  assert.equal(
    classifyAuthenticodeResult('helper.exe', policy, {
      ...valid,
      issuer: 'CN=Other',
    }).kind,
    'node',
  )
  assert.equal(
    classifyAuthenticodeResult('helper.exe', { subject: '' }, valid).kind,
    'node',
  )
})

test('helper verification reuses the same promise and result for signed or unsigned builds', async () => {
  const first = getVerifiedHelper()
  assert.equal(first, getVerifiedHelper())
  assert.equal(await first, await getVerifiedHelper())
})

test('PowerShell location and module path ignore caller SystemRoot and PSModulePath', () => {
  const trustedSystemDirectory = 'C:\\Windows\\System32'
  const source = Object.assign(Object.create(null), {
    SystemRoot: 'C:\\attacker\\root',
    WINDIR: 'C:\\attacker\\windir',
    PSModulePath: 'C:\\attacker\\modules',
    PATH: 'C:\\attacker\\bin',
    TEMP: 'C:\\temp',
  }) as NodeJS.ProcessEnv
  const systemDirectory = () => trustedSystemDirectory
  const env = buildAuthenticodeVerifierEnv(
    source,
    'C:\\trusted\\helper.exe',
    systemDirectory,
  )
  assert.equal(
    systemPowerShellPath(systemDirectory),
    'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
  )
  assert.equal(env.SystemRoot, 'C:\\Windows')
  assert.equal(env.WINDIR, 'C:\\Windows')
  assert.equal(
    env.PSModulePath,
    'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules',
  )
  assert.equal(env.TEMP, 'C:\\temp')
  assert.equal(env.PATH, undefined)
})

test('unsigned or unreadable helper exits before lock and verifier', async () => {
  let locks = 0
  let verifications = 0
  const result = await verifyHelperAtPath(
    'helper.exe',
    policy,
    async () => {
      verifications++
      return valid
    },
    {
      sniff: () => ({ present: false, reason: 'missing certificate' }),
      lock: () => {
        locks++
        throw new Error('must not lock')
      },
    },
  )
  assert.equal(result.kind, 'node')
  assert.equal(locks, 0)
  assert.equal(verifications, 0)
})

test('positive verification retains the lock; failed verification releases it', async () => {
  let retained = 0
  let released = 0
  const makeLock = (): WindowsHelperLock => ({
    path: 'locked.exe',
    release: () => released++,
  })
  const deps = {
    sniff: () => ({ present: true, reason: 'certificate table present' }),
    lock: () => makeLock(),
    retain: () => retained++,
  }
  assert.equal(
    (await verifyHelperAtPath('helper.exe', policy, async () => valid, deps))
      .kind,
    'native',
  )
  assert.equal(retained, 1)
  assert.equal(released, 0)
  const failure = await verifyHelperAtPath(
    'helper.exe',
    policy,
    async () => {
      throw new Error('bad signature')
    },
    deps,
  )
  assert.equal(failure.kind, 'node')
  assert.equal(released, 1)
})

test(
  'missing helper falls back without invoking Authenticode',
  { skip: process.platform !== 'win32' },
  async () => {
    let invoked = false
    const result = await verifyHelperAtPath(
      'C:\\definitely-missing\\pty-helper.exe',
      policy,
      async () => {
        invoked = true
        return valid
      },
    )
    assert.equal(result.kind, 'node')
    assert.equal(invoked, false)
  },
)

test('system directory lookup rejects failed, oversized and relative native results', () => {
  for (const length of [0, 32_768]) {
    assert.throws(
      () => readSystemDirectory({ GetSystemDirectoryW: () => length }),
      /failed/,
    )
  }
  assert.throws(
    () =>
      readSystemDirectory({
        GetSystemDirectoryW: buffer => {
          buffer.write('relative', 'utf16le')
          return 8
        },
      }),
    /non-absolute/,
  )
  assert.throws(() => systemPowerShellPath(() => 'relative'), /absolute/)
  assert.throws(
    () => buildAuthenticodeVerifierEnv({}, 'helper', () => 'relative'),
    /absolute/,
  )
})

test('memoized helper verification caches success and path or verifier failures without rejecting', async () => {
  let calls = 0
  const get = createHelperVerifier(
    policy,
    () => {
      calls++
      return 'helper.exe'
    },
    async () => ({
      kind: 'native',
      path: 'helper.exe',
      subject: policy.subject,
    }),
  )
  assert.equal(get(), get())
  assert.equal((await get()).kind, 'native')
  assert.equal(calls, 1)
  const empty = createHelperVerifier({ subject: '' }, () => {
    throw new Error('must not resolve')
  })
  assert.match(
    ((await empty()) as { reason: string }).reason,
    /no helper publisher/,
  )
  const pathFailure = createHelperVerifier(policy, () => {
    throw new Error('path failure')
  })
  assert.match(
    ((await pathFailure()) as { reason: string }).reason,
    /unavailable.*path failure/,
  )
  const verificationFailure = createHelperVerifier(
    policy,
    () => 'helper.exe',
    async () => {
      throw new Error('verify failure')
    },
  )
  assert.match(
    ((await verificationFailure()) as { reason: string }).reason,
    /verification failed.*verify failure/,
  )
})

test('PowerShell results must contain string status, subject and issuer fields', async () => {
  for (const result of [
    { status: 3 },
    { status: 'Valid', subject: 3 },
    { status: 'Valid', subject: 'name', issuer: 3 },
  ]) {
    await assert.rejects(
      runPowerShellAuthenticodeVerifier(
        'helper.exe',
        policy,
        () => 'C:\\Windows\\System32',
        (async () => ({ stdout: JSON.stringify(result) })) as never,
      ),
      /invalid Authenticode/,
    )
  }
  const result = await runPowerShellAuthenticodeVerifier(
    'helper.exe',
    policy,
    () => 'C:\\Windows\\System32',
    (async (
      _file: string,
      _args: unknown,
      options: { env: NodeJS.ProcessEnv },
    ) => {
      assert.equal(options.env.FFI_PTY_HELPER_PATH, 'helper.exe')
      return { stdout: JSON.stringify(valid) }
    }) as never,
  )
  assert.deepEqual(result, valid)
})

test('unconfigured publishers and invalid signatures fall back even when releasing a lock throws', async () => {
  const unconfigured = await verifyHelperAtPath(
    'helper.exe',
    { subject: '' },
    async () => {
      throw new Error('must not inspect')
    },
  )
  assert.equal(unconfigured.kind, 'node')
  const result = await verifyHelperAtPath(
    'helper.exe',
    policy,
    async () => ({ ...valid, status: 'HashMismatch' }),
    {
      sniff: () => ({ present: true, reason: 'table' }),
      lock: () => ({
        path: 'helper.exe',
        release() {
          throw new Error('release failed')
        },
      }),
    },
  )
  assert.equal(result.kind, 'node')
})

test('trusted helper retains its lock when the default process-lifetime owner is used', async () => {
  let released = false
  const result = await verifyHelperAtPath(
    'helper.exe',
    policy,
    async () => valid,
    {
      sniff: () => ({ present: true, reason: 'certificate present' }),
      lock: () => ({
        path: 'locked-helper.exe',
        release: () => {
          released = true
        },
      }),
    },
  )
  assert.deepEqual(result, {
    kind: 'native',
    path: 'locked-helper.exe',
    subject: policy.subject,
  })
  assert.equal(released, false)
})
