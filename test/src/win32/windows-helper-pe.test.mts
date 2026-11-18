import fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { syncBuiltinESMExports } from 'node:module'
import { sniffPeCertificate } from '../../../src/win32/windows-helper-pe.mts'
import assert from 'node:assert/strict'
import { test, vi } from 'vitest'
import {
  inspectPeCertificate,
  type PeReader,
} from '../../../src/win32/windows-helper-pe.mts'

export function peFixture(bits: 32 | 64, certificate = true): Buffer {
  const peOffset = 0x80
  const optionalSize = bits === 32 ? 224 : 240
  const optionalOffset = peOffset + 24
  const certificateOffset = optionalOffset + optionalSize
  const file = Buffer.alloc(
    certificate ? certificateOffset + 8 : certificateOffset,
  )
  file.write('MZ', 0, 'ascii')
  file.writeUInt32LE(peOffset, 0x3c)
  file.write('PE\0\0', peOffset, 'binary')
  file.writeUInt16LE(optionalSize, peOffset + 20)
  file.writeUInt16LE(bits === 32 ? 0x1_0b : 0x2_0b, peOffset + 24)
  const numberOffset = bits === 32 ? 92 : 108
  const directoryOffset = bits === 32 ? 96 : 112
  file.writeUInt32LE(16, optionalOffset + numberOffset)
  if (certificate) {
    file.writeUInt32LE(
      certificateOffset,
      optionalOffset + directoryOffset + 4 * 8,
    )
    file.writeUInt32LE(8, optionalOffset + directoryOffset + 4 * 8 + 4)
    file.writeUInt32LE(8, certificateOffset)
    file.writeUInt16LE(0x02_00, certificateOffset + 4)
    file.writeUInt16LE(2, certificateOffset + 6)
  }
  return file
}

export function trackedReader(file: Buffer, size = file.length) {
  let bytesRequested = 0
  const reader: PeReader = {
    size,
    read(offset, length) {
      bytesRequested += length
      return file.subarray(offset, offset + length)
    },
  }
  return {
    reader,
    get bytesRequested() {
      return bytesRequested
    },
  }
}

for (const bits of [32, 64] as const) {
  test(`PE${bits} certificate sniff checks header and certificate record`, () => {
    const tracked = trackedReader(peFixture(bits))
    assert.equal(inspectPeCertificate(tracked.reader).present, true)
    assert.equal(tracked.bytesRequested, 110)
  })

  test(`PE${bits} absent certificate table stops after 102 header bytes`, () => {
    const tracked = trackedReader(peFixture(bits, false))
    assert.equal(inspectPeCertificate(tracked.reader).present, false)
    assert.ok(tracked.bytesRequested <= 102)
  })
}

test('DOS header overlap stops after 64 bytes without reading the PE header', () => {
  const file = peFixture(64)
  file.writeUInt32LE(32, 0x3c)
  const tracked = trackedReader(file)
  assert.equal(inspectPeCertificate(tracked.reader).present, false)
  assert.equal(tracked.bytesRequested, 64)
})

test('certificate offset overlapping optional header is rejected', () => {
  const file = peFixture(64)
  const peOffset = file.readUInt32LE(0x3c)
  const optionalOffset = peOffset + 24
  const directoryOffset = optionalOffset + 112 + 4 * 8
  file.writeUInt32LE(optionalOffset, directoryOffset)
  const tracked = trackedReader(file)
  assert.equal(inspectPeCertificate(tracked.reader).present, false)
  assert.equal(tracked.bytesRequested, 102)
})

test('claimed payload size does not increase header bytes read', () => {
  const tracked = trackedReader(peFixture(64), 0x7f_ff_ff_ff)
  assert.equal(inspectPeCertificate(tracked.reader).present, true)
  assert.equal(tracked.bytesRequested, 110)
})

test('out-of-range PE offset stops after the 64-byte DOS header', () => {
  const file = peFixture(64)
  file.writeUInt32LE(0xff_ff_ff_ff, 0x3c)
  const tracked = trackedReader(file)
  assert.equal(inspectPeCertificate(tracked.reader).present, false)
  assert.equal(tracked.bytesRequested, 64)
})

