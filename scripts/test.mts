import { isTestLane, laneBudgets, testLane } from './test-lanes.mts'
import { repositoryRoot } from '../paths/repository.mts'
import { spawnSync } from 'node:child_process'
import { globSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export function unitTestArguments(
  root: string,
  files: string[],
  extra: string[] = [],
  runtime = {
    platform: process.platform,
    coverage: Boolean(process.env.NODE_V8_COVERAGE),
  },
) {
  return [
    '--experimental-ffi',
    '--permission',
    '--allow-fs-read=*',
    '--allow-fs-write=*',
    '--allow-child-process',
    '--allow-worker',
    '--allow-ffi',
    '--allow-addons',
    ...(runtime.coverage ? ['--allow-inspector'] : []),
    // Node groups Windows named pipes with networking. The preload permits
    // only IPC paths and blocks TCP, UDP, DNS and unmatched HTTP requests.
    ...(runtime.platform === 'win32' ? ['--allow-net'] : []),
    `--import=${pathToFileURL(resolve(root, 'test/setup/no-network.mts')).href}`,
    '--test',
    // Hosted two-core runners otherwise default to one test worker. Files are
    // process-isolated, so two workers overlap native waits without sharing mocks.
    '--test-concurrency=2',
    '--test-timeout=60000',
    ...extra,
    ...files,
  ]
}

export function testFiles(root: string, suite = 'unit'): string[] {
  const patterns: Record<string, string[]> = {
    unit: [
      'test/vitest/**/*.test.mts',
      'test/src/**/*.test.mts',
      'test/upstream/node-pty/src/**/*.test.mts',
    ],
    tooling: [
      'test/scripts/**/*.test.mts',
      'test/paths/**/*.test.mts',
      'test/.config/coverage/**/*.test.mts',
    ],
    integration: ['test/src/**/*.integration.test.mts'],
  }
  if (isTestLane(suite)) {
    return testFiles(root, 'unit').filter(file => testLane(file) === suite)
  }
  if (!patterns[suite]) {
    throw new Error(`Unknown test suite: ${suite}`)
  }
  return [...globSync(patterns[suite], { cwd: root })]
    .filter(
      file =>
        suite === 'integration' || !file.endsWith('.integration.test.mts'),
    )
    .map(file => file.replaceAll('\\', '/'))
    .toSorted()
}

export function runTests(
  args: string[],
  root = repositoryRoot,
  execute = spawnSync,
): number {
  const [suite = 'fast', ...extra] = args
  const files = testFiles(root, suite)
  if (!files.length) {
    throw new Error(`No tests found for ${suite}`)
  }
  const batches =
    suite === 'slow'
      ? [
          files.filter(file => !file.startsWith('test/upstream/')),
          files.filter(file => file.startsWith('test/upstream/')),
        ].filter(batch => batch.length)
      : [files]
  let status = 0
  let failure: Error | undefined
  for (const batch of batches) {
    const flags =
      suite === 'integration'
        ? [
            '--experimental-ffi',
            '--test',
            '--test-timeout=60000',
            ...extra,
            ...batch,
          ]
        : suite === 'tooling'
          ? unitTestArguments(root, batch, extra)
          : [
              '--experimental-ffi',
              resolve(root, 'node_modules/vitest/vitest.mjs'),
              'run',
              '--config',
              resolve(root, 'vitest.config.mts'),
              '--execArgv=--experimental-ffi',
              ...extra,
              ...batch,
            ]
    const result = execute(process.execPath, flags, {
      cwd: root,
      stdio: 'inherit',
      ...(isTestLane(suite)
        ? { timeout: laneBudgets[suite], killSignal: 'SIGKILL' as const }
        : {}),
    })
    failure ??= result.error
    if (result.status !== 0) {
      status = result.status ?? 1
    }
  }
  if (failure) {
    throw failure
  }
  return status
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = runTests(process.argv.slice(2))
}
