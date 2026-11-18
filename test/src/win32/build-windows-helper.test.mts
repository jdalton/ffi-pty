import assert from 'node:assert/strict'
import { test } from 'vitest'
import {
  quoteResponsePath,
  findVsDevCmd,
  buildHelper,
  targetArchitecture,
} from '../../../src/win32/build-windows-helper.mts'

test('helper build target honors explicit and npm architecture selection', () => {
  assert.equal(targetArchitecture(['--arch=arm64'], {}), 'arm64')
  assert.equal(targetArchitecture([], { npm_config_arch: 'x64' }), 'x64')
  assert.equal(targetArchitecture([], { ARCH: 'arm64' }), 'arm64')
  assert.throws(
    () => targetArchitecture(['--arch=ia32'], {}),
    /supports x64 and arm64/,
  )
})

test('MSVC response paths stay quoted without trailing slash escapes', () => {
  assert.equal(
    quoteResponsePath('C:\\Program Files\\VS\\cl.exe'),
    '"C:\\Program Files\\VS\\cl.exe"',
  )
  assert.equal(quoteResponsePath('C:\\build\\out/'), '"C:\\build\\out/"')
  assert.throws(
    () => quoteResponsePath('C:\\bad"path'),
    /may not contain quotes/,
  )
})

test('Visual Studio lookup accepts a matching tool path and reports missing or failed discovery', () => {
  assert.equal(
    findVsDevCmd({}, (() => '\r\nC:\\VS\\VsDevCmd.bat\r\n') as never),
    'C:\\VS\\VsDevCmd.bat',
  )
  assert.throws(
    () => findVsDevCmd({}, (() => 'not the tool\n') as never),
    /not found/,
  )
  assert.throws(
    () =>
      findVsDevCmd({}, (() => {
        throw new Error('vswhere failed')
      }) as never),
    /vswhere failed/,
  )
})

for (const result of [
  { error: new Error('spawn failed'), status: null },
  { status: 2 },
]) {
  test(
    `Windows helper build reports ${result.error ? 'spawn errors' : 'nonzero compiler status'}`,
    { skip: process.platform !== 'win32' },
    () => {
      assert.throws(
        () =>
          buildHelper(
            'x64',
            {},
            (() => result) as never,
            () => 'C:\\VS\\VsDevCmd.bat',
          ),
        /spawn failed|exit code 2/,
      )
    },
  )
}
