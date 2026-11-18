import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  coverageBadge,
  coverageFailures,
  mergeReceipts,
  sourceSnapshot,
  type CoverageReceipt,
} from './accumulate.mts'

export function gateCoverage(root: string, planPath: string, threshold = 98) {
  const plan = JSON.parse(readFileSync(planPath, 'utf8')) as {
    receipts: string[]
    expected: string[]
  }
  if (
    !Array.isArray(plan.receipts) ||
    !plan.receipts.length ||
    !Array.isArray(plan.expected) ||
    !plan.expected.length
  )
    throw new Error(
      'Coverage plan must list receipts and expected run/suite/shard identities',
    )
  const receipts = plan.receipts.map(
    file =>
      JSON.parse(readFileSync(resolve(root, file), 'utf8')) as CoverageReceipt,
  )
  const result = mergeReceipts(receipts, plan.expected)
  const current = sourceSnapshot(root, Object.keys(receipts[0]!.sources))
  if (JSON.stringify(current) !== JSON.stringify(receipts[0]!.sources))
    throw new Error('Coverage evidence does not match current sources')
  const output = resolve(
    root,
    '.cache/coverage',
    `${result.platform}-${result.arch}`,
    'combined',
  )
  mkdirSync(output, { recursive: true })
  writeFileSync(
    resolve(output, 'coverage-final.json'),
    JSON.stringify(result.report) + '\n',
  )
  writeFileSync(
    resolve(output, 'coverage-summary.json'),
    JSON.stringify({ total: result.total, runs: result.runs }) + '\n',
  )
  for (const metric of ['lines', 'branches']) {
    const percent = result.total[metric].total
      ? (result.total[metric].covered / result.total[metric].total) * 100
      : 100
    writeFileSync(
      resolve(output, `${metric}.svg`),
      coverageBadge(`${result.platform} ${metric}`, percent),
    )
  }
  return coverageFailures(result.total, threshold)
}

export function gateMain(args: string[]): number {
  if (args.length !== 1) throw new Error('Usage: coverage gate <plan.json>')
  const root = process.cwd()
  const config = JSON.parse(
    readFileSync(resolve(root, '.config/coverage.json'), 'utf8'),
  )
  const failures = gateCoverage(root, resolve(args[0]!), config.threshold)
  for (const failure of failures) console.error(failure)
  return failures.length ? 1 : 0
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  process.exitCode = gateMain(process.argv.slice(2))
