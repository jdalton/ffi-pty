import { PassThrough } from 'node:stream'
import type { Socket } from 'node:net'
import type { BrokerReply } from '../../../src/win32/windows-protocol.mts'
import type { WindowsTransport } from '../../../src/win32/windows-transport.mts'
import { createWindowsController } from '../../../src/win32/windows-controller.mts'
import assert from 'node:assert/strict'
import { test } from 'vitest'
import { asError, createWindowsTransport } from '../../../src/win32/windows.mts'

test('asError preserves Error instances and wraps other failures', () => {
  const original = new Error('native failure')
  assert.equal(asError(original), original)
  assert.equal(asError('native failure').message, 'native failure')
})

test('Windows transport selector rejects versions below the ConPTY minimum', async () => {
  await assert.rejects(
    createWindowsTransport({ major: 10, minor: 0, build: 17_762 }),
    /does not support ConPTY/,
  )
})

export function controllerFixture(mode = 'normal') {
  const messages = new Set<(reply: BrokerReply) => void>()
  const errors = new Set<(error: Error) => void>()
  const sockets: PassThrough[] = []
  let finish!: () => void
  const closed = new Promise<void>(resolve => {
    finish = resolve
  })
  const emit = (reply: BrokerReply) => {
    for (const listener of messages) listener(reply)
  }
  const end = () => {
    sockets[1]?.end()
    emit({ type: 'exited', exitCode: 0, signal: 0 })
    emit({ type: 'brokerDone' })
    finish()
  }
  const transport: WindowsTransport = {
    ready: Promise.resolve(),
    closed,
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
    async send(request) {
      if (request.type === 'start') {
        if (mode === 'send-failure') throw new Error('start send failed')
        emit({ type: 'pipes', input: 'input', output: 'output' })
      } else if (request.type === 'connected') {
        emit({ type: 'startupPhase', phase: 'creating child' })
        emit({ type: 'spawned', pid: 123 })
      } else if (request.type === 'command') {
        if (request.command === 'resize') {
          emit({
            type: 'ack',
            id: request.id,
            ...(mode === 'resize-failure' ? { error: 'resize failed' } : {}),
          })
        } else {
          emit({ type: 'ack', id: request.id })
          end()
        }
      } else if (request.type === 'abort') {
        emit({ type: 'brokerDone' })
        finish()
      }
    },
    async terminate() {
      for (const socket of sockets) socket.destroy()
      finish()
    },
  }
  const connect = () => {
    const socket = new PassThrough()
    sockets.push(socket)
    queueMicrotask(() => {
      if (mode === 'connect-error') {
        socket.destroy(new Error('pipe connection failed'))
      } else if (mode === 'connect-close') socket.destroy()
      else socket.emit('connect')
    })
    return socket as unknown as Socket
  }
  return { transport, connect, sockets, emit, end, finish, errors }
}

const controllerOptions = {
  file: 'test.exe',
  args: [],
  env: {},
  cwd: '.',
  cols: 80,
  rows: 24,
}

for (const mode of ['connect-error', 'connect-close', 'send-failure']) {
  test(`controller cleans up ${mode} before startup without an unhandled error (#960)`, async () => {
    const f = controllerFixture(mode)
    await assert.rejects(
      createWindowsController(controllerOptions, f.transport, f.connect),
      /failed|closed/,
    )
    assert.ok(f.sockets.every(socket => socket.destroyed))
  })
}

for (const channel of [0, 1]) {
  test(`broken ${channel === 0 ? 'input' : 'output'} pipe rejects exit and closes both sockets (#976, #942, #960)`, async () => {
    const f = controllerFixture()
    const backend = await createWindowsController(
      controllerOptions,
      f.transport,
      f.connect,
    )
    backend.readable.resume()
    f.sockets[channel]!.destroy(new Error('broken pipe'))
    await assert.rejects(backend.exited, /broken pipe/)
    await backend.close()
    assert.ok(f.sockets.every(socket => socket.destroyed))
    await assert.rejects(backend.write(Buffer.from('after close')), /closed/)
  })
}

