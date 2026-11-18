import { EventEmitter } from 'node:events'
import assert from 'node:assert/strict'
import { test, vi } from 'vitest'
import {
  FfiSession,
  runFfiWorker,
} from '../../../src/win32/windows-ffi-worker.mts'
import type { BrokerReply } from '../../../src/win32/windows-protocol.mts'
import type { WindowsStart } from '../../../src/win32/windows-launch.mts'

export function fixture(failure = '') {
  let handle = 10n
  const closed: bigint[] = []
  const consoles: bigint[] = []
  const replies: BrokerReply[] = []
  const errors: Error[] = []
  const starts: Buffer[] = []
  const win = {
    CreateNamedPipeW: () => ++handle,
    ConnectNamedPipe: () => 1,
    GetLastError: () => 5,
    CreatePseudoConsole: (
      _size: number,
      _in: bigint,
      _out: bigint,
      _flags: number,
      result: Buffer,
    ) => {
      result.writeBigUInt64LE(20n)
      return failure === 'console' ? -1 : 0
    },
    InitializeProcThreadAttributeList: (
      _attrs: Buffer | bigint,
      _count: number,
      _flags: number,
      size: Buffer,
    ) => {
      size.writeBigUInt64LE(128n)
      return 1
    },
    UpdateProcThreadAttribute: () => 1,
    CreateProcessW: (...args: unknown[]) => {
      starts.push(Buffer.from(args[8] as Buffer))
      const info = args[9] as Buffer
      info.writeBigUInt64LE(30n)
      info.writeBigUInt64LE(31n, 8)
      info.writeUInt32LE(99, 16)
      return failure === 'process' ? 0 : 1
    },
    DeleteProcThreadAttributeList: () => {},
    CloseHandle: (value: bigint) => {
      closed.push(value)
      return 1
    },
    WaitForSingleObject: () => 0,
    GetExitCodeProcess: (_handle: bigint, code: Buffer) => {
      code.writeUInt32LE(7)
      return 1
    },
    TerminateJobObject: () => 1,
    TerminateProcess: () => 1,
    ResizePseudoConsole: () => (failure === 'resize' ? -1 : 0),
    ClosePseudoConsole: (value: bigint) => consoles.push(value),
  }
  const start: WindowsStart = {
    cols: 80,
    rows: 24,
    application: Buffer.alloc(2),
    commandLine: Buffer.alloc(2),
    cwd: Buffer.alloc(2),
    environment: Buffer.alloc(4),
    inputName: 'in',
    outputName: 'out',
  }
  const session = new FfiSession(
    1n,
    win as never,
    r => replies.push(r),
    e => errors.push(e),
    start,
  )
  return { session, win, closed, consoles, replies, errors, starts }
}

test('natural exit closes every handle and the pseudoconsole exactly once (#965, #947, #983)', async () => {
  const f = fixture()
  await f.session.send({ type: 'connected' })
  await f.session.run()
  await f.session.cleanup()
  assert.deepEqual(
    f.replies
      .filter(reply => reply.type === 'startupPhase')
      .map(reply => reply.phase),
    [
      'connecting input',
      'connecting output',
      'creating pseudoconsole',
      'creating child',
    ],
  )
  assert.deepEqual(f.errors, [])
  assert.deepEqual(f.consoles, [20n])
  assert.equal(new Set(f.closed).size, f.closed.length)
  assert.deepEqual(f.replies.at(-2), { type: 'exited', exitCode: 7, signal: 0 })
  assert.deepEqual(f.replies.at(-1), { type: 'brokerDone' })
  assert.equal(f.starts[0]!.readUInt32LE(60) & 1, 1)
  assert.equal(
    f.starts[0]!.readUInt16LE(64),
    0,
    'SW_HIDE prevents a transient console window (#937)',
  )
})

for (const failure of ['console', 'process']) {
  test(`${failure} creation failure releases acquired resources and reports broker completion`, async () => {
    const f = fixture(failure)
    await f.session.send({ type: 'connected' })
    await f.session.run()
    assert.equal(f.errors.length, 1)
    assert.equal(new Set(f.closed).size, f.closed.length)
    assert.deepEqual(f.replies.at(-1), { type: 'brokerDone' })
    assert.equal(f.consoles.length, failure === 'process' ? 1 : 0)
  })
}

test('abort before connection settles startup and rejects later commands', async () => {
  const f = fixture()
  await f.session.send({ type: 'abort', error: 'host disconnected' })
  await f.session.run()
  await assert.rejects(f.session.send({ type: 'connected' }), /disconnected/)
  assert.equal(f.errors.length, 1)
  assert.deepEqual(f.replies.at(-1), { type: 'brokerDone' })
})

