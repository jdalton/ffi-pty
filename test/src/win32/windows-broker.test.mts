import { EventEmitter } from 'node:events'
import type { NodeBrokerChannel } from '../../../src/win32/windows-broker-ipc.mts'
import type { BrokerReply } from '../../../src/win32/windows-protocol.mts'
import type { WindowsTransport } from '../../../src/win32/windows-transport.mts'
import type { BrokerDependencies } from '../../../src/win32/windows-broker.mts'
import assert from 'node:assert/strict'
import { test } from 'vitest'
import { Worker } from 'node:worker_threads'
import {
  asError,
  forwardBrokerRequest,
  isBrokerEntry,
  listenForBrokerStart,
  runBroker,
  terminateWorkerBounded,
} from '../../../src/win32/windows-broker.mts'

test('broker implementation can be imported without starting a lifecycle', () => {
  assert.equal(typeof runBroker, 'function')
  assert.equal(isBrokerEntry(), false)
  assert.equal(asError('failure').message, 'failure')
  const forwarded: string[] = []
  const transport = {
    send: async (request: { type: string }) => {
      forwarded.push(request.type)
    },
  } as any
  return forwardBrokerRequest(transport, { type: 'connected' }).then(() => {
    assert.deepEqual(forwarded, ['connected'])
  })
})

test('broker termination waits only for its bounded worker grace', async () => {
  const transport = { terminate: () => new Promise<void>(() => {}) } as any
  const started = Date.now()
  await terminateWorkerBounded(transport, 20)
  assert.ok(Date.now() - started < 1000)
})

test('broker module import in an idle worker exits without a lifecycle', async () => {
  const worker = new Worker(
    new URL('../../../src/win32/windows-broker.mts', import.meta.url),
    { workerData: null },
  )
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      void worker.terminate()
      reject(new Error('idle worker did not exit after broker import'))
    }, 3000)
    worker.once('error', error => {
      clearTimeout(timer)
      reject(error)
    })
    worker.once('exit', code => {
      clearTimeout(timer)
      if (code === 0) resolve()
      else reject(new Error(`idle Windows worker exited with code ${code}`))
    })
  })
})

export function brokerHarness() {
  const channel = new EventEmitter() as EventEmitter & NodeBrokerChannel
  const replies: BrokerReply[] = []
  const requests: unknown[] = []
  const exits: number[] = []
  channel.connected = true
  channel.send = (reply, callback) => {
    replies.push(reply)
    callback?.(null)
    return true
  }
  channel.disconnect = () => {
    channel.connected = false
    channel.emit('disconnect')
  }
  let finish!: () => void
  const messages = new Set<(reply: BrokerReply) => void>()
  const errors = new Set<(error: Error) => void>()
  const transport: WindowsTransport = {
    ready: Promise.resolve(),
    closed: new Promise<void>(resolve => {
      finish = resolve
    }),
    send: async request => {
      requests.push(request)
    },
    terminate: async () => {
      finish()
    },
    onMessage(listener) {
      messages.add(listener)
      return () => {
        messages.delete(listener)
      }
    },
    onError(listener) {
      errors.add(listener)
      return () => {
        errors.delete(listener)
      }
    },
  }
  const dependencies: BrokerDependencies = {
    createTransport: () => transport,
    exit: ((code: number) => {
      exits.push(code)
    }) as typeof process.exit,
  }
  return {
    channel,
    replies,
    requests,
    exits,
    transport,
    dependencies,
    finish,
    messages,
    errors,
  }
}

for (const done of [true, false]) {
  test(`broker drains queued replies and ${done ? 'preserves' : 'adds'} its completion reply`, async () => {
    const f = brokerHarness()
    const state = { started: false }
    const running = runBroker({} as never, f.channel, f.dependencies, state)
    f.channel.emit('message', { type: 'connected' })
    for (const listener of f.messages) {
      listener({ type: 'spawned', pid: 42 })
      if (done) listener({ type: 'brokerDone' })
    }
    f.finish()
    await running
    assert.deepEqual(f.replies, [
      { type: 'spawned', pid: 42 },
      { type: 'brokerDone' },
    ])
    assert.deepEqual(f.requests, [{ type: 'connected' }])
    assert.equal(f.channel.connected, false)
    assert.equal(f.messages.size, 0)
    assert.equal(f.errors.size, 0)
    await assert.rejects(
      runBroker({} as never, f.channel, f.dependencies, state),
      /only one session/,
    )
  })
}

