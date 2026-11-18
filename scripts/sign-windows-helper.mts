import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { githubIdentityToken } from './signing-identity.mts'
import { installSigningTools } from './signing-tools.mts'
import {
  assertPeArchitecture,
  assertSignedFile,
  signingConfiguration,
  signingMetadata,
  signArguments,
} from './signing-policy.mts'

export const inspectSignatureScript = String.raw`
$ErrorActionPreference = 'Stop'
$sig = Get-AuthenticodeSignature -LiteralPath $env:SIGN_FILE
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
@{status=[string]$sig.Status; subject=$sig.SignerCertificate.Subject; timestamp=($null -ne $sig.TimeStamperCertificate)} | ConvertTo-Json -Compress
`

export function inspectSignedFile(file: string, execute = execFileSync): void {
  const output = execute(
    'pwsh',
    ['-NoProfile', '-NonInteractive', '-Command', inspectSignatureScript],
    {
      env: { ...process.env, SIGN_FILE: file },
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 30_000,
    },
  )
  assertSignedFile(JSON.parse(String(output).replace(/^\uFEFF/, '')))
}

export function signedFileHash(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

export interface SigningDependencies {
  platform: string
  install: typeof installSigningTools
  token: typeof githubIdentityToken
  execute: typeof execFileSync
  inspect: typeof inspectSignedFile
}

export async function signWindowsHelper(
  file: string,
  arch: string,
  env = process.env,
  deps: SigningDependencies = {
    platform: process.platform,
    install: installSigningTools,
    token: githubIdentityToken,
    execute: execFileSync,
    inspect: inspectSignedFile,
  },
): Promise<string> {
  if (deps.platform !== 'win32') {
    throw new Error('Signing requires Windows')
  }
  const config = signingConfiguration(env)
  assertPeArchitecture(readFileSync(file), arch)
  const folder = mkdtempSync(join(tmpdir(), 'ffi-pty-sign-'))
  try {
    const tools = await deps.install(folder)
    const metadata = join(folder, 'metadata.json')
    const tokenFile = join(folder, 'identity.jwt')
    writeFileSync(metadata, JSON.stringify(signingMetadata(config)))
    // Acquire after installing tools so the short-lived assertion is fresh.
    // WorkloadIdentityCredential exchanges it inside Microsoft's signing client.
    writeFileSync(tokenFile, await deps.token(env), { mode: 0o600 })
    const signingEnv = {
      ...env,
      AZURE_TENANT_ID: config.tenant,
      AZURE_CLIENT_ID: config.client,
      AZURE_FEDERATED_TOKEN_FILE: tokenFile,
      AZURE_AUTHORITY_HOST: 'https://login.microsoftonline.com/',
      DOTNET_ROOT: tools.dotnet,
      DOTNET_ROOT_X64: tools.dotnet,
    }
    deps.execute(tools.signtool, signArguments(file, tools.dlib, metadata), {
      env: signingEnv,
      stdio: 'pipe',
      timeout: 180_000,
    })
    deps.execute(tools.signtool, ['verify', '/pa', '/all', '/tw', file], {
      env: signingEnv,
      stdio: 'pipe',
      timeout: 60_000,
    })
    deps.inspect(file)
    return signedFileHash(file)
  } finally {
    // The assertion and tools never enter dist or workflow artifacts.
    rmSync(folder, { recursive: true, force: true })
  }
}

export async function signingMain(
  args: string[],
  env = process.env,
  sign = signWindowsHelper,
) {
  const [file, arch] = args
  if (!file || !arch || args.length !== 2) {
    throw new Error('Usage: sign-windows-helper.mts <helper.exe> <x64|arm64>')
  }
  const hash = await sign(resolve(file), arch, env)
  const summary = `Signed Windows ${arch} helper. Authenticode, publisher and timestamp verified. SHA-256: ${hash}\n`
  console.log(summary)
  if (env.GITHUB_STEP_SUMMARY) {
    writeFileSync(env.GITHUB_STEP_SUMMARY, summary, { flag: 'a' })
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    await signingMain(process.argv.slice(2))
  } catch {
    console.error(
      'Windows helper signing failed. No package may be published from this run.',
    )
    process.exitCode = 1
  }
}