test('resize failure is returned as an ACK error instead of escaping the worker (#827)', async () => {
  const f = fixture('resize')
  try {
    f.session.runCommand(f.win, {
      type: 'command',
      command: 'resize',
      id: 1,
      cols: 80,
      rows: 24,
    })
    assert.match(
      String((f.replies[0] as { error?: string }).error),
      /ResizePseudoConsole/,
    )
  } finally {
    await f.session.fail(new Error('test cleanup'))
  }
})

test('worker entry refuses invocation without a message port', () => {
  assert.throws(() => runFfiWorker(null), /Worker/)
})

for (const failure of [
  'pipe',
  'attribute-size',
  'attribute-init',
  'console-attribute',
  'job-attribute',
  'wait',
  'exit-code',
  'terminate',
  'thread-close',
  'console-close',
]) {
  test(`FFI session releases resources when ${failure} fails`, async () => {
    const f = fixture()
    if (failure === 'pipe') {
      f.win.CreateNamedPipeW = () => 0xff_ff_ff_ff_ff_ff_ff_ffn
    }
    if (failure === 'attribute-size') {
      f.win.InitializeProcThreadAttributeList = (_a, _b, _c, size) => {
        size.writeBigUInt64LE(0n)
        return 1
      }
    }
    if (failure === 'attribute-init') {
      f.win.InitializeProcThreadAttributeList = (_a, _b, _c, size) => {
        size.writeBigUInt64LE(128n)
        return 0
      }
    }
    if (failure.endsWith('-attribute')) {
      let calls = 0
      f.win.UpdateProcThreadAttribute = () =>
        ++calls === (failure === 'console-attribute' ? 1 : 2) ? 0 : 1
    }
    if (failure === 'wait') f.win.WaitForSingleObject = () => 0xff_ff_ff_ff
    if (failure === 'exit-code') f.win.GetExitCodeProcess = () => 0
    if (failure === 'terminate') f.win.TerminateJobObject = () => 0
    if (failure === 'thread-close') f.win.CloseHandle = () => 0
    if (failure === 'console-close') {
      f.win.ClosePseudoConsole = () => {
        throw new Error('console close failed')
      }
    }
    await f.session.send({ type: 'connected' })
    await f.session.run()
    assert.ok(f.errors.length > 0)
    assert.deepEqual(f.replies.at(-1), { type: 'brokerDone' })
  })
}

test('FFI pipe connection accepts already-connected clients and rejects other Win32 errors', async () => {
  const f = fixture()
  try {
    f.win.ConnectNamedPipe = () => 0
    f.win.GetLastError = () => 535
    assert.doesNotThrow(() => f.session.connect(f.win, 1n))
    f.win.GetLastError = () => 5
    assert.throws(() => f.session.connect(f.win, 1n), /Win32 error 5/)
    await assert.rejects(
      f.session.send({ type: 'start', options: {} as never }),
      /only start once/,
    )
    f.session.report('non-Error failure')
    assert.equal(f.errors.at(-1)?.message, 'non-Error failure')
  } finally {
    await f.session.fail(new Error('cleanup'))
  }
})

for (const command of ['resize', 'kill', 'close'] as const) {
  test(`FFI session acknowledges queued ${command} before natural process completion`, async () => {
    const f = fixture()
    let waits = 0
    f.win.WaitForSingleObject = () => (++waits === 1 ? 258 : 0)
    await f.session.send({
      type: 'command',
      command,
      id: 8,
      cols: 80,
      rows: 24,
      signal: 15,
    } as never)
    await f.session.send({ type: 'connected' })
    await f.session.run()
    assert.ok(
      f.replies.some(
        reply => reply.type === 'ack' && reply.id === 8 && !reply.error,
      ),
    )
    assert.deepEqual(f.errors, [])
  })
}

test('worker entry relays thread identity, startup, invalid requests and completion through its port', async () => {
  const f = fixture()
  await f.session.fail(new Error('fixture session unused'))
  const port = new EventEmitter() as EventEmitter & {
    postMessage(value: unknown): void
    close(): void
  }
  const messages: Array<{ kind: string; reply?: BrokerReply; error?: string }> =
    []
  port.postMessage = value => messages.push(value as (typeof messages)[number])
  let close!: () => void
  const closed = new Promise<void>(resolve => {
    close = resolve
  })
  port.close = close
  const start = {
    cols: 80,
    rows: 24,
    application: Buffer.alloc(2),
    commandLine: Buffer.alloc(2),
    cwd: Buffer.alloc(2),
    environment: Buffer.alloc(4),
    inputName: 'in',
    outputName: 'out',
  }
  runFfiWorker(
    port as never,
    { jobHandle: 1n, preparedStart: start },
    () => ({ ...f.win, GetCurrentThreadId: () => 42 }) as never,
  )
  port.emit('message', { type: 'start', options: {} })
  port.emit('message', { type: 'connected' })
  await closed
  assert.equal(messages[0]?.kind, 'threadId')
  assert.ok(
    messages.some(
      message =>
        message.kind === 'error' && /only start once/.test(message.error ?? ''),
    ),
  )
  assert.ok(messages.some(message => message.reply?.type === 'spawned'))
  assert.equal(messages.at(-1)?.reply?.type, 'brokerDone')
})

