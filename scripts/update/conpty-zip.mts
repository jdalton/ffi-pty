import { inflateRawSync, crc32 } from 'node:zlib'

/**
 * Read only explicitly selected members. No archive path is written to disk.
 */
export function extractZipMembers(
  archive: Buffer,
  names: string[],
): Map<string, Buffer> {
  let end = archive.length - 22
  const minimum = Math.max(0, end - 65_535)
  while (end >= minimum && archive.readUInt32LE(end) !== 0x06_05_4b_50) {
    end--
  }
  if (
    end < minimum ||
    end + 22 + archive.readUInt16LE(end + 20) !== archive.length
  ) {
    throw new Error('Invalid ZIP directory')
  }
  if (
    archive.readUInt32LE(end + 4) !== 0 ||
    archive.readUInt16LE(end + 8) !== archive.readUInt16LE(end + 10)
  ) {
    throw new Error('Multipart ZIP is unsupported')
  }
  const count = archive.readUInt16LE(end + 10)
  const offset = archive.readUInt32LE(end + 16)
  const directoryEnd = offset + archive.readUInt32LE(end + 12)
  if (directoryEnd !== end) {
    throw new Error('Invalid ZIP directory bounds')
  }
  return extractZipDirectory(archive, names, count, offset, directoryEnd)
}

export function extractZipDirectory(
  archive: Buffer,
  names: string[],
  count: number,
  offset: number,
  directoryEnd: number,
): Map<string, Buffer> {
  const selected = new Set(names)
  const result = new Map<string, Buffer>()
  for (let index = 0; index < count; index++) {
    if (
      offset + 46 > directoryEnd ||
      archive.readUInt32LE(offset) !== 0x02_01_4b_50
    ) {
      throw new Error('Invalid ZIP entry')
    }
    const nameLength = archive.readUInt16LE(offset + 28)
    const next =
      offset +
      46 +
      nameLength +
      archive.readUInt16LE(offset + 30) +
      archive.readUInt16LE(offset + 32)
    if (next > directoryEnd) {
      throw new Error('Invalid ZIP entry bounds')
    }
    const name = archive.toString('utf8', offset + 46, offset + 46 + nameLength)
    if (selected.has(name)) {
      if (result.has(name)) {
        throw new Error('Duplicate ZIP member')
      }
      result.set(name, extractZipMember(archive, offset))
    }
    offset = next
  }
  if (offset !== directoryEnd || result.size !== selected.size) {
    throw new Error('Missing ZIP member or invalid directory')
  }
  return result
}

export function extractZipMember(archive: Buffer, entry: number): Buffer {
  const flags = archive.readUInt16LE(entry + 8)
  const method = archive.readUInt16LE(entry + 10)
  const size = archive.readUInt32LE(entry + 24)
  const packedSize = archive.readUInt32LE(entry + 20)
  const local = archive.readUInt32LE(entry + 42)
  if (flags & 1 || ![0, 8].includes(method) || size > 32 * 1024 * 1024) {
    throw new Error('Unsupported ZIP member')
  }
  if (
    local + 30 > archive.length ||
    archive.readUInt32LE(local) !== 0x04_03_4b_50
  ) {
    throw new Error('Invalid ZIP local header')
  }
  const start =
    local +
    30 +
    archive.readUInt16LE(local + 26) +
    archive.readUInt16LE(local + 28)
  if (start + packedSize > archive.length) {
    throw new Error('Truncated ZIP member')
  }
  const packed = archive.subarray(start, start + packedSize)
  const bytes =
    method === 0
      ? packed
      : inflateRawSync(packed, { maxOutputLength: Math.max(1, size) })
  if (
    bytes.length !== size ||
    crc32(bytes) !== archive.readUInt32LE(entry + 16)
  ) {
    throw new Error('ZIP member checksum mismatch')
  }
  return bytes
}
