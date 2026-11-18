import { createHash, randomUUID } from 'node:crypto'
import {
  openSync,
  closeSync,
  writeFileSync,
  readFileSync,
  fsyncSync,
  renameSync,
  unlinkSync,
} from 'node:fs'
import { dirname, basename, join } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
export function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}
export function tryCacheCompression(
  path: string,
  platform = process.platform,
): boolean {
  if (platform !== 'win32') return false
  try {
    const { compressCacheFile } =
      require('./win32/windows-cache-compression.mts') as {
        compressCacheFile(path: string): boolean
      }
    return compressCacheFile(path)
  } catch {
    return false
  }
}
export interface CacheWriteDependencies {
  compress(path: string): boolean
  read(path: string): Buffer
  rename(from: string, to: string): void
}
export function writeVerifiedCacheFile(
  destination: string,
  bytes: Buffer,
  expectedHash: string,
  dependencies: CacheWriteDependencies = {
    compress: tryCacheCompression,
    read: readFileSync,
    rename: renameSync,
  },
): { compressed: boolean } {
  if (sha256(bytes) !== expectedHash) {
    throw new Error('Cache payload checksum mismatch')
  }
  const temporary = join(
    dirname(destination),
    `.${basename(destination)}-${randomUUID()}.tmp`,
  )
  let descriptor: number | undefined
  let published = false
  try {
    descriptor = openSync(temporary, 'wx', 0o600)
    // Set filesystem compression while the fresh file is empty. Write only
    // once, verify the logical bytes, then publish with a same-directory rename.
    // No reader sees the final path until the whole file has passed validation.
    let compressed = false
    try {
      compressed = dependencies.compress(temporary)
    } catch {
      /* compression is optional */
    }
    writeFileSync(descriptor, bytes)
    flushCacheFile(descriptor)
    if (sha256(dependencies.read(temporary)) !== expectedHash) {
      throw new Error('Cache read-back checksum mismatch')
    }
    closeSync(descriptor)
    descriptor = undefined
    dependencies.rename(temporary, destination)
    published = true
    return { compressed }
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
    if (!published) {
      try {
        unlinkSync(temporary)
      } catch (error) {
        // Preserve the original write or publication error if cleanup also fails.
        void error
      }
    }
  }
}

/**
 * Node disables fsync under its permission model even with filesystem access.
 * Cached assets are rebuildable; read-back verification and atomic rename
 * remain mandatory, while crash durability is best-effort under that model.
 */
export function flushCacheFile(
  descriptor: number,
  permissionModel = !!process.permission,
  flush = fsyncSync,
): void {
  if (!permissionModel) flush(descriptor)
}
