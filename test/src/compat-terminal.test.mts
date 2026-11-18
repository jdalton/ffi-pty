import assert from 'node:assert/strict'
import { test } from 'vitest'
import { PassThrough } from 'node:stream'
import { setImmediate as turn } from 'node:timers/promises'
import {
  CompatibleTerminal,
  compatibleExit,
  type CompatibleBackend,
} from '../../src/compat-terminal.mts'
import { normalizeCompatibleOptions } from '../../src/compat-options.mts'

export function fixture(
  platform = 'linux',
  encoding: BufferEncoding | null = 'utf8',
) {
  const readable = new PassThrough()
  const calls: unknown[] = []
  let exit!: (value: { exitCode: number | null; signal: number }) => void
  const backend: CompatibleBackend = {
    pid: 123,
    readable,
    exited: new Promise(resolve => {
      exit = resolve
    }),
    async write(data) {
      calls.push(['write', data.toString('hex')])
    },
    async resize(cols, rows) {
      calls.push(['resize', cols, rows])
    },
    async kill(signal) {
      calls.push(['kill', signal])
    },
    async close() {
      calls.push(['close'])
      readable.end()
      exit({ exitCode: 0, signal: 0 })
    },
  }
  const config = normalizeCompatibleOptions(
    'shell',
    [],
    { env: {}, encoding, handleFlowControl: true },
    platform,
  )
  const terminal = new CompatibleTerminal(config, () => backend, platform)
  return { terminal, backend, readable, calls, exit, config }
}

test('synchronous facade queues writes in order, copies buffers, and uses disposable events', async () => {
  const { terminal, readable, calls, exit } = fixture()
  assert.equal(terminal.pid, 123)
  assert.equal(terminal.process, 'shell')
  const output: string[] = []
  const listener = terminal.onData(value => output.push(value))
  const ignored = terminal.onData(() => assert.fail('disposed listener'))
  ignored.dispose()
  const bytes = Buffer.from('one')
  assert.equal(terminal.write(bytes), undefined)
  bytes.fill(0)
  terminal.write('two')
  await turn()
  assert.deepEqual(calls, [
    ['write', '6f6e65'],
    ['write', '74776f'],
  ])
  readable.write(Buffer.from([0xe2, 0x82]))
  readable.write(Buffer.from([0xac]))
  const statuses: unknown[] = []
  terminal.onExit(value => statuses.push(value))
  exit({ exitCode: null, signal: 1 })
  await turn()
  assert.equal(statuses.length, 0)
  readable.end()
  assert.deepEqual(await terminal.exited, { exitCode: 0, signal: 1 })
  assert.deepEqual(output, ['€'])
  assert.equal(statuses.length, 1)
  listener.dispose()
  assert.equal(terminal.close(), terminal.close())
  await terminal.close()
})

test('flow control intercepts exact strings and paused output delays exit until resumed', async () => {
  const { terminal, readable, calls, exit } = fixture()
  const output: string[] = []
  terminal.onData(value => output.push(value))
  terminal.write('\x13')
  await turn()
  readable.end('data')
  exit({ exitCode: 0, signal: 0 })
  await turn()
  assert.deepEqual(output, [])
  terminal.write('\x11')
  await terminal.exited
  assert.deepEqual(output, ['data'])
  assert.deepEqual(calls, [])
  await terminal.close()
})

test('encoding null emits buffers and latin1 encoding applies to reads and writes', async () => {
  const raw = fixture('linux', null)
  let data: unknown
  raw.terminal.onData(value => {
    data = value
  })
  raw.readable.write(Buffer.from([0xff]))
  await turn()
  assert.ok(Buffer.isBuffer(data))
  assert.equal(data[0], 255)
  await raw.terminal.close()
  const latin = fixture('linux', 'latin1')
  latin.terminal.onData(value => {
    data = value
  })
  latin.terminal.write('ÿ')
  latin.readable.write(Buffer.from([0xff]))
  await turn()
  assert.equal(data, 'ÿ')
  assert.deepEqual(latin.calls, [['write', 'ff']])
  await latin.terminal.close()
})

test('encoding null preserves raw buffers on Windows', async () => {
  const raw = fixture('win32', null)
  let data: unknown
  raw.terminal.onData(value => {
    data = value
  })
  raw.readable.write(Buffer.from([0xff]))
  await turn()
  assert.ok(Buffer.isBuffer(data))
  assert.equal(data[0], 255)
  await raw.terminal.close()
})

test('resizes and signals use synchronous Unix controls and reject invalid input before dispatch', async () => {
  const { terminal, backend, calls } = fixture()
  backend.resizeSync = (...args) => {
    calls.push(args)
  }
  backend.killSync = signal => {
    calls.push(signal)
  }
  backend.processTitle = () => 'foreground'
  assert.equal(terminal.process, 'foreground')
  terminal.resize(100, 40, { width: 1000, height: 800 })
  assert.equal(terminal.cols, 100)
  assert.equal(terminal.rows, 40)
  terminal.kill()
  terminal.kill('SIGINT')
  terminal.destroy()
  assert.deepEqual(calls, [
    [100, 40, { width: 1000, height: 800 }],
    'SIGHUP',
    'SIGINT',
    'SIGHUP',
  ])
  assert.throws(() => terminal.resize(0, 1), /cols/)
  assert.throws(() => terminal.resize(1, 1, { width: -1, height: 0 }), /pixel/)
  assert.equal(terminal.setParentWindow(Buffer.alloc(8)), false)
  terminal.clear()
  await terminal.close()
  terminal.write('ignored')
  terminal.resize(1, 1)
  terminal.kill()
  assert.equal(terminal.cols, 100)
})

