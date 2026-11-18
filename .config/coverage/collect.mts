import { spawnSync } from 'node:child_process'
import { globSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { makeReceipt, sourceSnapshot } from './accumulate.mts'

export interface CoverageConfig {
  include: string[]
  exclude: string[]
  platformExclude: Record<string, string[]>
  threshold: number
}

export function coverageScope(root: string, config: CoverageConfig) {
  if (!['darwin', 'linux', 'win32'].includes(process.platform))
    throw new Error('Unsupported coverage platform')
  const exclude = [
    ...config.exclude,
    ...(config.platformExclude[process.platform] ?? []),
  ]
  const files = [...globSync(config.include, { cwd: root, exclude })].sort()
  if (!files.length) throw new Error('Coverage scope is empty')
  return { files, exclude }
}

export function collectCoverage(options: {
  root: string
  config: CoverageConfig
  run: string
  suite: string
  shard: string
  command: string[]
  execute?: typeof spawnSync
  tool?: string
}) {
  const { root, config, run, suite, shard, command } = options
  for (const value of [run, suite, shard])
    if (!/^[\w.-]+$/.test(value))
      throw new Error('Invalid coverage run/suite/shard name')
  if (!command.length) throw new Error('Missing coverage command')
  const { files, exclude } = coverageScope(root, config)
  const sources = sourceSnapshot(root, files)
  const directory = resolve(
    root,
    '.cache/coverage',
    `${process.platform}-${process.arch}`,
    run,
    suite,
    shard,
  )
  // A run is immutable: retries use a new run name so old or failed evidence
  // cannot silently be replaced by a later shard using the same identity.
  mkdirSync(resolve(directory, '..'), { recursive: true })
  mkdirSync(directory)
  const require = createRequire(resolve(root, 'package.json'))
  const result = (options.execute ?? spawnSync)(
    process.execPath,
    [
      options.tool ?? require.resolve('c8/bin/c8.js'),
      '--all',
      '--extension=.mts',
      '--extension=.mjs',
      '--reporter=json',
      '--reporter=text-summary',
      `--reports-dir=${directory}`,
      `--temp-directory=${resolve(directory, 'raw')}`,
      ...config.include.map(pattern => `--include=${pattern}`),
      ...exclude.map(pattern => `--exclude=${pattern}`),
      ...command,
    ],
    { cwd: root, stdio: 'inherit' },
  )
  if (result.error) throw result.error
  if (
    JSON.stringify(sourceSnapshot(root, coverageScope(root, config).files)) !==
    JSON.stringify(sources)
  )
    throw new Error('Sources changed during coverage collection')
  const report = JSON.parse(
    readFileSync(resolve(directory, 'coverage-final.json'), 'utf8'),
  )
  const receipt = makeReceipt({
    root,
    sources,
    run,
    suite,
    shard,
    report,
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    passed: result.status === 0,
  })
  writeFileSync(
    resolve(directory, 'receipt.json'),
    JSON.stringify(receipt) + '\n',
  )
  return { directory, passed: receipt.passed }
}

export function collectMain(args: string[]) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      root: { type: 'string', default: process.cwd() },
      run: { type: 'string' },
      suite: { type: 'string', default: 'unit' },
      shard: { type: 'string', default: '1' },
    },
  })
  if (!values.run)
    throw new Error(
      'Use --run=<unique-name> [--suite=unit|integration|e2e] [--shard=1] -- <command>',
    )
  const root = resolve(values.root)
  const config = JSON.parse(
    readFileSync(resolve(root, '.config/coverage.json'), 'utf8'),
  ) as CoverageConfig
  const result = collectCoverage({
    root,
    config,
    run: values.run,
    suite: values.suite,
    shard: values.shard,
    command: positionals,
  })
  return result.passed ? 0 : 1
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = collectMain(process.argv.slice(2))
}
