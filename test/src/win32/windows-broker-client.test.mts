import type { ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import assert from 'node:assert/strict'
import { test } from 'vitest'
import {
  brokerStartupEnv,
  createNodeTransport,
} from '../../../src/win32/windows-broker-client.mts'

test('broker startup environment excludes target and Node injection variables', () => {
  assert.deepEqual(
    brokerStartupEnv({
      SystemRoot: 'C:\\Windows',
      WINDIR: 'C:\\Windows',
      TEMP: 'C:\\Temp',
      TMP: 'C:\\Temp',
      PATH: 'target-path',
      NODE_OPTIONS: '--require injected.js',
      NODE_PATH: 'target-modules',
    }),
    {
      SystemRoot: 'C:\\Windows',
      WINDIR: 'C:\\Windows',
      TEMP: 'C:\\Temp',
      TMP: 'C:\\Temp',
    },
  )
})

test('Node fallback transport starts and terminates its subprocess', async () => {
  const transport = createNodeTransport()
  let timer: NodeJS.Timeout
  try {
    await Promise.race([
      transport.ready,
      new Promise<void>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('broker subprocess did not become ready')),
          5000,
        )
      }),
    ])
  } finally {
    clearTimeout(timer!)
    await transport.terminate()
  }
  await transport.closed
})

export function brokerFixture() {
  const child = new EventEmitter() as EventEmitter &
    Pick<
      ChildProcess,
      'connected' | 'exitCode' | 'signalCode' | 'send' | 'kill'
    >
  const sent: unknown[] = []
  child.connected = true
  child.exitCode = null
  child.signalCode = null
  child.send = (message: unknown, callback: (error: Error | null) => void) => {
    sent.push(message)
    callback(null)
    return true
  }
  child.kill = () => {
    child.exitCode = 0
    child.emit('close')
    return true
  }
  const transport = createNodeTransport(
    child as ChildProcess,
    (() => ({ cols: 80 })) as never,
  )
  const errors: Error[] = []
  transport.onError(error => errors.push(error))
  child.emit('spawn')
  return { child, sent, transport, errors }
}

test('Node broker serializes START, forwards control messages, and rejects duplicate START', async () => {
  const f = brokerFixture()
  try {
    await f.transport.ready
    await f.transport.send({ type: 'start', options: {} as never })
    await f.transport.send({ type: 'connected' })
    assert.deepEqual(f.sent, [
      { type: 'preparedStart', start: { cols: 80 } },
      { type: 'connected' },
    ])
    await assert.rejects(
      f.transport.send({ type: 'start', options: {} as never }),
      /already sent/,
    )
    const replies: unknown[] = []
    const remove = f.transport.onMessage(reply => replies.push(reply))
    f.child.emit('message', { type: 'brokerDone' })
    remove()
    f.child.emit('message', { type: 'pipes' })
    f.child.emit('disconnect')
    assert.deepEqual(replies, [{ type: 'brokerDone' }])
    assert.deepEqual(f.errors, [])
  } finally {
    await f.transport.terminate()
  }
})

test('Node broker reports malformed replies, observer failures, unexpected disconnects and abnormal exits', async () => {
  const f = brokerFixture()
  f.transport.onMessage(() => {
    throw 'observer failure'
  })
  const remove = f.transport.onError(() => {
    throw new Error('ignored listener error')
  })
  for (const message of [null, 3, {}, { type: 4 }]) {
    f.child.emit('message', message)
  }
  f.child.emit('message', { type: 'spawned', pid: 1 })
  f.child.emit('disconnect')
  f.child.emit('error', new Error('child failed'))
  f.child.signalCode = 'SIGKILL'
  f.child.emit('close')
  await f.transport.closed
  await Promise.resolve()
  remove()
  assert.equal(
    f.errors.filter(error => /Invalid/.test(error.message)).length,
    4,
  )
  assert.ok(f.errors.some(error => /observer failure/.test(error.message)))
  assert.ok(f.errors.some(error => /disconnected/.test(error.message)))
  assert.ok(f.errors.some(error => /SIGKILL/.test(error.message)))
})

for (const signal of [null, 'SIGTERM'] as const) {
  test(`unexpected broker close reports ${signal ?? 'unknown exit status'} when no exit code is available`, async () => {
    const f = brokerFixture()
    f.child.signalCode = signal
    f.child.emit('close')
    await f.transport.closed
    assert.ok(
      f.errors.some(error => error.message.includes(signal ?? 'unknown')),
    )
  })
}