for (const connected of [true, false]) {
  test(`broker cleans up transport creation failure with IPC ${connected ? 'connected' : 'disconnected'}`, async () => {
    const f = brokerHarness()
    f.channel.connected = connected
    f.dependencies.createTransport = () => {
      throw new Error('create failed')
    }
    await runBroker({} as never, f.channel, f.dependencies, { started: false })
    assert.equal(f.replies.length, connected ? 2 : 0)
    assert.equal(f.channel.connected, false)
  })
}

for (const mode of [
  'worker-error',
  'request-error',
  'duplicate-start',
  'disconnect',
  'ready-error',
  'send-error',
]) {
  test(`broker reports ${mode} and settles transport cleanup`, async () => {
    const f = brokerHarness()
    if (mode === 'ready-error') {
      f.transport.ready = Promise.reject(new Error('ready failed'))
    }
    if (mode === 'request-error') {
      f.transport.send = async () => {
        throw 'request failed'
      }
    }
    if (mode === 'send-error') {
      f.channel.send = (_reply, callback) => {
        callback?.(new Error('send failed'))
        return false
      }
    }
    const running = runBroker({} as never, f.channel, f.dependencies, {
      started: false,
    })
    if (mode === 'worker-error') {
      for (const listener of f.errors) listener(new Error('worker failed'))
    }
    if (mode === 'request-error') {
      f.channel.emit('message', { type: 'connected' })
    }
    if (mode === 'duplicate-start') {
      f.channel.emit('message', { type: 'preparedStart', start: {} })
    }
    if (mode === 'disconnect') f.channel.disconnect()
    if (mode === 'send-error') {
      for (const listener of f.messages) listener({ type: 'spawned', pid: 42 })
    }
    f.finish()
    await running
    await new Promise<void>(resolve => setImmediate(resolve))
    assert.equal(f.channel.connected, false)
    if (['duplicate-start', 'disconnect', 'send-error'].includes(mode)) {
      assert.ok(f.exits.includes(1))
    } else assert.ok(f.replies.some(reply => reply.type === 'error'))
  })
}

test('broker startup failure tolerates a parent disappearing while receiving the error', async () => {
  const f = brokerHarness()
  f.dependencies.createTransport = () => {
    throw new Error('startup failed')
  }
  f.channel.send = (_reply, callback) => {
    f.channel.connected = false
    callback?.(new Error('parent left'))
    return false
  }
  await runBroker({} as never, f.channel, f.dependencies, { started: false })
  assert.equal(f.channel.connected, false)
})

test('broker ready failure tolerates a failed error reply and terminates its worker', async () => {
  const f = brokerHarness()
  f.transport.ready = Promise.reject(new Error('worker not ready'))
  f.channel.send = (_reply, callback) => {
    callback?.(new Error('broken channel'))
    return false
  }
  await runBroker({} as never, f.channel, f.dependencies, { started: false })
  assert.deepEqual(f.exits, [1])
})

test('prepared START cannot be forwarded to an already created transport', async () => {
  const f = brokerHarness()
  await assert.rejects(
    forwardBrokerRequest(f.transport, {
      type: 'preparedStart',
      start: {} as never,
    }),
    /duplicate START/,
  )
  assert.deepEqual(f.requests, [])
})

test('broker entry ignores control messages until START then removes its one-shot listener', () => {
  const f = brokerHarness()
  const starts: unknown[] = []
  listenForBrokerStart(f.channel, async (start, channel) => {
    starts.push(start)
    assert.equal(channel, f.channel)
  })
  f.channel.emit('message', { type: 'connected' })
  assert.deepEqual(starts, [])
  const start = { cols: 80 }
  f.channel.emit('message', { type: 'preparedStart', start })
  f.channel.emit('message', { type: 'preparedStart', start })
  assert.deepEqual(starts, [start])
  assert.equal(f.channel.listenerCount('message'), 0)
})
