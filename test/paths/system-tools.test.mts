import assert from 'node:assert/strict'
import test from 'node:test'
import { archiveTool } from '../../paths/system-tools.mts'

test('Windows extraction uses the native tar rather than Git Bash tar', () => {
  assert.equal(
    archiveTool('win32', { SystemRoot: 'C:/Windows' }),
    'C:\\Windows\\System32\\tar.exe',
  )
  assert.equal(
    archiveTool('win32', { SYSTEMROOT: 'D:/Windows' }),
    'D:\\Windows\\System32\\tar.exe',
  )
  assert.throws(() => archiveTool('win32', {}), /absolute/)
  assert.throws(
    () => archiveTool('win32', { SystemRoot: 'relative' }),
    /absolute/,
  )
  assert.equal(archiveTool('linux', {}), 'tar')
})