test('controller drains output, closes input and rejects late resize after natural exit (#965, #887, #827)', async () => {
  const f = controllerFixture()
  const backend = await createWindowsController(
    controllerOptions,
    f.transport,
    f.connect,
  )
  let output = ''
  backend.readable.on('data', part => {
    output += part
  })
  f.sockets[1]!.write('last output')
  f.end()
  assert.equal((await backend.exited).exitCode, 0)
  assert.equal(output, 'last output')
  await assert.rejects(backend.resize(80, 24), /closed|exited/)
  await backend.close()
  await backend.close()
  assert.ok(f.sockets.every(socket => socket.closed))
})

test('resize ACK errors reject the command without killing the controller', async () => {
  const f = controllerFixture('resize-failure')
  const backend = await createWindowsController(
    controllerOptions,
    f.transport,
    f.connect,
  )
  backend.readable.resume()
  await assert.rejects(backend.resize(100, 30), /resize failed/)
  await backend.close()
  assert.equal((await backend.exited).exitCode, 0)
})

for (const mode of [
  'duplicate-pipes',
  'premature-done',
  'transport-close',
  'transport-error',
]) {
  test(`controller rejects ${mode} and disposes both IPC sockets`, async () => {
    const f = controllerFixture()
    const backend = await createWindowsController(
      controllerOptions,
      f.transport,
      f.connect,
    )
    backend.readable.resume()
    const rejected = assert.rejects(
      backend.exited,
      /Unexpected|without an exit|before brokerDone|transport failure/,
    )
    if (mode === 'duplicate-pipes') {
      f.emit({ type: 'pipes', input: 'duplicate', output: 'duplicate' })
    }
    if (mode === 'premature-done') {
      f.emit({ type: 'brokerDone' })
    }
    if (mode === 'transport-close') {
      f.finish()
    }
    if (mode === 'transport-error') {
      for (const listener of f.errors) {
        listener(new Error('transport failure'))
      }
    }
    await rejected
    await backend.close()
    assert.ok(f.sockets.every(socket => socket.destroyed))
  })
}

for (const phase of ['ready', 'connected', 'command']) {
  test(`controller surfaces ${phase} transport failure and settles pending requests`, async () => {
    const f = controllerFixture()
    if (phase === 'ready') {
      f.transport.ready = Promise.reject(new Error('ready failed'))
    }
    const send = f.transport.send.bind(f.transport)
    f.transport.send = async request => {
      if (request.type === phase) {
        throw 'transport send failed'
      }
      return send(request)
    }
    if (phase !== 'command') {
      await assert.rejects(
        createWindowsController(controllerOptions, f.transport, f.connect),
        /failed/,
      )
      return
    }
    const backend = await createWindowsController(
      controllerOptions,
      f.transport,
      f.connect,
    )
    backend.readable.resume()
    const exited = assert.rejects(backend.exited, /send failed/)
    await assert.rejects(backend.kill(), /send failed/)
    await exited
    await backend.close()
  })
}

test('controller ignores late ACKs and rejects a queued write whose pipe closes before it starts', async () => {
  const f = controllerFixture()
  const backend = await createWindowsController(
    controllerOptions,
    f.transport,
    f.connect,
  )
  backend.readable.resume()
  f.emit({ type: 'ack', id: 999 })
  await backend.resize(80, 24)
  const write = backend.write(Buffer.from('pending'))
  const rejected = assert.rejects(write, /pipe is closed/)
  f.sockets[0]!.destroy()
  await rejected
  await backend.close()
})

test('controller cleanup still destroys sockets when transport termination fails', async () => {
  const f = controllerFixture()
  const backend = await createWindowsController(
    controllerOptions,
    f.transport,
    f.connect,
  )
  backend.readable.resume()
  f.transport.terminate = async () => {
    throw new Error('termination failed')
  }
  const rejected = assert.rejects(backend.exited, /broken pipe/)
  f.sockets[0]!.destroy(new Error('broken pipe'))
  await rejected
  await assert.rejects(backend.close(), /termination failed/)
  assert.ok(f.sockets.every(socket => socket.destroyed))
})
