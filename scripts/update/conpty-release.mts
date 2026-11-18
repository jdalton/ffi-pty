import { signingRequest } from '../signing-http.mts'
import { createHash } from 'node:crypto'

export const conptyPackage = 'microsoft.windows.console.conpty'
export const nugetBase = 'https://api.nuget.org/v3-flatcontainer'
export type ConptyRequest = typeof signingRequest
export interface ConptyRelease {
  version: string
  published: string
  source: string
  sha512: string
}
export function compareVersions(a: string, b: string): number {
  const left = a.split('.').map(Number),
    right = b.split('.').map(Number)
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const difference = (left[index] || 0) - (right[index] || 0)
    if (difference) {
      return difference
    }
  }
  return 0
}
export async function nugetJson<T>(
  url: string,
  request: ConptyRequest = signingRequest,
): Promise<T> {
  if (new URL(url).origin !== 'https://api.nuget.org') {
    throw new Error('Unexpected NuGet origin')
  }
  const result = await request(url, {
    signal: AbortSignal.timeout(30_000),
    maxBytes: 8 * 1024 * 1024,
  })
  if (result.status !== 200) {
    throw new Error(`NuGet metadata failed (${result.status})`)
  }
  return JSON.parse(result.bytes.toString('utf8'))
}
export async function findConptyRelease(
  current: string,
  minimumAgeDays: number,
  now = Date.now(),
  request: ConptyRequest = signingRequest,
): Promise<ConptyRelease | undefined> {
  if (!Number.isFinite(minimumAgeDays) || minimumAgeDays < 0) {
    throw new Error('Invalid release age')
  }
  const index = await nugetJson<{ versions: string[] }>(
    `${nugetBase}/${conptyPackage}/index.json`,
    request,
  )
  const candidates: string[] = index.versions
    .filter(
      (version: unknown) =>
        typeof version === 'string' &&
        /^\d+\.\d+\.\d+(?:\.\d+)?$/.test(version) &&
        compareVersions(version, current) > 0,
    )
    .toSorted((a: string, b: string) => compareVersions(b, a))
  for (const version of candidates) {
    const registration = await nugetJson<{
      published: string
      listed: boolean
      catalogEntry: string
    }>(
      `https://api.nuget.org/v3/registration5-semver1/${conptyPackage}/${version}.json`,
      request,
    )
    const published = Date.parse(registration.published)
    if (
      !registration.listed ||
      !Number.isFinite(published) ||
      now - published < minimumAgeDays * 86_400_000
    ) {
      continue
    }
    const catalog = await nugetJson<{
      packageHashAlgorithm: string
      packageHash: string
    }>(registration.catalogEntry, request)
    if (
      catalog.packageHashAlgorithm !== 'SHA512' ||
      !/^[A-Za-z0-9+/]{86}==$/.test(catalog.packageHash)
    ) {
      throw new Error('Missing NuGet SHA512')
    }
    return {
      version,
      published: registration.published,
      source: `${nugetBase}/${conptyPackage}/${version}/${conptyPackage}.${version}.nupkg`,
      sha512: catalog.packageHash,
    }
  }
  return undefined
}
export async function downloadConpty(
  release: ConptyRelease,
  request: ConptyRequest = signingRequest,
): Promise<Buffer> {
  if (
    release.source !==
    `${nugetBase}/${conptyPackage}/${release.version}/${conptyPackage}.${release.version}.nupkg`
  ) {
    throw new Error('Unexpected ConPTY source')
  }
  const response = await request(release.source, {
    signal: AbortSignal.timeout(120_000),
    maxBytes: 32 * 1024 * 1024,
  })
  if (
    response.status !== 200 ||
    createHash('sha512').update(response.bytes).digest('base64') !==
      release.sha512
  ) {
    throw new Error('ConPTY archive download or checksum failed')
  }
  return response.bytes
}
