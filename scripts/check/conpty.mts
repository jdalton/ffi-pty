import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { brotliDecompressSync } from 'node:zlib'
import { conptyPaths } from '../../paths/conpty.mts'
import { sha256 } from '../../src/cache-write.mts'
import type { ConptyManifest } from '../../src/win32/conpty-assets.mts'

export function verifyConptyAssets(root?: string): void {
  const paths = conptyPaths(root)
  const pinned = JSON.parse(readFileSync(paths.metadata, 'utf8')).tools.conpty
  const manifest: ConptyManifest & { source: string } = JSON.parse(
    readFileSync(join(paths.assets, 'manifest.json'), 'utf8'),
  )
  if (
    manifest.version !== pinned.version ||
    manifest.source !== pinned.source ||
    JSON.stringify(manifest.architectures) !==
      JSON.stringify(pinned.architectures)
  ) {
    throw new Error('ConPTY bundle does not match pinned metadata')
  }
  for (const arch of ['x64', 'arm64']) {
    for (const name of ['conpty.dll', 'OpenConsole.exe']) {
      const expected = manifest.architectures[arch][name]
      const bytes = brotliDecompressSync(
        readFileSync(join(paths.assets, arch, `${name}.br`)),
        { maxOutputLength: expected.size },
      )
      if (bytes.length !== expected.size || sha256(bytes) !== expected.sha256) {
        throw new Error(`ConPTY asset checksum mismatch: ${arch}/${name}`)
      }
    }
  }
  if (
    !readFileSync(join(paths.assets, 'LICENSE'), 'utf8').includes('Microsoft')
  ) {
    throw new Error('ConPTY license is missing')
  }
}
