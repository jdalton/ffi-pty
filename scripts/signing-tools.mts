import { signingRequest } from './signing-http.mts'
import { createHash } from 'node:crypto'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

export const signingTools = [
  {
    name: 'client',
    algorithm: 'sha256',
    url: 'https://api.nuget.org/v3-flatcontainer/microsoft.artifactsigning.client/1.0.128/microsoft.artifactsigning.client.1.0.128.nupkg',
    digest: '74bd7d27e6ce1051409c38d9b46bc8df0400ecd643d51ffbf2ac00869061e40b',
  },
  {
    name: 'sdk',
    algorithm: 'sha256',
    url: 'https://api.nuget.org/v3-flatcontainer/microsoft.windows.sdk.buildtools/10.0.26100.4188/microsoft.windows.sdk.buildtools.10.0.26100.4188.nupkg',
    digest: '180deb372659029864c10a0c04787833234d64aacd1d2c0661d2c00295d8e022',
  },
  {
    name: 'dotnet',
    algorithm: 'sha512',
    url: 'https://builds.dotnet.microsoft.com/dotnet/Runtime/8.0.34/dotnet-runtime-8.0.34-win-x64.zip',
    digest:
      'd86d165a29dcdb71df23dd150a3fc5db6386fa55da5cb18c0c22889a0dab5071a3a2d852572e6cebfecf12b489870ac76243ae35665a746ed5b1011e7c68979d',
  },
] as const

export interface SigningTool {
  name: string
  algorithm: 'sha256' | 'sha512'
  url: string
  digest: string
}

export async function downloadTool(
  tool: SigningTool,
  request = signingRequest,
): Promise<Buffer> {
  const response = await request(tool.url, {
    signal: AbortSignal.timeout(120_000),
  })
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Signing tool download failed (${response.status})`)
  }
  const bytes = response.bytes
  if (createHash(tool.algorithm).update(bytes).digest('hex') !== tool.digest) {
    throw new Error(`Signing tool checksum mismatch: ${tool.name}`)
  }
  return bytes
}

export function extractTool(
  bytes: Buffer,
  folder: string,
  name: string,
  execute = execFileSync,
) {
  mkdirSync(folder, { recursive: true })
  const archive = join(folder, `${name}.zip`)
  const destination = join(folder, name)
  writeFileSync(archive, bytes)
  execute(
    'pwsh',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      'Expand-Archive -LiteralPath $env:SIGN_ARCHIVE -DestinationPath $env:SIGN_DESTINATION',
    ],
    {
      env: {
        ...process.env,
        SIGN_ARCHIVE: archive,
        SIGN_DESTINATION: destination,
      },
      stdio: 'pipe',
    },
  )
}

export async function installSigningTools(
  folder: string,
  download = downloadTool,
  extract = extractTool,
) {
  for (const tool of signingTools) {
    extract(await download(tool), folder, tool.name)
  }
  return {
    signtool: join(folder, 'sdk/bin/10.0.26100.0/x64/signtool.exe'),
    dlib: join(folder, 'client/bin/x64/Azure.CodeSigning.Dlib.dll'),
    dotnet: join(folder, 'dotnet'),
  }
}
