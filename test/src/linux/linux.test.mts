import { execFileSync } from 'node:child_process'
import { repositoryRoot } from '../../../paths/repository.mts'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { test } from 'vitest'
import { dlopen } from 'node:ffi'
import { closeSync, fstatSync, openSync } from 'node:fs'
import { spawnPty } from '../../../src/pty.mts'

const supportedRuntime =
  process.platform === 'linux' &&
  (() => {
    const version = process.report?.getReport().header.glibcVersionRuntime
    const match = version?.match(/^(\d+)\.(\d+)/)
    return (
      !!match &&
      (Number(match[1]) > 2 ||
        (Number(match[1]) === 2 && Number(match[2]) >= 34))
    )
  })()
const load = createRequire(import.meta.url)
const linux =
  process.platform === 'linux'
    ? (load(resolve(repositoryRoot, 'src/linux/linux.mts')) as {
        assertSupportedGlibc(version?: string): void
        getLibcFunctions(): Record<string, unknown>
        isLinuxNativeLoaded(): boolean
      })
    : undefined

test(
  'Linux closes inheritable descriptors above gaps before executing the target (#1011)',
  { skip: !supportedRuntime, timeout: 10_000 },
  async () => {
    const native = dlopen('libc.so.6', {
      fcntl: { arguments: ['int32', 'int32', 'int32'], return: 'int32' },
    }).functions
    const low = openSync('/dev/null', 'r')
    // F_DUPFD deliberately creates an inheritable fd above an unused range;
    // ordinary Node opens use CLOEXEC and would hide the original regression.
    const high = native.fcntl(low, 0, 200)
    closeSync(low)
    assert.ok(high >= 200)
    try {
      const identity = fstatSync(high)
      const script = `
      const fs = require('node:fs');
      let inherited = false;
      try { const s = fs.fstatSync(${high}); inherited = s.dev === ${identity.dev} && s.ino === ${identity.ino}; } catch {}
      console.log(inherited ? 'LEAKED' : 'CLOSED');
    `
      const pty = await spawnPty(process.execPath, ['-e', script])
      let output = ''
      pty.onData(data => {
        output += data
      })
      try {
        assert.equal((await pty.exited).exitCode, 0)
        assert.match(output, /CLOSED/)
        assert.doesNotMatch(output, /LEAKED/)
      } finally {
        await pty.close()
      }
    } finally {
      closeSync(high)
    }
  },
)

test(
  'Linux glibc version guard accepts 2.34+ and rejects older or unknown libc',
  {
    skip: process.platform !== 'linux',
  },
  () => {
    assert.doesNotThrow(() => linux!.assertSupportedGlibc('2.34'))
    assert.doesNotThrow(() => linux!.assertSupportedGlibc('2.40'))
    assert.doesNotThrow(() => linux!.assertSupportedGlibc('3.0'))
    assert.throws(
      () => linux!.assertSupportedGlibc('2.33'),
      /glibc 2.34 or newer/,
    )
    assert.throws(
      () => linux!.assertSupportedGlibc('musl'),
      /glibc 2.34 or newer/,
    )
    assert.throws(() => linux!.assertSupportedGlibc(''), /glibc 2.34 or newer/)
  },
)

test(
  'Linux libc symbols load only when requested',
  {
    skip: !supportedRuntime,
  },
  () => {
    // Earlier PTY tests initialize libc. A fresh process proves lazy loading
    // without depending on test declaration order or resetting live bindings.
    execFileSync(
      process.execPath,
      [
        '--experimental-ffi',
        '-e',
        `
      const assert = require('node:assert/strict');
      const linux = require(${JSON.stringify(resolve(repositoryRoot, 'src/linux/linux.mts'))});
      assert.equal(linux.isLinuxNativeLoaded(), false);
      const symbols = linux.getLibcFunctions();
      for (const name of ['openpty', 'posix_spawn', 'waitpid']) assert.equal(typeof symbols[name], 'function');
      assert.equal(linux.isLinuxNativeLoaded(), true);
    `,
      ],
      { timeout: 10_000, stdio: 'pipe' },
    )
  },
)

for (const failure of [
  'openpty',
  'low-master',
  'low-slave',
  'posix_spawnattr_init',
  'posix_spawn_file_actions_init',
  'posix_spawn',
]) {
  test(
    `Linux spawn releases owned descriptors and initialized attributes after ${failure} failure`,
    { skip: !supportedRuntime },
    () => {
      const { spawnLinux } = load('../../../src/linux/linux.mts')
      const { getRawPointer } = load('node:ffi')
      const errno = Buffer.alloc(4)
      errno.writeInt32LE(12)
      const closed: number[] = []
      const destroyed: string[] = []
      const native = new Proxy(
        {
          __errno_location: () => getRawPointer(errno),
          openpty(master: Buffer, slave: Buffer, name: Buffer) {
            master.writeInt32LE(failure === 'low-master' ? 1 : 10)
            slave.writeInt32LE(failure === 'low-slave' ? 2 : 11)
            name.write('/dev/fake')
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
          spawnLinux(
            {
              file: process.execPath,
              args: [],
              cwd: process.cwd(),
              env: {},
              cols: 80,
              rows: 24,
            },
            native,
          ),
        /failed|descriptor/,
      )
      assert.deepEqual(
        closed.toSorted((a, b) => a - b),
        failure === 'openpty'
          ? []
          : failure === 'low-master'
            ? [1, 11]
            : failure === 'low-slave'
              ? [2, 10]
              : [10, 11],
      )
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
  'Linux wait retries EINTR, reports other errors, and validates failed signal and close calls',
  { skip: !supportedRuntime },
  () => {
    const { waitLinux, killLinux, closeLinuxFd, assertSupportedGlibc } = load(
      '../../../src/linux/linux.mts',
    )
    const { getRawPointer } = load('node:ffi')
    const errno = Buffer.alloc(4)
    errno.writeInt32LE(4)
    const native = {
      __errno_location: () => getRawPointer(errno),
      waitpid: () => -1,
      kill: () => -1,
      close: () => -1,
    }
    assert.equal(waitLinux(123, native), null)
    errno.writeInt32LE(3)
    assert.throws(() => waitLinux(123, native), /waitpid failed.*3/)
    assert.throws(
      () => killLinux(123, 'NOT_A_SIGNAL', native),
      /Unknown signal/,
    )
    assert.throws(() => killLinux(123, 15, native), /kill failed.*3/)
    assert.throws(() => closeLinuxFd(123, native), /close failed.*3/)
    assert.throws(() => assertSupportedGlibc('1.99'), /glibc/)
    assert.throws(() => assertSupportedGlibc(null), /unknown/)
  },
)
