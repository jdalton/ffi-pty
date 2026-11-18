import { writeVerifiedCacheFile, sha256 } from '../../src/cache-write.mts'
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { brotliCompressSync, constants } from 'node:zlib'
import { createHash } from 'node:crypto'
import { conptyPaths } from '../../paths/conpty.mts'
import { extractZipMembers } from './conpty-zip.mts'
import {
  findConptyRelease,
  downloadConpty,
  type ConptyRelease,
} from './conpty-release.mts'

export const conptyMembers = Object.fromEntries(
  ['x64', 'arm64'].map(arch => [
    arch,
    {
      'conpty.dll': `runtimes/win-${arch}/native/conpty.dll`,
      'OpenConsole.exe': `build/native/runtimes/${arch}/OpenConsole.exe`,
    },
  ]),
)
export function packConpty(
  archive: Buffer,
  release: ConptyRelease,
  destination: string,
) {
  const members = extractZipMembers(
    archive,
    Object.values(conptyMembers).flatMap(Object.values),
  )
  const architectures: Record<
    string,
    Record<string, { size: number; sha256: string }>
  > = {}
  for (const [arch, files] of Object.entries(conptyMembers)) {
    mkdirSync(join(destination, arch), { recursive: true })
    architectures[arch] = {}
    for (const [name, path] of Object.entries(files)) {
      const bytes = members.get(path)!
      if (bytes.subarray(0, 2).toString() !== 'MZ') {
        throw new Error(`Invalid PE asset: ${path}`)
      }
      writeFileSync(
        join(destination, arch, `${name}.br`),
        brotliCompressSync(bytes, {
          params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
        }),
      )
      architectures[arch][name] = {
        size: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      }
    }
  }
  const manifest = {
    version: release.version,
    source: release.source,
    architectures,
  }
  writeFileSync(
    join(destination, 'manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n',
  )
  return manifest
}
export async function updateConpty(
  root?: string,
  dependencies = { find: findConptyRelease, download: downloadConpty },
) {
  const paths = conptyPaths(root)
  const original = readFileSync(paths.metadata, 'utf8')
  const metadata = JSON.parse(original)
  const current = metadata.tools.conpty
  const release = await dependencies.find(
    current.version,
    metadata.minimumReleaseAgeDays,
  )
  if (!release) {
    return { updated: false, version: current.version }
  }
  const archive = await dependencies.download(release)
  const staging = mkdtempSync(join(dirname(paths.assets), '.conpty-update-'))
  const backup = `${staging}-previous`
  let moved = false
  let installed = false
  try {
    const manifest = packConpty(archive, release, staging)
    writeFileSync(
      join(staging, 'LICENSE'),
      readFileSync(join(paths.assets, 'LICENSE')),
    )
    metadata.tools.conpty = {
      ...current,
      ...release,
      architectures: manifest.architectures,
    }
    // Keep the old assets until both the new bundle and metadata are written.
    // Publish metadata atomically; on a caught failure restore the old assets.
    renameSync(paths.assets, backup)
    moved = true
    renameSync(staging, paths.assets)
    installed = true
    const pin = Buffer.from(JSON.stringify(metadata, null, 2) + '\n')
    writeVerifiedCacheFile(paths.metadata, pin, sha256(pin))
  } catch (error) {
    if (installed) {
      rmSync(paths.assets, { recursive: true, force: true })
    }
    if (moved) {
      renameSync(backup, paths.assets)
    }
    throw error
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
  rmSync(backup, { recursive: true, force: true })
  return { updated: true, version: release.version }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const result = await updateConpty()
  console.log(
    `ConPTY ${result.version}: ${result.updated ? 'updated bundled assets' : 'no newer stable release passes the age gate'}`,
  )
}
