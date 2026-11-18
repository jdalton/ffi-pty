import assert from 'node:assert/strict'
import { closeSync, fstatSync } from 'node:fs'
import { test } from 'vitest'
import { dlopen } from 'node:ffi'
import { initializeNonblockingPoll } from '../../src/unix-poll.mts'

test(
  'libuv poll initialization leaves the descriptor open and handles invalid fds',
  {
    timeout: 5000,
    skip: process.platform !== 'darwin',
  },
  () => {
    const { functions: c } = dlopen(null, {
      pipe: { arguments: ['pointer'], return: 'int32' },
    })
    assert.throws(() => initializeNonblockingPoll(-1), /uv_poll_init/)
    const pipeOut = Buffer.alloc(8)
    assert.equal(c.pipe(pipeOut), 0)
    const readFd = pipeOut.readInt32LE(),
      writeFd = pipeOut.readInt32LE(4)
    try {
      initializeNonblockingPoll(writeFd)
      assert.doesNotThrow(() => fstatSync(writeFd))
      assert.throws(() => initializeNonblockingPoll(-1), /uv_poll_init/)
      assert.doesNotThrow(() => fstatSync(writeFd))
    } finally {
      closeSync(writeFd)
      closeSync(readFd)
    }
  },
)

for (const [init, poll, close, message] of [
  [-1, 0, 0, /uv_loop_init/],
  [0, -1, 0, /uv_poll_init/],
  [0, -1, -2, /uv_loop_close/],
  [0, 0, -1, /uv_loop_close/],
  [0, 0, 0, null],
] as const) {
  test(`nonblocking setup handles libuv statuses ${init}/${poll}/${close}`, () => {
    const closed: number[] = []
    const native = {
      uv_loop_size: () => 64n,
      uv_handle_size: () => 64n,
      uv_loop_init: () => init,
      uv_poll_init: () => poll,
      uv_loop_close: () => close,
      uv_close: () => {
        closed.push(1)
      },
      uv_run: () => 0,
    }
    if (message) {
      assert.throws(() => initializeNonblockingPoll(1, native), message)
    } else {
      initializeNonblockingPoll(1, native)
      assert.deepEqual(closed, [1])
    }
  })
}
