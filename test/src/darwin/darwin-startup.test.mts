import assert from 'node:assert/strict'
import { closeSync, writeSync } from 'node:fs'
import { test, vi } from 'vitest'
import {
  createStartupPipe,
  execWithStartup,
  reportStartupFailure,
  markCloseOnExec,
  STARTUP_READY,
  validateStartupResult,
  waitForStartup,
} from '../../../src/darwin/darwin-startup.mts'

test('startup accepts only ready followed by EOF, not empty or failed bootstrap replies', () => {
  assert.doesNotThrow(() => validateStartupResult(STARTUP_READY))
  for (const value of [
    '',
    'login_tty failed',
    `${STARTUP_READY}execve failed`,
  ]) {
    assert.throws(() => validateStartupResult(value), /startup failed/)
  }
})

test('close-on-exec setup propagates kernel failure', () => {
  assert.throws(
    () => markCloseOnExec(3, { ioctl: () => -1 } as never),
    /close-on-exec/,
  )
})

for (const scenario of [
  'success',
  'empty',
  'failure',
  'oversized',
  'timeout',
] as const) {
  test(
    `startup pipe ${scenario} settles and closes its descriptor`,
    { skip: process.platform !== 'darwin', timeout: 5000 },
    async () => {
      vi.useFakeTimers({ toFake: ['setTimeout'] })
      const pipe = createStartupPipe()
      const result = waitForStartup(pipe.read, 25)
      let writerOpen = true
      try {
        if (scenario !== 'timeout') {
          writeSync(
            pipe.write,
            scenario === 'success'
              ? STARTUP_READY
              : scenario === 'empty'
                ? ''
                : scenario === 'oversized'
                  ? 'x'.repeat(4097)
                  : `${STARTUP_READY}execve error`,
          )
          closeSync(pipe.write)
          writerOpen = false
        }
        if (scenario === 'success') await result
        else {
          const rejected = assert.rejects(result, /startup|4096/)
          if (scenario === 'timeout') vi.advanceTimersByTime(25)
          await rejected
        }
      } finally {
        if (writerOpen) closeSync(pipe.write)
        vi.useRealTimers()
      }
    },
  )
}

for (const failure of ['pipe', 'stdio', 'cloexec']) {
  test(`startup pipe releases both descriptors after ${failure} failure`, () => {
    const closed: number[] = []
    const native = {
      pipe(fds: Buffer) {
        fds.writeInt32LE(failure === 'stdio' ? 0 : 10)
        fds.writeInt32LE(11, 4)
        return failure === 'pipe' ? -1 : 0
      },
      ioctl: () => -1,
      close(fd: number) {
        closed.push(fd)
        return 0
      },
    }
    assert.throws(
      () => createStartupPipe(native as never),
      /startup pipe|standard/,
    )
    assert.deepEqual(
      closed,
      failure === 'pipe' ? [] : [failure === 'stdio' ? 0 : 10, 11],
    )
  })
}

test('exec startup refuses to lose inherited standard streams', () => {
  assert.throws(
    () =>
      execWithStartup('/unused', [], { OMITTED: undefined }, {
        ioctl: () => -1,
      } as never),
    /preserve PTY stdio/,
  )
})

test('startup failure reports truncate messages and tolerate a dead parent', () => {
  const messages: unknown[][] = []
  const write = (...args: unknown[]) => {
    messages.push(args)
    return 0
  }
  reportStartupFailure(new Error('x'.repeat(4096)), write as never)
  reportStartupFailure('plain failure', write as never)
  assert.deepEqual(messages, [
    [3, 'x'.repeat(2048)],
    [3, 'plain failure'],
  ])
  assert.doesNotThrow(() =>
    reportStartupFailure(null, (() => {
      throw new Error('EPIPE')
    }) as never),
  )
})