test('worker entry reports non-Error initialization failures and closes its port', () => {
  const messages: unknown[] = []
  let closed = false
  runFfiWorker(
    {
      postMessage: (value: unknown) => messages.push(value),
      close: () => {
        closed = true
      },
    } as never,
    {},
    () => {
      throw 'initialization failed'
    },
  )
  assert.deepEqual(messages, [
    { kind: 'error', error: 'initialization failed' },
    { kind: 'reply', reply: { type: 'brokerDone' } },
  ])
  assert.equal(closed, true)
})

for (const operation of [
  'CreateNamedPipeW',
  'DeleteProcThreadAttributeList',
  'TerminateJobObject',
] as const) {
  test(`FFI session reports thrown ${operation} failures while completing cleanup`, async () => {
    const f = fixture()
    f.win[operation] = () => {
      throw 'native failure'
    }
    await f.session.send({ type: 'connected' })
    await f.session.run()
    assert.ok(f.errors.some(error => /native failure/.test(error.message)))
    assert.equal(f.replies.at(-1)?.type, 'brokerDone')
  })
}

for (const terminationFails of [false, true]) {
  test(`abort during process monitoring ${terminationFails ? 'reports failed job termination' : 'terminates the running job'} and completes cleanup`, async () => {
    const f = fixture()
    let waits = 0
    f.win.WaitForSingleObject = () => {
      if (++waits === 1) {
        void f.session.fail(new Error('monitor aborted'))
        return 258
      }
      return 0
    }
    f.win.TerminateJobObject = () => (terminationFails ? 0 : 1)
    await f.session.send({ type: 'connected' })
    await f.session.run()
    assert.ok(f.errors.some(error => error.message === 'monitor aborted'))
    assert.equal(f.replies.at(-1)?.type, 'brokerDone')
    assert.ok(f.closed.includes(30n))
  })
}

test('session rejects requests after natural completion without an abort reason', async () => {
  const f = fixture()
  await f.session.send({ type: 'connected' })
  await f.session.run()
  await assert.rejects(
    f.session.send({ type: 'connected' }),
    /transport is closed/,
  )
})

test('abort without a supplied reason reports the default error', async () => {
  const f = fixture()
  await f.session.send({ type: 'abort' })
  await f.session.run()
  assert.match(f.errors[0]!.message, /transport was aborted/)
})

for (const throws of [false, true]) {
  test(`cleanup without a job terminates the process and ${throws ? 'reports native errors' : 'waits for exit'}`, async () => {
    const f = fixture()
    await f.session.fail(new Error('unused fixture'))
    const errors: Error[] = []
    const session = new FfiSession(
      0n,
      f.win as never,
      () => {},
      error => errors.push(error),
    )
    let terminated = false
    f.win.TerminateProcess = () => {
      terminated = true
      if (throws) throw new Error('terminate process failed')
      return 1
    }
    const start: WindowsStart = {
      cols: 80,
      rows: 24,
      application: Buffer.alloc(2),
      commandLine: Buffer.alloc(2),
      cwd: Buffer.alloc(2),
      environment: Buffer.alloc(4),
      inputName: 'in',
      outputName: 'out',
    }
    session.createProcess(f.win, start)
    let waits = 0
    f.win.WaitForSingleObject = () => (++waits === 1 ? 258 : 0)
    await session.cleanup()
    await session.fail(new Error('finish timer'))
    assert.equal(terminated, true)
    assert.equal(waits, 2)
    assert.equal(
      errors.some(error => /terminate process failed/.test(error.message)),
      throws,
    )
  })
}

test('session startup deadline reports a connection timeout and completes without a child', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout'] })
  const f = fixture()
  const running = f.session.run()
  vi.advanceTimersByTime(15_000)
  await running
  assert.ok(
    f.errors.some(error =>
      /Timed out connecting ConPTY pipes/.test(error.message),
    ),
  )
  assert.deepEqual(f.starts, [])
  assert.equal(f.replies.at(-1)?.type, 'brokerDone')
})
