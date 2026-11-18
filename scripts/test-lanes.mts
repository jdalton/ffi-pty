import { basename } from 'node:path'

export type TestLane = 'fast' | 'mid' | 'slow'
// Batch deadlines include worker startup and coverage on hosted runners.
export const laneBudgets: Record<TestLane, number> = {
  fast: 30_000,
  mid: 60_000,
  slow: 120_000,
}

// Files mixing unit assertions with real PTY/process tests stay in slow until
// those tests are split. No test is omitted: fast is the remaining partition.
export const slowTests = new Set([
  'compat.test.mts',
  'unix-control.test.mts',
  'unix-common.test.mts',
  'darwin.test.mts',
  'linux.test.mts',
  'probe.test.mts',
  'pty.test.mts',
  'windows.test.mts',
  'windows-ffi.test.mts',
  'windows-ffi-resize.test.mts',
  'windows-resource.test.mts',
  'windows-broker-lifecycle.test.mts',
  'windows-helper-lifecycle.test.mts',
  'windows-helper-trust.native.test.mts',
])
export const midTests = new Set([
  'build-windows-helper.test.mts',
  'darwin-bootstrap.test.mts',
  'darwin-startup.test.mts',
  'unix-native.test.mts',
  'unix-poll.test.mts',
  'windows-broker-client.test.mts',
  'windows-broker.test.mts',
  'windows-controller.test.mts',
  'windows-ffi-worker.test.mts',
  'windows-helper-lock.test.mts',
  'windows-helper-pe.test.mts',
  'windows-helper-trust.test.mts',
  'windows-native.test.mts',
])

export function testLane(file: string): TestLane {
  if (file.replaceAll('\\', '/').includes('test/upstream/')) {
    return 'slow'
  }
  const name = basename(file.replaceAll('\\', '/'))
  if (slowTests.has(name)) {
    return 'slow'
  }
  if (midTests.has(name)) {
    return 'mid'
  }
  return 'fast'
}

export function isTestLane(value: string): value is TestLane {
  return Object.hasOwn(laneBudgets, value)
}
