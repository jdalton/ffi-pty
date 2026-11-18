import assert from 'node:assert/strict'
import { test } from 'node:test'
import { pathScope, runnerTargets } from '../../../scripts/ci/targets.mts'

test('platform architecture directories and mirrored tests have the same scope', () => {
  for (const platform of ['darwin', 'linux', 'win32']) {
    for (const architecture of ['x64', 'arm64']) {
      for (const root of ['src', 'test/src']) {
        assert.deepEqual(
          pathScope(`${root}/${platform}/${architecture}/file.mts`),
          { architecture },
        )
      }
    }
  }
  assert.deepEqual(pathScope('test\\src\\win32\\arm64\\file.mts'), {
    architecture: 'arm64',
  })
  assert.deepEqual(pathScope('assets/conpty/x64/conpty.dll.br'), {
    architecture: 'x64',
  })
})
test('Linux libc scope composes with architecture and does not narrow shared files', () => {
  for (const libc of ['glibc', 'musl']) {
    assert.deepEqual(pathScope(`src/linux/${libc}/file.mts`), { libc })
    assert.deepEqual(pathScope(`test/src/linux/${libc}/arm64/file.mts`), {
      libc,
      architecture: 'arm64',
    })
  }
  for (const path of [
    'src/linux/linux.mts',
    'src/win32/arm64.mts',
    'src/common/arm64/file.mts',
    'docs/arm64.md',
  ]) {
    assert.deepEqual(pathScope(path), {})
  }
})
test('runner catalog keeps unique labels and one routine runner for each supported OS and architecture', () => {
  assert.equal(
    new Set(runnerTargets.map(target => target.runner)).size,
    runnerTargets.length,
  )
  assert.equal(runnerTargets.filter(target => target.routine).length, 6)
  for (const platform of ['darwin', 'linux', 'win32']) {
    assert.deepEqual(
      runnerTargets
        .filter(target => target.platform === platform && target.routine)
        .map(target => target.architecture)
        .toSorted(),
      ['arm64', 'x64'],
    )
  }
})
