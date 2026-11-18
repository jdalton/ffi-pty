import assert from 'node:assert/strict'
import { test } from 'node:test'
import { splitWindowsPath } from '../../paths/windows.mts'

test('Windows path splitting preserves drive roots and accepts mixed or repeated separators', () => {
  assert.deepEqual(splitWindowsPath('C:\\cache\\helper.exe'), {
    root: 'C:\\',
    parts: ['cache', 'helper.exe'],
  })
  assert.deepEqual(splitWindowsPath('C:/cache//nested\\helper.exe/'), {
    root: 'C:/',
    parts: ['cache', 'nested', 'helper.exe'],
  })
  assert.deepEqual(splitWindowsPath('C:relative\\helper.exe'), {
    root: 'C:',
    parts: ['relative', 'helper.exe'],
  })
  assert.deepEqual(splitWindowsPath('\\cache\\helper.exe'), {
    root: '\\',
    parts: ['cache', 'helper.exe'],
  })
})

test('Windows path splitting keeps UNC and extended drive roots separate from components', () => {
  assert.deepEqual(splitWindowsPath('\\\\server\\share\\cache\\helper.exe'), {
    root: '\\\\server\\share\\',
    parts: ['cache', 'helper.exe'],
  })
  assert.deepEqual(splitWindowsPath('\\\\?\\C:\\cache\\helper.exe'), {
    root: '\\\\?\\C:\\',
    parts: ['cache', 'helper.exe'],
  })
  assert.deepEqual(splitWindowsPath('\\\\?\\UNC\\server\\share\\helper.exe'), {
    root: '\\\\?\\UNC\\',
    parts: ['server', 'share', 'helper.exe'],
  })
})

test('Windows path splitting retains dot components for ancestor security checks and handles empty paths', () => {
  assert.deepEqual(splitWindowsPath('C:\\link\\..\\.\\helper.exe'), {
    root: 'C:\\',
    parts: ['link', '..', '.', 'helper.exe'],
  })
  assert.deepEqual(splitWindowsPath(''), { root: '', parts: [] })
  assert.deepEqual(splitWindowsPath('C:\\'), { root: 'C:\\', parts: [] })
  assert.deepEqual(splitWindowsPath('relative'), {
    root: '',
    parts: ['relative'],
  })
})
