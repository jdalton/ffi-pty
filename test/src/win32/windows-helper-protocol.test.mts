import {
  u32,
  stringField,
  utf16BufferField,
} from '../../../src/win32/windows-helper-protocol.mts'
import assert from 'node:assert/strict'
import { test } from 'vitest'
import {
  decodeHelperFrames,
  decodeHelperReply,
  encodeHelperFrame,
  encodeHelperReply,
  encodeHelperRequest,
  HELPER_MAGIC,
  HELPER_OPCODE,
  type PreparedWindowsStart,
} from '../../../src/win32/windows-helper-protocol.mts'

function utf16(value: string): Buffer {
  return Buffer.from(`${value}\0`, 'utf16le')
}

const prepared: PreparedWindowsStart = {
  cols: 101,
  rows: 37,
  application: utf16('C:\\🧪\\shell.exe'),
  commandLine: utf16('"C:\\🧪\\shell.exe" "hello world"'),
  cwd: utf16('C:\\工作'),
  environment: Buffer.from('Path=C:\\bin\0UNICODE=🍎\0\0', 'utf16le'),
  inputName: '\\\\.\\pipe\\pty-test-in',
  outputName: '\\\\.\\pipe\\pty-test-out',
}

test('START carries six length-prefixed UTF-16 fields and an exact environment double NUL', () => {
  const frame = encodeHelperRequest(
    {
      type: 'start',
      options: {
        file: 'unused',
        args: [],
        cols: 1,
        rows: 1,
        cwd: '.',
        env: {},
      },
    },
    prepared,
  )
  assert.equal(frame.readUInt32LE(0), HELPER_MAGIC)
  assert.equal(frame.readUInt32LE(4), HELPER_OPCODE.start)
  assert.equal(frame.readUInt32LE(8), 0)
  let offset = 24
  const fields: Buffer[] = []
  for (let i = 0; i < 6; i += 1) {
    const length = frame.readUInt32LE(offset)
    offset += 4
    fields.push(frame.subarray(offset, offset + length))
    offset += length
  }
  assert.equal(offset, frame.length)
  assert.equal(fields[0].toString('utf16le'), 'C:\\🧪\\shell.exe\0')
  assert.equal(
    fields[1].toString('utf16le'),
    '"C:\\🧪\\shell.exe" "hello world"\0',
  )
  assert.equal(fields[2].toString('utf16le'), 'C:\\工作\0')
  assert.equal(fields[3].toString('utf16le'), 'Path=C:\\bin\0UNICODE=🍎\0\0')
  assert.equal(fields[4].toString('utf16le'), '\\\\.\\pipe\\pty-test-in\0')
  assert.equal(fields[5].toString('utf16le'), '\\\\.\\pipe\\pty-test-out\0')
})

test('frame decoder handles split headers and coalesced frames', () => {
  const first = encodeHelperFrame(
    HELPER_OPCODE.spawned,
    0,
    Buffer.from([42, 0, 0, 0]),
  )
  const second = encodeHelperReply({ type: 'ack', id: 9 })
  const split = decodeHelperFrames(first.subarray(0, 9))
  assert.equal(split.frames.length, 0)
  const combined = decodeHelperFrames(
    Buffer.concat([first.subarray(9), second]),
    split.pending,
  )
  assert.deepEqual(combined.frames.map(decodeHelperReply), [
    { type: 'spawned', pid: 42 },
    { type: 'ack', id: 9 },
  ])
  assert.equal(combined.pending.length, 0)
})

test('command requests encode the locked opcode, id, and payload shape', () => {
  const resize = encodeHelperRequest({
    type: 'command',
    id: 41,
    command: 'resize',
    cols: 100,
    rows: 40,
  })
  assert.equal(resize.readUInt32LE(4), HELPER_OPCODE.resize)
  assert.equal(resize.readUInt32LE(8), 41)
  assert.equal(resize.readUInt32LE(16), 100)
  assert.equal(resize.readUInt32LE(20), 40)
  const kill = encodeHelperRequest({
    type: 'command',
    id: 42,
    command: 'kill',
    signal: 9,
  })
  assert.equal(kill.readUInt32LE(4), HELPER_OPCODE.kill)
  assert.equal(kill.readUInt32LE(8), 42)
  assert.equal(kill.readUInt32LE(16), 9)
})

test('frame decoder rejects invalid magic and oversized payload', () => {
  const invalid = encodeHelperFrame(HELPER_OPCODE.done, 0)
  invalid.writeUInt32LE(0, 0)
  assert.throws(() => decodeHelperFrames(invalid), /magic/)
  const oversized = Buffer.alloc(16)
  oversized.writeUInt32LE(HELPER_MAGIC)
  oversized.writeUInt32LE(HELPER_OPCODE.error, 4)
  oversized.writeUInt32LE(8 * 1024 * 1024 + 1, 12)
  assert.throws(() => decodeHelperFrames(oversized), /8 MiB/)
})

