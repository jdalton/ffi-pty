import { createRequire } from 'node:module'
import assert from 'node:assert/strict'
import { test } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { spawnPty } from '../../../src/pty.mts'
const require = createRequire(import.meta.url)

test(
  'macOS host death immediately after spawn leaves no blocked bootstrap (#1014)',
  { skip: process.platform !== 'darwin', timeout: 10_000 },
  async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ffi-pty-host-death-'))
    const executable = join(dir, 'target')
    symlinkSync('/bin/sleep', executable)
    const findSurvivors = () =>
      execFileSync('/bin/ps', ['-axo', 'pid=,args='], { encoding: 'utf8' })
        .split('\n')
        .filter(line => line.includes(executable))
        .map(line => Number(line.trim().split(/\s+/)[0]))
    try {
      const entry = new URL('../../../src/pty.mts', import.meta.url).pathname
      const source = `
      const { spawnPty } = require(${JSON.stringify(entry)});
      for (let i=0; i<8; i++) spawnPty(${JSON.stringify(executable)}, ['1']);
      process.kill(process.pid, 'SIGKILL');
    `
      assert.throws(
        () =>
          execFileSync(process.execPath, ['--experimental-ffi', '-e', source], {
            stdio: 'ignore',
            timeout: 5000,
          }),
        (error: unknown) => (error as { signal?: string }).signal === 'SIGKILL',
      )
      const deadline = Date.now() + 4000
      let survivors = findSurvivors()
      while (survivors.length && Date.now() < deadline) {
        await delay(50)
        survivors = findSurvivors()
      }
      assert.deepEqual(
        survivors,
        [],
        'bootstrap processes outlived the one-second target',
      )
    } finally {
      // Only processes carrying this test's unique executable path are ours.
      for (const pid of findSurvivors()) {
        try {
          process.kill(pid, 'SIGKILL')
        } catch {}
      }
      rmSync(dir, { recursive: true, force: true })
    }
  },
)

test(
  'Darwin backend starts a controlling-terminal session and drains output before exit',
  { skip: process.platform !== 'darwin' },
  async () => {
    const pty = await spawnPty(
      'sh',
      [
        '-c',
        'test -t 0 && test -t 1 && test -t 2 && echo TTY_OK; printf \'PWD:%s TERM:%s\\n\' "$PWD" "$TERM"; exit 7',
      ],
      { cwd: '/tmp', env: { PATH: '/bin' } },
    )
    let output = ''
    const data = pty.onData(chunk => {
      output += chunk
    })
    try {
      assert.deepEqual(await pty.exited, { exitCode: 7, signal: 0 })
      assert.match(output, /TTY_OK/)
      assert.match(output, /PWD:(?:\/private)?\/tmp TERM:xterm-256color/)
    } finally {
      data.dispose()
      await pty.close()
    }
  },
)

test(
  'Darwin bootstrap gives a direct Node child access to /dev/tty and restores NODE_* env',
  { skip: process.platform !== 'darwin' },
  async () => {
    const source = [
      "const fs = require('node:fs');",
      "const fd = fs.openSync('/dev/tty', 'r'); fs.closeSync(fd);",
      "console.log('CONTROLLING_TTY:' + process.env.FIXTURE_NODE_ENV + ' SPECIAL_ENV:' + process.env['__proto__']);",
    ].join(' ')
    const pty = await spawnPty(process.execPath, ['-e', source], {
      env: {
        PATH: '/bin',
        NODE_OPTIONS: '--no-warnings',
        PTY_FFI_TARGET_NODE_ENV: 'original',
        FIXTURE_NODE_ENV: 'restored',
        ['__proto__']: 'restored special key',
      },
    })
    let output = ''
    const data = pty.onData(chunk => {
      output += chunk
    })
    try {
      assert.deepEqual(await pty.exited, { exitCode: 0, signal: 0 })
      assert.match(output, /CONTROLLING_TTY:restored/)
      assert.match(output, /SPECIAL_ENV:restored special key/)
    } finally {
      data.dispose()
      await pty.close()
    }
  },
)

test(
  'Darwin backend validates executable before allocating a PTY',
  { skip: process.platform !== 'darwin' },
  async () => {
    await assert.rejects(
      () => spawnPty('/definitely/not/a/command', []),
      /Executable not found/,
    )
  },
)

test(
  'Darwin resize updates the kernel terminal dimensions',
  { skip: process.platform !== 'darwin' },
  async () => {
    const pty = await spawnPty('/bin/sh', [
      '-c',
      'stty -echo; echo READY; read line; stty size',
    ])
    let output = ''
    let ready!: () => void
    const readySeen = new Promise<void>(resolve => {
      ready = resolve
    })
    const data = pty.onData(chunk => {
      output += chunk
      if (output.includes('READY')) ready()
    })
    try {
      await readySeen
      await pty.resize(117, 43)
      await pty.write('\n')
      assert.deepEqual(await pty.exited, { exitCode: 0, signal: 0 })
      assert.match(output, /43 117/)
    } finally {
      data.dispose()
      await pty.close()
    }
  },
)

