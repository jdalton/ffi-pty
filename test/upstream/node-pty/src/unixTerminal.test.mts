// Adapted from node-pty's MIT-licensed unixTerminal.test.ts. See ../original.
import assert from 'node:assert/strict'
import { isatty } from 'node:tty'
import { constants } from 'node:os'
import { execFileSync } from 'node:child_process'
import { once } from 'node:events'
import { open } from '../../../../src/compat.mts'
import { upstreamTest, terminal, unix, until } from '../suite.mts'

upstreamTest('unixTerminal', 1, unix, async t => {
  const { term } = terminal(t, '/bin/bash')
  assert.match(
    term.ptsName,
    process.platform === 'linux'
      ? /^\/dev\/pts\/\d+$/
      : /^\/dev\/tty[p-sP-S][a-z0-9]+$/,
  )
  assert.ok(isatty(term.fd))
})
upstreamTest('unixTerminal', 2, unix, async t => {
  const { term, chunks, output } = terminal(t, '/bin/sh', ['-c', "printf 'æ'"])
  await term.exited
  assert.equal(output(), 'æ')
  for (const chunk of chunks) {
    assert.equal(typeof chunk, 'string')
  }
})
upstreamTest('unixTerminal', 3, unix, async t => {
  const { term, chunks } = terminal(t, '/bin/sh', ['-c', "printf 'æ'"], {
    encoding: null,
  })
  await term.exited
  for (const chunk of chunks) {
    assert.ok(Buffer.isBuffer(chunk))
  }
  assert.deepEqual(Buffer.concat(chunks as Buffer[]), Buffer.from([0xc3, 0xa6]))
})
upstreamTest('unixTerminal', 4, unix, async t => {
  const { term, output } = terminal(t, undefined, ['-c', 'echo "test æ!"'], {
    encoding: 'base64',
  })
  await term.exited
  assert.equal(Buffer.from(output(), 'base64').toString().trim(), 'test æ!')
})
upstreamTest('unixTerminal', 5, unix, async t => {
  const term = open({})
  t.after(() => {
    term.master.destroy()
    term.slave.destroy()
  })
  let master = '',
    slave = ''
  term.master.on('data', data => {
    master += data
  })
  term.slave.on('data', data => {
    slave += data
  })
  term.slave.write('slave\n')
  term.master.write('master\n')
  await until(() => master === 'slave\r\nmaster\r\n' && slave === 'master\n')
})
upstreamTest('unixTerminal', 6, unix, async t => {
  const { term } = terminal(t, process.execPath)
  const exit = once(term, 'exit')
  term.destroy()
  assert.deepEqual(await exit, [0, constants.signals.SIGHUP])
})
// A dedicated parent subprocess below preserves inherited-signal coverage without
// delivering SIGINT to the test runner itself. Readiness replaces fixed sleeps.
for (const [id, custom] of [
  [7, true],
  [8, false],
] as const) {
  upstreamTest('unixTerminal', id, unix, async t => {
    const { term, output } = terminal(t, process.execPath, [
      '--experimental-ffi',
      new URL('../signal-parent.mts', import.meta.url).pathname,
      String(custom),
    ])
    await term.exited
    assert.match(output(), /SIGINT in parent/)
    if (custom) {
      assert.match(output(), /SIGINT in child/)
    }
    assert.doesNotMatch(output(), /should not be printed/)
  })
}
upstreamTest('unixTerminal', 9, unix, async t => {
  const { term, output } = terminal(t, process.execPath, [
    '-e',
    "console.log('ready');setTimeout(()=>console.log('timeout'),10000)",
  ])
  await until(() => output().includes('ready'))
  term.kill()
  await term.exited
  assert.equal(output(), 'ready\r\n')
})
upstreamTest('unixTerminal', 10, unix, async t => {
  // Node's permission model disables SIGUSR1 inspector handling. An isolated
  // parent exercises the real signal handlers without altering runner flags.
  const { term, output } = terminal(t, process.execPath, [
    '--experimental-ffi',
    new URL('../signal-parent.mts', import.meta.url).pathname,
    'true',
    'SIGUSR1',
  ])
  await term.exited
  assert.equal(output().match(/SIGUSR1 in parent/g)?.length, 1)
  assert.equal(output().match(/SIGUSR1 in child/g)?.length, 1)
})
upstreamTest(
  'unixTerminal',
  11,
  { skip: process.platform !== 'linux' },
  async t => {
    terminal(t, '/bin/bash')
    terminal(t, '/bin/bash')
    const code =
      "const fs=require('fs');console.log('PTMX_COUNT:'+fs.readdirSync('/proc/self/fd').filter(fd=>{try{return fs.readlinkSync('/proc/self/fd/'+fd).includes('ptmx')}catch{return false}}).length)"
    const { term, output } = terminal(t, process.execPath, ['-e', code])
    await term.exited
    assert.match(output(), /PTMX_COUNT:0\r?\n/)
  },
)
upstreamTest(
  'unixTerminal',
  12,
  { skip: process.platform !== 'darwin' },
  async t => {
    const { term } = terminal(t, '/bin/echo')
    assert.equal(term.process, '/bin/echo')
    await term.exited
  },
)
upstreamTest(
  'unixTerminal',
  13,
  { skip: process.platform !== 'darwin' },
  async t => {
    const { term, output } = terminal(t, '/bin/bash', [
      '-i',
      '-c',
      '"$1" -e \'console.log("child ready");setInterval(()=>{},1000)\'; echo done',
      'sh',
      process.execPath,
    ])
    await until(() => output().includes('child ready'))
    assert.match(term.process, /node/)
  },
)
upstreamTest(
  'unixTerminal',
  14,
  { skip: process.platform !== 'darwin' },
  async t => {
    // /proc does not exist on macOS. Inspect the actual child's open descriptors.
    const first = terminal(t, '/bin/bash').term
    const { term, output } = terminal(t, process.execPath, [
      '-e',
      "console.log('ready');setInterval(()=>{},1000)",
    ])
    await until(() => output().includes('ready'))
    const listing = execFileSync(
      '/usr/sbin/lsof',
      ['-p', String(term.pid), '-Fn'],
      { encoding: 'utf8' },
    )
    assert.ok(!listing.includes(first.ptsName))
    assert.ok(!listing.includes('/dev/ptmx'))
  },
)
for (const [id, kind] of [
  [15, 'ptmx'],
  [16, 'KQUEUE'],
] as const) {
  upstreamTest(
    'unixTerminal',
    id,
    { skip: process.platform !== 'darwin' },
    async t => {
      const count = () =>
        execFileSync('/usr/sbin/lsof', ['-p', String(process.pid)], {
          encoding: 'utf8',
        })
          .split('\n')
          .filter(line => line.includes(kind)).length
      const before = count()
      for (let i = 0; i < 20; i++) {
        const { term } = terminal(t, '/bin/bash', ['-c', 'echo hello'])
        await term.exited
        await term.close()
      }
      assert.ok(count() <= before, `Leaked ${kind} descriptors`)
    },
  )
}
for (const [id, file, options] of [
  [17, '/bin/bogus.exe', {}],
  [18, '/bin/echo', { cwd: '/nowhere' }],
] as const) {
  upstreamTest('unixTerminal', id, unix, async t => {
    const { term } = terminal(t, file, [], options)
    const status = await new Promise<{ exitCode: number }>(resolve =>
      term.onExit(resolve),
    )
    assert.equal(status.exitCode, 1)
  })
}
upstreamTest('unixTerminal', 19, unix, async t => {
  const { term, output } = terminal(t, process.execPath, [
    '-e',
    "console.log('ready');setInterval(()=>{},1000)",
  ])
  await until(() => output().includes('ready'))
  process.kill(term.pid, 'SIGINT')
  await term.exited
  assert.throws(() => process.kill(term.pid, 0), { code: 'ESRCH' })
})
