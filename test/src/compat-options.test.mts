import assert from 'node:assert/strict'
import { test } from 'vitest'
import {
  normalizeCompatibleOptions,
  compatibleEnvironment,
  compatibleEncoding,
  validateCredentials,
} from '../../src/compat-options.mts'

test('compatible defaults preserve node-pty TERM, shell, dimensions, and environment rules', () => {
  const unix = normalizeCompatibleOptions(
    undefined,
    undefined,
    { env: { KEEP: 'yes', DROP: undefined } },
    'linux',
  )
  assert.equal(unix.spawn.file, 'sh')
  assert.deepEqual(unix.spawn.args, [])
  assert.equal(unix.name, 'xterm')
  assert.equal(unix.spawn.env.TERM, 'xterm')
  assert.equal(unix.spawn.env.DROP, undefined)
  assert.equal(unix.spawn.env.PWD, process.cwd())
  assert.equal(unix.spawn.cols, 80)
  assert.equal(unix.spawn.rows, 24)
  const win = normalizeCompatibleOptions(
    undefined,
    '/c echo hello',
    { env: {} },
    'win32',
  )
  assert.equal(win.spawn.file, 'cmd.exe')
  assert.equal(win.name, 'Windows Shell')
  assert.equal(win.spawn.commandLine, '/c echo hello')
  assert.equal(Object.hasOwn(win.spawn.env, 'TERM'), false)
  assert.throws(
    () => normalizeCompatibleOptions('sh', 'bad', {}, 'linux'),
    /string/,
  )
})

test('compatible options accept names, encodings, flow controls and credentials without mutating inputs', () => {
  const env = { TERM: 'old', X: 'x' }
  const value = normalizeCompatibleOptions(
    'sh',
    [],
    {
      env,
      name: 'vt100',
      cols: 90,
      rows: 30,
      cwd: '/tmp',
      encoding: null,
      uid: 12,
      gid: 13,
      handleFlowControl: true,
      flowControlPause: 'stop',
      flowControlResume: 'go',
    },
    'darwin',
  )
  assert.equal(value.spawn.env.TERM, 'vt100')
  assert.equal(env.TERM, 'old')
  assert.equal(value.spawn.uid, 12)
  assert.equal(value.spawn.gid, 13)
  assert.equal(value.encoding, null)
  assert.equal(value.flowControlPause, 'stop')
  assert.equal(value.flowControlResume, 'go')
  assert.equal(value.handleFlowControl, true)
  assert.equal(
    normalizeCompatibleOptions('sh', [], { uid: -1, gid: -1 }, 'linux').spawn
      .uid,
    undefined,
  )
  assert.equal(
    normalizeCompatibleOptions(
      'cmd.exe',
      [],
      { conptyInheritCursor: true },
      'win32',
    ).spawn.conptyInheritCursor,
    true,
  )
  assert.equal(compatibleEncoding('latin1', false), 'latin1')
  assert.equal(compatibleEncoding(null, true), null)
  assert.throws(
    () => compatibleEncoding('bad' as BufferEncoding, false),
    /encoding/,
  )
  for (const invalid of [-2, NaN, 1.2, 0xff_ff_ff_ff]) {
    assert.throws(() => validateCredentials({ uid: invalid }), /uid/)
  }
  assert.throws(
    () => normalizeCompatibleOptions('sh', [], null as never),
    /options/,
  )
  assert.throws(
    () => normalizeCompatibleOptions('sh', [], { flowControlPause: '\0' }),
    /NUL/,
  )
  assert.equal(compatibleEnvironment({ TMUX: 'kept' }, false).TMUX, 'kept')
  const saved = process.env.TMUX
  try {
    process.env.TMUX = 'removed'
    assert.equal(compatibleEnvironment(undefined, false).TMUX, undefined)
    assert.equal(compatibleEnvironment(undefined, true).TMUX, 'removed')
  } finally {
    if (saved === undefined) delete process.env.TMUX
    else process.env.TMUX = saved
  }
})
