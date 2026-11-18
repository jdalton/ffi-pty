import { brotliDecompressSync } from 'node:zlib'
import {
  readFileSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
} from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { sha256, writeVerifiedCacheFile } from '../cache-write.mts'

export const conptyAssets = new URL('../../assets/conpty/', import.meta.url)
export interface ConptyAsset {
  size: number
  sha256: string
}
export interface ConptyManifest {
  version: string
  architectures: Record<string, Record<string, ConptyAsset>>
}
export function verifyConptyDirectory(
  directory: string,
  files: Record<string, ConptyAsset>,
): boolean {
  try {
    return Object.entries(files).every(([name, expected]) => {
      const bytes = readFileSync(join(directory, name))
      return bytes.length === expected.size && sha256(bytes) === expected.sha256
    })
  } catch {
    return false
  }
}
/**
 * Extract locally, synchronously. Publish both files together so the DLL never
 * sees a missing OpenConsole.exe. Compression changes storage, not signed
 * bytes.
 */
export function prepareBundledConpty(
  arch = process.arch as string,
  cache = join(
    process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'),
    'ffi-pty',
    'conpty',
  ),
  assets = conptyAssets,
  write = writeVerifiedCacheFile,
): string {
  if (arch !== 'x64' && arch !== 'arm64') {
    throw new Error(`Unsupported ConPTY architecture: ${arch}`)
  }
  const manifest: ConptyManifest = JSON.parse(
    readFileSync(new URL('manifest.json', assets), 'utf8'),
  )
  const files = manifest.architectures[arch]
  const directory = join(cache, `${manifest.version}-${arch}`)
  if (verifyConptyDirectory(directory, files)) {
    return join(directory, 'conpty.dll')
  }
  mkdirSync(cache, { recursive: true })
  const staging = mkdtempSync(join(cache, '.extract-'))
  try {
    for (const name of ['conpty.dll', 'OpenConsole.exe']) {
      const expected = files[name]
      const bytes = brotliDecompressSync(
        readFileSync(new URL(`${arch}/${name}.br`, assets)),
        { maxOutputLength: expected.size },
      )
      if (bytes.length !== expected.size) {
        throw new Error('Invalid ConPTY asset size')
      }
      write(join(staging, name), bytes, expected.sha256)
    }
    try {
      renameSync(staging, directory)
    } catch (error) {
      // Another process may have published the same verified version first.
      // Never replace a corrupt or in-use directory silently.
      if (!verifyConptyDirectory(directory, files)) throw error
    }
    return join(directory, 'conpty.dll')
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}
