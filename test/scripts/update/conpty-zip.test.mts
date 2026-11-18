import assert from 'node:assert/strict'
import { test } from 'node:test'
import { extractZipMembers } from '../../../scripts/update/conpty-zip.mts'
import { zipFixture } from '../../helpers/zip.mts'

test('ZIP extraction returns only selected stored or deflated members without writing archive paths', () => {
  for (const compressed of [false, true]) {
    const zip = zipFixture(
      { chosen: Buffer.from('dll'), '../escape': Buffer.from('bad') },
      compressed,
    )
    assert.deepEqual(
      [...extractZipMembers(zip, ['chosen'])],
      [['chosen', Buffer.from('dll')]],
    )
    assert.throws(() => extractZipMembers(zip, ['missing']), /Missing/)
  }
})
test('ZIP extraction rejects corrupt directories, encrypted members, bad CRCs and oversized members', () => {
  assert.throws(() => extractZipMembers(Buffer.alloc(0), []), /ZIP/)
  const original = zipFixture({ dll: Buffer.from('MZdata') })
  const end = original.length - 22,
    central = original.readUInt32LE(end + 16)
  for (const [offset, value, width] of [
    [end + 4, 1, 2],
    [central, 0, 4],
    [central + 8, 1, 2],
    [central + 16, 0, 4],
    [central + 24, 40 * 1024 * 1024, 4],
    [central + 42, 0xff_ff_ff_ff, 4],
    [0, 0, 4],
  ]) {
    const corrupt = Buffer.from(original)
    if (width === 2) {
      corrupt.writeUInt16LE(value, offset)
    } else {
      corrupt.writeUInt32LE(value, offset)
    }
    assert.throws(() => extractZipMembers(corrupt, ['dll']))
  }
})

test('ZIP extraction validates comments, directory bounds and member lengths', () => {
  const original = zipFixture({ dll: Buffer.from('MZdata') }, false)
  const end = original.length - 22
  const central = original.readUInt32LE(end + 16)
  const comment = Buffer.concat([original, Buffer.from('comment')])
  comment.writeUInt16LE(7, end + 20)
  assert.deepEqual(
    extractZipMembers(comment, ['dll']).get('dll'),
    Buffer.from('MZdata'),
  )
  for (const [offset, value, width, message] of [
    [end + 20, 1, 2, /directory/],
    [end + 12, 1, 4, /bounds/],
    [end + 8, 2, 2, /Multipart/],
    [central + 28, 65_535, 2, /bounds/],
    [central + 10, 99, 2, /Unsupported/],
    [central + 20, 0xff_ff_ff_ff, 4, /Truncated/],
    [central + 24, 1, 4, /checksum/],
  ] as const) {
    const bytes = Buffer.from(original)
    if (width === 2) {
      bytes.writeUInt16LE(value, offset)
    } else {
      bytes.writeUInt32LE(value, offset)
    }
    assert.throws(() => extractZipMembers(bytes, ['dll']), message)
  }
  const duplicate = zipFixture({
    dll: Buffer.from('one'),
    exe: Buffer.from('two'),
  })
  const directory = duplicate.readUInt32LE(duplicate.length - 6)
  duplicate.write('dll', directory + 49 + 46)
  assert.throws(() => extractZipMembers(duplicate, ['dll']), /Duplicate/)
})
