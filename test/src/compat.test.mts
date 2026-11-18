import { createRequire } from 'node:module'
import assert from 'node:assert/strict'
import { test } from 'vitest'
import { spawn, fork, createTerminal } from '../../src/compat.mts'

test(
  'spawn returns a synchronous terminal, accepts early input, and drains output before exit',
  { timeout: 15_000 },
  async () => {
    const terminal = spawn(process.execPath, [
      '-e',
      'process.stdin.once("data",d=>{console.log("RECEIVED:"+d.toString().trim());process.exit(7)})',
    ])
    assert.equal(typeof terminal.then, 'undefined')
    if (process.platform !== 'win32') assert.ok(terminal.pid > 0)
    let output = ''
    terminal.onData(value => {
      output += value
    })
    terminal.resize(91, 31)
    terminal.write(process.platform === 'win32' ? 'early\r' : 'early\n')
    try {
      await terminal.ready
      assert.ok(terminal.pid > 0)
      const result = await terminal.exited
      assert.equal(result.exitCode, 7)
      assert.match(output, /RECEIVED:early/)
      assert.equal(terminal.cols, 91)
      assert.equal(terminal.rows, 31)
    } finally {
      await terminal.close()
    }
    assert.equal(fork, spawn)
    assert.equal(createTerminal, spawn)
  },
)

test(
  'compatible kill returns void and uses SIGHUP on Unix and no explicit Windows signal',
  { timeout: 10_000 },
  async () => {
    const terminal = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'])
    try {
      await terminal.ready
      assert.equal(terminal.kill(), undefined)
      const status = await terminal.exited
      if (process.platform === 'win32') assert.equal(status.signal, undefined)
      else assert.equal(status.signal, 1)
    } finally {
      await terminal.close()
    }
  },
)

test(
  'compatible Unix spawn supports credentials, TERM override and raw output',
  { skip: process.platform === 'win32', timeout: 10_000 },
  async () => {
    const terminal = spawn(
      process.execPath,
      [
        '-e',
        'console.log(JSON.stringify({uid:process.getuid(),gid:process.getgid(),term:process.env.TERM}))',
      ],
      {
        name: 'vt100',
        uid: process.getuid!(),
        gid: process.getgid!(),
        encoding: null,
      },
    )
    const chunks: Buffer[] = []
    terminal.onData(value => {
      assert.ok(Buffer.isBuffer(value))
      chunks.push(value)
    })
    try {
      await terminal.ready
      const status = await terminal.exited
      assert.equal(status.exitCode, 0)
      assert.deepEqual(JSON.parse(Buffer.concat(chunks).toString().trim()), {
        uid: process.getuid!(),
        gid: process.getgid!(),
        term: 'vt100',
      })
    } finally {
      await terminal.close()
    }
  },
)

test(
  'missing Unix executable reports an exit through the compatible event API',
  { skip: process.platform === 'win32' },
  async () => {
    const term = spawn('/does-not-exist-ffi-pty-test')
    const status = await new Promise<{ exitCode: number }>(resolve =>
      term.onExit(resolve),
    )
    assert.equal(status.exitCode, 1)
    await term.close()
  },
)

test(
  'bundled ConPTY starts offline, accepts raw arguments, resizes and clears on Windows',
  { skip: process.platform !== 'win32', timeout: 20_000 },
  async () => {
    const terminal = spawn(
      process.execPath,
      "-e \"process.stdin.once('data',()=>{console.log('BUNDLED_OK');process.exit(0)})\"",
      { useConptyDll: true },
    )
    assert.equal(typeof terminal.then, 'undefined')
    let output = ''
    terminal.onData(data => {
      output += data
    })
    try {
      await terminal.ready
      terminal.resize(100, 30)
      terminal.clear()
      terminal.write('go\r')
      assert.equal((await terminal.exited).exitCode, 0)
      assert.match(output, /BUNDLED_OK/)
    } finally {
      await terminal.close()
    }
  },
)

test(
  'bundled ConPTY accepts an owner window immediately after synchronous spawn',
  { skip: process.platform !== 'win32', timeout: 30_000 },
  async () => {
    const { dlopen } = createRequire(import.meta.url)('node:ffi')
    const user = dlopen('user32.dll', {
      GetDesktopWindow: { arguments: [], return: 'pointer' },
    })
    const owner = Buffer.alloc(8)
    owner.writeBigUInt64LE(user.functions.GetDesktopWindow())
    const terminal = spawn(
      process.execPath,
      ['-e', 'process.stdin.once("data",()=>process.exit(0))'],
      { useConptyDll: true },
    )
    try {
      assert.equal(terminal.setParentWindow(owner), true)
      await terminal.ready
      terminal.write('done\r')
      assert.equal((await terminal.exited).exitCode, 0)
    } finally {
      await terminal.close()
    }
  },
)