test(
  'macOS rejects failed target exec, but preserves a real target exit 127 (#265, #689)',
  { skip: process.platform !== 'darwin', timeout: 10_000 },
  async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ffi-pty-exec-failure-'))
    try {
      for (const contents of [
        'not an executable\n',
        '#!/nonexistent-ffi-pty-interpreter\n',
      ]) {
        const target = join(dir, 'broken')
        writeFileSync(target, contents, { mode: 0o755 })
        await assert.rejects(
          spawnPty(target, []),
          /target startup failed: execve failed/,
        )
      }
      const pty = await spawnPty('/bin/sh', ['-c', 'exit 127'])
      try {
        assert.equal((await pty.exited).exitCode, 127)
      } finally {
        await pty.close()
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  },
)

for (const failure of [
  'openpty',
  'low-fd',
  'name',
  'pipe',
  'posix_spawnattr_init',
  'posix_spawn_file_actions_init',
  'posix_spawn',
]) {
  test(
    `macOS spawn releases acquired resources when ${failure} fails`,
    { skip: process.platform !== 'darwin' },
    () => {
      const { spawn } = require('../../../src/darwin/darwin.mts')
      const { getRawPointer } = require('node:ffi')
      const errno = Buffer.alloc(4)
      errno.writeInt32LE(12)
      const closed: number[] = []
      const destroyed: string[] = []
      const native = new Proxy(
        {
          __error: () => getRawPointer(errno),
          openpty(master: Buffer, slave: Buffer, name: Buffer) {
            master.writeInt32LE(failure === 'low-fd' ? 1 : 10)
            slave.writeInt32LE(11)
            if (failure === 'name') name.fill(65)
            else name.write('/dev/fake')
            return failure === 'openpty' ? -1 : 0
          },
          close(fd: number) {
            closed.push(fd)
            return 0
          },
        },
        {
          get(target, key: string) {
            if (key in target) return target[key as keyof typeof target]
            return () => {
              if (key.endsWith('_destroy')) destroyed.push(key)
              return key === failure ? 12 : 0
            }
          },
        },
      )
      assert.throws(
        () =>
          spawn(
            {
              file: '/bin/sh',
              args: [],
              cwd: process.cwd(),
              env: {},
              cols: 80,
              rows: 24,
            },
            native,
            () => {
              if (failure === 'pipe') throw new Error('pipe failed')
              return { read: 12, write: 13 }
            },
          ),
        /failed|descriptor|unterminated/,
      )
      const expected =
        failure === 'openpty'
          ? []
          : failure === 'low-fd'
            ? [1, 11]
            : ['name', 'pipe'].includes(failure)
              ? [10, 11]
              : [10, 11, 12, 13]
      assert.deepEqual(
        closed.toSorted((a, b) => a - b),
        expected,
      )
      assert.equal(new Set(closed).size, closed.length)
      assert.equal(
        destroyed.includes('posix_spawnattr_destroy'),
        ['posix_spawn_file_actions_init', 'posix_spawn'].includes(failure),
      )
      assert.equal(
        destroyed.includes('posix_spawn_file_actions_destroy'),
        failure === 'posix_spawn',
      )
    },
  )
}

test(
  'macOS wait retries EINTR, reports other errors, and decodes signal exits; kill ignores ESRCH only',
  { skip: process.platform !== 'darwin' },
  () => {
    const { wait, kill } = require('../../../src/darwin/darwin.mts')
    const { getRawPointer } = require('node:ffi')
    const errno = Buffer.alloc(4)
    let found = -1
    const native = {
      __error: () => getRawPointer(errno),
      waitpid(_pid: number, status: Buffer) {
        status.writeInt32LE(9)
        return found
      },
      kill: () => -1,
    }
    errno.writeInt32LE(4)
    assert.equal(wait(42, native), null)
    errno.writeInt32LE(10)
    assert.throws(() => wait(42, native), /errno 10/)
    found = 0
    assert.equal(wait(42, native), null)
    found = 42
    assert.deepEqual(wait(42, native), { exitCode: null, signal: 9 })
    errno.writeInt32LE(3)
    assert.doesNotThrow(() => kill(42, 'SIGTERM', native))
    errno.writeInt32LE(1)
    assert.throws(() => kill(42, '9', native), /errno 1/)
    for (const signal of ['invalid', '-1', '32', '1.5']) {
      assert.throws(() => kill(42, signal, native), /Unsupported signal/)
    }
  },
)