test('out-of-range certificate size is rejected from headers', () => {
  const file = peFixture(64)
  const optionalOffset = file.readUInt32LE(0x3c) + 24
  const entry = optionalOffset + 112 + 4 * 8
  file.writeUInt32LE(0xff_ff_ff_ff, entry + 4)
  const tracked = trackedReader(file)
  assert.equal(inspectPeCertificate(tracked.reader).present, false)
  assert.equal(tracked.bytesRequested, 102)
})

test('bad optional magic, directory count, and certificate record are rejected', () => {
  const badMagic = peFixture(64)
  badMagic.writeUInt16LE(0x7_77, badMagic.readUInt32LE(0x3c) + 24)
  assert.equal(
    inspectPeCertificate(trackedReader(badMagic).reader).present,
    false,
  )

  const noDirectories = peFixture(64)
  const optionalOffset = noDirectories.readUInt32LE(0x3c) + 24
  noDirectories.writeUInt32LE(4, optionalOffset + 108)
  const noDirectoryRead = trackedReader(noDirectories)
  assert.equal(inspectPeCertificate(noDirectoryRead.reader).present, false)
  assert.equal(noDirectoryRead.bytesRequested, 94)

  const badRecord = peFixture(64)
  const certOffset = badRecord.readUInt32LE(optionalOffset + 112 + 4 * 8)
  badRecord.writeUInt16LE(0x01_00, certOffset + 4)
  assert.equal(
    inspectPeCertificate(trackedReader(badRecord).reader).present,
    false,
  )
})

test('short positional reads are rejected safely', () => {
  const full = peFixture(64)
  const reader: PeReader = {
    size: full.length,
    read(offset, length) {
      return full.subarray(offset, offset + Math.max(0, length - 1))
    },
  }
  assert.equal(inspectPeCertificate(reader).present, false)
})

test('invalid file sizes and short directory or certificate reads are rejected without reading payloads', () => {
  const file = peFixture(64)
  for (const size of [Number.NaN, 63]) {
    assert.equal(
      inspectPeCertificate({
        size,
        read: () => {
          throw new Error('must not read')
        },
      }).present,
      false,
    )
  }
  for (const shortCall of [3, 4, 5]) {
    let calls = 0
    const result = inspectPeCertificate({
      size: file.length,
      read(offset, length) {
        return file.subarray(
          offset,
          offset + (++calls === shortCall ? length - 1 : length),
        )
      },
    })
    assert.equal(result.present, false)
  }
})

test('certificate sniff reads actual files, reports missing files, and closes descriptors after an inspection failure', () => {
  const root = fs.mkdtempSync(join(tmpdir(), 'pe-sniff-'))
  const path = join(root, 'helper.exe')
  fs.writeFileSync(path, peFixture(64))
  try {
    assert.equal(sniffPeCertificate(path).present, true)
    assert.match(
      sniffPeCertificate(join(root, 'missing')).reason,
      /cannot open/,
    )
    vi.spyOn(fs, 'fstatSync').mockImplementation(() => {
      throw new Error('stat failed')
    })
    syncBuiltinESMExports()
    assert.match(sniffPeCertificate(path).reason, /cannot inspect.*stat failed/)
  } finally {
    vi.restoreAllMocks()
    syncBuiltinESMExports()
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('PE file inspection rejects a file truncated between stat and header reads', () => {
  const directory = fs.mkdtempSync(join(tmpdir(), 'pty-pe-short-'))
  const file = join(directory, 'helper.exe')
  fs.writeFileSync(file, peFixture(64))
  const original = fs.readSync
  try {
    vi.spyOn(fs, 'readSync').mockImplementation((...args) => {
      original(...args)
      return 0
    })
    syncBuiltinESMExports()
    assert.equal(sniffPeCertificate(file).present, false)
  } finally {
    vi.restoreAllMocks()
    syncBuiltinESMExports()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
