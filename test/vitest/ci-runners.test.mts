import assert from 'node:assert/strict'
import { test } from 'vitest'
import {
  affectedPlatforms,
  selectRunners,
  platformRunners,
  platforms,
  allRunners,
} from '../../scripts/ci/runners.mts'

test('source and mirrored test folders select only their platform', () => {
  for (const platform of platforms) {
    for (const prefix of ['src/', 'test/src/']) {
      assert.deepEqual(
        selectRunners([`${prefix}${platform}/file.mts`]).runner,
        platformRunners[platform].filter(runner => runner !== 'windows-2022'),
      )
    }
  }
  assert.deepEqual(affectedPlatforms('test\\src\\win32\\helper.test.mts'), [
    'win32',
  ])
})
test('shared Unix, upstream adaptations and ConPTY assets select the relevant systems', () => {
  for (const path of [
    'src/unix-common.mts',
    'test/src/unix-open.test.mts',
    'test/upstream/node-pty/src/unixTerminal.test.mts',
  ]) {
    assert.deepEqual(affectedPlatforms(path), ['darwin', 'linux'])
  }
  for (const path of [
    'assets/conpty/arm64/conpty.dll.br',
    'test/upstream/node-pty/src/windowsTerminal.test.mts',
    'test/upstream/node-pty/windows-helpers.mts',
    'test/upstream/node-pty/window-probe.mts',
  ]) {
    assert.deepEqual(affectedPlatforms(path), ['win32'])
  }
})
test('shared code, dependencies, unknown paths and unavailable diffs check all three OSes', () => {
  for (const files of [
    undefined,
    ['src/events.mts'],
    ['pnpm-lock.yaml'],
    ['.github/workflows/ci.yml'],
    ['unknown'],
    ['docs/example.mts'],
  ]) {
    assert.deepEqual(
      selectRunners(files).runner,
      allRunners.filter(runner => runner !== 'windows-2022'),
    )
    assert.equal(selectRunners(files).docsOnly, false)
  }
})
test('documentation-only and empty diffs use Linux checks without native tests', () => {
  for (const files of [[], ['README.md', 'docs/api.md', 'docs/coverage.svg']]) {
    assert.equal(selectRunners(files).docsOnly, true)
    assert.deepEqual(selectRunners(files).runner, ['ubuntu-22.04'])
  }
  assert.equal(selectRunners(['README.md', 'src/pty.mts']).docsOnly, false)
})
test('mixed platform changes select a stable deduplicated union including both sides of moves', () => {
  assert.deepEqual(
    selectRunners(['src/win32/a.mts', 'src/linux/a.mts', 'src/linux/b.mts'])
      .runner,
    ['ubuntu-22.04', 'ubuntu-22.04-arm', 'windows-2025', 'windows-11-arm'],
  )
})
test('manual targets select every individual runner or complete platform group', () => {
  for (const runner of allRunners) {
    assert.deepEqual(selectRunners([], runner).runner, [runner])
  }
  for (const platform of platforms) {
    assert.deepEqual(
      selectRunners([], platform).runner,
      platformRunners[platform],
    )
  }
  assert.deepEqual(selectRunners([], 'unix').runner, [
    ...platformRunners.darwin,
    ...platformRunners.linux,
  ])
  assert.deepEqual(selectRunners([], 'all').runner, allRunners)
  assert.throws(() => selectRunners([], 'toString'), /Unknown/)
  assert.throws(() => selectRunners([], 'invalid'), /Unknown/)
})
test('release verification always runs the full matrix even with documentation or narrow input', () => {
  assert.deepEqual(
    selectRunners(['README.md'], 'windows-11-arm', true).runner,
    allRunners,
  )
  assert.equal(selectRunners([], 'auto', true).docsOnly, false)
})

test('architecture-only changes select the matching native runner for every OS', () => {
  const cases = [
    ['darwin/arm64', 'macos-15'],
    ['darwin/x64', 'macos-15-intel'],
    ['linux/arm64', 'ubuntu-22.04-arm'],
    ['linux/glibc/x64', 'ubuntu-22.04'],
    ['win32/arm64', 'windows-11-arm'],
    ['win32/x64', 'windows-2025'],
  ]
  for (const [directory, runner] of cases) {
    for (const prefix of ['src/', 'test/src/']) {
      assert.deepEqual(
        selectRunners([prefix + directory + '/file.mts']).runner,
        [runner],
      )
    }
  }
  assert.deepEqual(
    selectRunners(['assets/conpty/arm64/conpty.dll.br']).runner,
    ['windows-11-arm'],
  )
  assert.deepEqual(
    selectRunners(['src/darwin/x64/old.mts', 'src/darwin/arm64/new.mts'])
      .runner,
    ['macos-15', 'macos-15-intel'],
  )
  assert.deepEqual(
    selectRunners(['src/win32/arm64/file.mts', 'src/win32/windows.mts']).runner,
    ['windows-2025', 'windows-11-arm'],
  )
})
test('an unconfigured libc fails planning instead of pretending a glibc runner tests musl', () => {
  assert.throws(
    () => selectRunners(['src/linux/musl/arm64/file.mts']),
    /No CI runner configured/,
  )
})

test('configured libc variants select independently and shared Linux code selects both', () => {
  const targets = [
    {
      runner: 'glibc-x64',
      platform: 'linux',
      architecture: 'x64',
      libc: 'glibc',
      routine: true,
    },
    {
      runner: 'musl-x64',
      platform: 'linux',
      architecture: 'x64',
      libc: 'musl',
      routine: true,
    },
    {
      runner: 'musl-arm64',
      platform: 'linux',
      architecture: 'arm64',
      libc: 'musl',
      routine: true,
    },
  ] as const
  assert.deepEqual(
    selectRunners(['src/linux/musl/arm64/file.mts'], 'auto', false, targets)
      .runner,
    ['musl-arm64'],
  )
  assert.deepEqual(
    selectRunners(['test/src/linux/glibc/file.mts'], 'auto', false, targets)
      .runner,
    ['glibc-x64'],
  )
  assert.deepEqual(
    selectRunners(['src/linux/x64/file.mts'], 'auto', false, targets).runner,
    ['glibc-x64', 'musl-x64'],
  )
  assert.deepEqual(
    selectRunners(['src/linux/linux.mts'], 'auto', false, targets).runner,
    ['glibc-x64', 'musl-x64', 'musl-arm64'],
  )
})