test('reply codec preserves ACK ids, error text, and process status', () => {
  for (const reply of [
    { type: 'ack', id: 2 },
    { type: 'ack', id: 3, error: 'resize failed' },
    { type: 'exited', exitCode: 17, signal: 0 },
    { type: 'error', error: 'CreateProcessW failed' },
    { type: 'brokerDone' },
  ] as const) {
    assert.deepEqual(
      decodeHelperReply(decodeHelperFrames(encodeHelperReply(reply)).frames[0]),
      reply,
    )
  }
})

test('START rejects malformed prepared UTF-16 fields', () => {
  const bad = { ...prepared, cwd: Buffer.from('not utf16 NUL') }
  assert.throws(
    () =>
      encodeHelperRequest(
        {
          type: 'start',
          options: { file: 'x', args: [], cols: 1, rows: 1, cwd: '.', env: {} },
        },
        bad,
      ),
    /UTF-16/,
  )
  assert.throws(
    () =>
      encodeHelperRequest(
        {
          type: 'start',
          options: { file: 'x', args: [], cols: 1, rows: 1, cwd: '.', env: {} },
        },
        { ...prepared, cwd: Buffer.from('a\0b\0', 'utf16le') },
      ),
    /interior NUL/,
  )
})

test('helper fields reject uint32 overflow, NUL pipe names, and malformed UTF-16 terminators', () => {
  for (const value of [-1, 1.5, Number.NaN, 0x1_00_00_00_00]) {
    assert.throws(() => u32(value, 'field'), /uint32/)
  }
  assert.equal(u32(0xff_ff_ff_ff, 'field').readUInt32LE(), 0xff_ff_ff_ff)
  assert.throws(() => stringField('pipe\0name'), /NUL/)
  for (const value of [Buffer.alloc(0), Buffer.alloc(1), Buffer.from([1, 1])]) {
    assert.throws(() => utf16BufferField(value), /NUL/)
  }
  for (const value of [Buffer.alloc(2), Buffer.from([1, 1, 0, 0])]) {
    assert.throws(() => utf16BufferField(value, true), /two NULs/)
  }
  assert.throws(
    () => encodeHelperFrame(1, 0, Buffer.alloc(8 * 1024 * 1024 + 1)),
    /8 MiB/,
  )
  assert.throws(
    () => encodeHelperRequest({ type: 'start' } as never),
    /required/,
  )
  assert.throws(
    () => encodeHelperRequest({ type: 'unknown' } as never),
    /unsupported/,
  )
  assert.throws(
    () =>
      encodeHelperReply({ type: 'startupPhase', phase: 'connecting input' }),
    /unsupported/,
  )
})

test('helper replies reject payloads inconsistent with their opcode and incomplete frame bodies remain pending', () => {
  for (const opcode of [
    HELPER_OPCODE.pipes,
    HELPER_OPCODE.done,
    HELPER_OPCODE.spawned,
    HELPER_OPCODE.exited,
    999,
  ]) {
    assert.throws(
      () => decodeHelperReply({ opcode, id: 0, payload: Buffer.alloc(1) }),
      /empty|pid|exit code|unknown/,
    )
  }
  const pipes = decodeHelperReply({
    opcode: HELPER_OPCODE.pipes,
    id: 0,
    payload: Buffer.alloc(0),
  })
  assert.deepEqual(pipes, { type: 'pipes', input: '', output: '' })
  assert.deepEqual(
    decodeHelperReply(
      decodeHelperFrames(encodeHelperReply({ type: 'spawned', pid: 42 }))
        .frames[0],
    ),
    { type: 'spawned', pid: 42 },
  )
  const frame = encodeHelperFrame(HELPER_OPCODE.error, 0, Buffer.from('error'))
  assert.deepEqual(decodeHelperFrames(frame.subarray(0, 18)), {
    frames: [],
    pending: frame.subarray(0, 18),
  })
})

test('helper pipe readiness encodes an empty payload and rejects truncated exit fields', () => {
  const decoded = decodeHelperFrames(
    encodeHelperReply({ type: 'pipes', input: '', output: '' }),
  )
  assert.deepEqual(decodeHelperReply(decoded.frames[0]!), {
    type: 'pipes',
    input: '',
    output: '',
  })
  for (const length of [0, 4]) {
    assert.throws(
      () =>
        decodeHelperReply({
          opcode: HELPER_OPCODE.exited,
          id: 0,
          payload: Buffer.alloc(length),
        }),
      /EXITED reply must contain/,
    )
  }
})
