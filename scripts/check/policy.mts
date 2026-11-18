import { repositoryRoot } from '../../paths/repository.mts'
import { readdirSync, readFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseSync } from 'rolldown/utils'

export function hasDynamicImport(value: unknown): boolean {
  if (!value || typeof value !== 'object') {
    return false
  }
  if (Array.isArray(value)) {
    return value.some(hasDynamicImport)
  }
  const node = value as Record<string, unknown>
  return (
    node.type === 'ImportExpression' ||
    Object.values(node).some(hasDynamicImport)
  )
}

export function moduleIssues(file: string, source: string): string[] {
  const issues: string[] = []
  const lines = source.split(/\r?\n/).length - Number(source.endsWith('\n'))
  if (lines > 500) {
    issues.push(`${file}: ${lines} lines exceeds the 500-line limit`)
  }
  if (file.endsWith('.mts')) {
    const result = parseSync(file, source)
    if (result.errors.length) {
      issues.push(`${file}: cannot parse source`)
    }
    if (hasDynamicImport(result.program)) {
      issues.push(`${file}: use synchronous require instead of dynamic import`)
    }
  }
  return issues
}

export function packageIssues(manifest: {
  dependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  packageManager?: string
}) {
  const issues: string[] = []
  if (
    Object.keys(manifest.dependencies ?? {}).length ||
    Object.keys(manifest.optionalDependencies ?? {}).length
  ) {
    issues.push('Runtime dependencies must remain zero')
  }
  for (const [name, version] of Object.entries(
    manifest.devDependencies ?? {},
  )) {
    if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version)) {
      issues.push(`${name}: pin an exact development version`)
    }
  }
  if (!/^pnpm@\d+\.\d+\.\d+$/.test(manifest.packageManager ?? '')) {
    issues.push('Pin the pnpm package manager')
  }
  return issues
}

export function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = join(directory, entry.name)
    if (entry.isDirectory()) {
      return sourceFiles(file)
    }
    return /\.(mts|cpp|h)$/.test(entry.name) ? [file] : []
  })
}

export function checkPolicies(root = repositoryRoot) {
  const issues = packageIssues(
    JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')),
  )
  for (const directory of ['src', 'scripts', 'paths']) {
    for (const file of sourceFiles(join(root, directory))) {
      issues.push(...moduleIssues(file, readFileSync(file, 'utf8')))
    }
  }
  if (issues.length) {
    throw new Error(issues.join('\n'))
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  checkPolicies()
}