test('Windows operations defer until startup and preserve Windows signal and status shapes', async () => {
  const source = fixture('win32')
  source.config.spawn.conptyDll = 'fixture.dll'
  let ready!: (backend: CompatibleBackend) => void
  const terminal = new CompatibleTerminal(
    source.config,
    () =>
      new Promise(resolve => {
        ready = resolve
      }),
    'win32',
  )
  assert.equal(terminal.pid, 0)
  assert.equal(terminal.process, 'Windows Shell')
  assert.equal(terminal.write('early'), undefined)
  terminal.resize(100, 40)
  terminal.kill()
  terminal.clear()
  assert.throws(() => terminal.kill('SIGTERM'), /Signals/)
  source.backend.clear = async () => {
    source.calls.push('clear')
  }
  source.backend.setParentWindow = () => true
  ready(source.backend)
  await terminal.ready
  await turn()
  assert.equal(terminal.pid, 123)
  assert.equal(terminal.setParentWindow(Buffer.alloc(8)), false)
  assert.deepEqual(source.calls, [
    ['write', '6561726c79'],
    ['resize', 100, 40],
    ['kill', 'SIGTERM'],
  ])
  await terminal.close()
  await source.terminal.close()
  assert.deepEqual(compatibleExit({ exitCode: 3, signal: 9 }, 'win32'), {
    exitCode: 3,
  })
})

test('startup and I/O failures reject additive promises, report once, and clean up', async () => {
  const config = normalizeCompatibleOptions('shell', [], {})
  const cause = new Error('startup failed')
  const terminal = new CompatibleTerminal(config, () => Promise.reject(cause))
  const errors: unknown[] = []
  const exits: unknown[] = []
  terminal.on('error', error => errors.push(error))
  terminal.onExit(status => exits.push(status))
  await assert.rejects(terminal.ready, /startup failed/)
  await assert.rejects(terminal.exited, /startup failed/)
  await terminal.close()
  terminal.fail(cause)
  assert.equal(errors.length, 1)
  assert.equal(exits.length, 1)
  const broken = fixture()
  broken.backend.write = async () => {
    throw new Error('write failed')
  }
  broken.terminal.write('test')
  await assert.rejects(broken.terminal.exited, /write failed/)
  await broken.terminal.close()
  const oversized = fixture()
  assert.doesNotThrow(() =>
    oversized.terminal.write(Buffer.alloc(8 * 1024 * 1024 + 1)),
  )
  await turn()
  assert.equal(oversized.calls.length, 129)
  await oversized.terminal.close()
})

test('Windows HWND validation is synchronous, startup retains a copy, and closed terminals reject reparenting', async () => {
  const source = fixture('win32')
  assert.equal(source.terminal.setParentWindow(Buffer.alloc(8)), false)
  assert.throws(
    () => source.terminal.setParentWindow(Buffer.alloc(4)),
    /8-byte/,
  )
  source.config.spawn.conptyDll = 'fixture.dll'
  const handle = Buffer.alloc(8)
  handle.writeBigUInt64LE(42n)
  let parent = 0n
  source.backend.setParentWindow = bytes => {
    parent = bytes.readBigUInt64LE()
    return true
  }
  assert.equal(source.terminal.setParentWindow(handle), true)
  handle.fill(0)
  await turn()
  assert.equal(parent, 42n)
  source.terminal.resize(80, 24, { width: -1, height: NaN })
  await turn()
  await source.terminal.close()
  assert.equal(source.terminal.setParentWindow(Buffer.alloc(8)), false)
})

test('Windows clear does not enqueue native work after kill while exit is pending', async () => {
  const source = fixture('win32')
  source.backend.clear = async () => {
    source.calls.push('clear')
  }
  await source.terminal.ready
  source.terminal.clear()
  await turn()
  source.terminal.kill()
  source.terminal.clear()
  await turn()
  assert.deepEqual(source.calls, ['clear', ['kill', 'SIGTERM']])
  await source.terminal.close()
})

test('compatibility failure normalizes non-Error causes and ignores repeated failure', async () => {
  const { terminal, backend } = fixture('linux', null)
  backend.close = async () => {
    throw new Error('close failed')
  }
  const rejected = assert.rejects(terminal.exited, /broken/)
  terminal.fail('broken')
  terminal.fail('later')
  await rejected
  terminal.resize(80, 24)
  assert.deepEqual(compatibleExit({ exitCode: null, signal: 9 }, 'linux'), {
    exitCode: 0,
    signal: 9,
  })
  assert.deepEqual(compatibleExit({ exitCode: null, signal: 9 }, 'win32'), {
    exitCode: 0,
  })
})

test('compatibility resize rejects invalid pixel dimensions before backend dispatch', async () => {
  const { terminal, calls } = fixture()
  for (const value of [-1, 65_536, 1.5]) {
    assert.throws(
      () => terminal.resize(80, 24, { width: value, height: 1 }),
      /pixel dimension/,
    )
    assert.throws(
      () => terminal.resize(80, 24, { width: 1, height: value }),
      /pixel dimension/,
    )
  }
  assert.deepEqual(calls, [])
  await terminal.close()
})

test('compatibility getters reflect native descriptors and closed Windows terminals reject resize', async () => {
  const { terminal, backend, config } = fixture('win32', null)
  backend.masterFd = 42
  backend.slaveName = 'fixture'
  assert.equal(terminal.fd, 42)
  assert.equal(terminal.ptsName, 'fixture')
  config.spawn.conptyDll = 'fixture.dll'
  assert.equal(terminal.setParentWindow(Buffer.alloc(8)), false)
  terminal.write('text')
  await turn()
  terminal.kill()
  assert.throws(() => terminal.resize(80, 24), /closed terminal/)
  await terminal.close()
})
