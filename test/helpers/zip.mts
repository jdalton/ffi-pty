import { crc32, deflateRawSync } from 'node:zlib'
export function zipFixture(
  files: Record<string, Buffer>,
  compressed = true,
): Buffer {
  const locals: Buffer[] = [],
    directory: Buffer[] = []
  let offset = 0
  for (const [path, bytes] of Object.entries(files)) {
    const name = Buffer.from(path),
      packed = compressed ? deflateRawSync(bytes) : bytes
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04_03_4b_50)
    local.writeUInt16LE(compressed ? 8 : 0, 8)
    local.writeUInt32LE(crc32(bytes), 14)
    local.writeUInt32LE(packed.length, 18)
    local.writeUInt32LE(bytes.length, 22)
    local.writeUInt16LE(name.length, 26)
    const entry = Buffer.alloc(46)
    entry.writeUInt32LE(0x02_01_4b_50)
    entry.writeUInt16LE(compressed ? 8 : 0, 10)
    entry.writeUInt32LE(crc32(bytes), 16)
    entry.writeUInt32LE(packed.length, 20)
    entry.writeUInt32LE(bytes.length, 24)
    entry.writeUInt16LE(name.length, 28)
    entry.writeUInt32LE(offset, 42)
    locals.push(local, name, packed)
    directory.push(entry, name)
    offset += local.length + name.length + packed.length
  }
  const central = Buffer.concat(directory),
    end = Buffer.alloc(22)
  end.writeUInt32LE(0x06_05_4b_50)
  end.writeUInt16LE(Object.keys(files).length, 8)
  end.writeUInt16LE(Object.keys(files).length, 10)
  end.writeUInt32LE(central.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, central, end])
}
