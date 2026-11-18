import { createHash } from 'node:crypto'
import { readFileSync, realpathSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { createCoverageMap } = require('istanbul-lib-coverage')

export interface CoverageReceipt {
  version: 1
  platform: string
  arch: string
  node: string
  run: string
  suite: string
  shard: string
  passed: boolean
  root: string
  sources: Record<string, string>
  reportHash: string
  report: Record<string, any>
}

export function hash(bytes: string | Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

export function relativeSource(root: string, file: string): string {
  const name = relative(root, resolve(root, file)).split(sep).join('/')
  if (!name || name === '..' || name.startsWith('../') || isAbsolute(name))
    throw new Error(`Coverage source outside repository: ${file}`)
  return name
}

export function sourceSnapshot(
  root: string,
  files: string[],
): Record<string, string> {
  return Object.fromEntries(
    files
      .map(file => {
        const name = relativeSource(root, file)
        relativeSource(realpathSync(root), realpathSync(resolve(root, name)))
        return [name, hash(readFileSync(resolve(root, name)))]
      })
      .sort(([a], [b]) => a!.localeCompare(b!)),
  )
}

export function makeReceipt(
  config: Omit<CoverageReceipt, 'version' | 'reportHash'>,
): CoverageReceipt {
  return {
    ...config,
    version: 1,
    reportHash: hash(JSON.stringify(config.report)),
  }
}

export function validateReceipt(receipt: CoverageReceipt): void {
  if (
    receipt?.version !== 1 ||
    receipt.passed !== true ||
    !receipt.run ||
    !receipt.suite ||
    !receipt.shard ||
    !['darwin', 'linux', 'win32'].includes(receipt.platform) ||
    !receipt.arch ||
    !receipt.node ||
    !receipt.root ||
    !receipt.sources ||
    Object.keys(receipt.sources).length === 0 ||
    !receipt.report ||
    hash(JSON.stringify(receipt.report)) !== receipt.reportHash
  )
    throw new Error('Incomplete or corrupt coverage receipt')
  for (const digest of Object.values(receipt.sources))
    if (!/^[a-f\d]{64}$/.test(digest))
      throw new Error('Invalid coverage source hash')
}

export function mergeReceipts(
  receipts: CoverageReceipt[],
  expected: string[] = [],
) {
  if (!receipts.length) throw new Error('No coverage receipts supplied')
  const first = receipts[0]!
  const seen = new Set<string>()
  const map = createCoverageMap({})
  const sources = JSON.stringify(first.sources)
  for (const receipt of receipts) {
    validateReceipt(receipt)
    if (
      receipt.platform !== first.platform ||
      receipt.arch !== first.arch ||
      receipt.node !== first.node
    ) {
      throw new Error(
        'Cannot merge different platforms, architectures, or Node versions',
      )
    }
    if (JSON.stringify(receipt.sources) !== sources)
      throw new Error(
        'Coverage source snapshot changed; recollect the affected runs',
      )
    const identity = `${receipt.run}/${receipt.suite}/${receipt.shard}`
    if (seen.has(identity))
      throw new Error(`Duplicate coverage receipt: ${identity}`)
    seen.add(identity)
    const report: Record<string, any> = {}
    for (const [file, entry] of Object.entries(receipt.report)) {
      const name = relativeSource(receipt.root, file)
      if (
        !Object.hasOwn(receipt.sources, name) ||
        relativeSource(receipt.root, entry.path) !== name
      )
        throw new Error('Coverage report is outside its source inventory')
      for (const counters of [entry.s, entry.f]) {
        if (
          !counters ||
          Object.values(counters).some(
            n => !Number.isSafeInteger(n) || (n as number) < 0,
          )
        )
          throw new Error('Invalid coverage hit count')
      }
      if (
        !entry.b ||
        Object.values(entry.b).some(
          counts =>
            !Array.isArray(counts) ||
            counts.some(n => !Number.isSafeInteger(n) || n < 0),
        )
      )
        throw new Error('Invalid branch hit count')
      report[name] = { ...entry, path: name }
    }
    // c8 --all supplies zero-hit entries too. Missing files must not quietly
    // disappear from the denominator merely because no suite imported them.
    for (const file of Object.keys(receipt.sources))
      if (!report[file]) throw new Error(`Missing coverage source: ${file}`)
    map.merge(report)
  }
  for (const identity of expected)
    if (!seen.has(identity))
      throw new Error(`Missing coverage receipt: ${identity}`)
  const total = map.getCoverageSummary().toJSON()
  if (total.lines.total === 0)
    throw new Error('Coverage contains no executable lines')
  return {
    platform: first.platform,
    arch: first.arch,
    node: first.node,
    runs: [...seen],
    total,
    report: map.toJSON(),
  }
}

export function coverageFailures(
  total: Record<string, { covered: number; total: number }>,
  threshold = 98,
): string[] {
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100)
    throw new Error('Invalid coverage threshold')
  return ['lines', 'branches'].flatMap(metric => {
    const counts = total[metric]
    if (
      !counts ||
      !Number.isSafeInteger(counts.total) ||
      !Number.isSafeInteger(counts.covered) ||
      counts.total < 0 ||
      counts.covered < 0 ||
      counts.covered > counts.total
    )
      throw new Error('Invalid coverage totals')
    if (metric === 'lines' && counts.total === 0)
      return ['No executable line coverage']
    const percent =
      counts.total === 0 ? 100 : (counts.covered / counts.total) * 100
    return percent < threshold
      ? [`${metric}: ${percent.toFixed(2)}% < ${threshold}%`]
      : []
  })
}

export function coverageBadge(label: string, percent: number): string {
  if (
    !/^[a-zA-Z0-9 /-]+$/.test(label) ||
    !Number.isFinite(percent) ||
    percent < 0 ||
    percent > 100
  )
    throw new Error('Invalid badge data')
  const value = `${percent.toFixed(2)}%`
  const width = label.length * 7 + 12
  const color = percent >= 98 ? '#238636' : '#9a6700'
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width + 65}" height="20" role="img" aria-label="${label}: ${value}"><rect width="${width}" height="20" fill="#555"/><rect x="${width}" width="65" height="20" fill="${color}"/><g fill="#fff" font-family="Verdana,sans-serif" font-size="11" text-anchor="middle"><text x="${width / 2}" y="14">${label}</text><text x="${width + 32.5}" y="14">${value}</text></g></svg>\n`
}
