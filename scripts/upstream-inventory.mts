import { createHash } from 'node:crypto'
import { globSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseSync } from 'rolldown/utils'

export interface UpstreamCase {
  id: string
  file: string
  title: string
  line: number
}
export interface UpstreamFile {
  file: string
  sha256: string
  cases: UpstreamCase[]
}
export interface AstNode {
  type?: string
  name?: string
  value?: unknown
  start?: number
  callee?: AstNode
  property?: AstNode
  arguments?: AstNode[]
  elements?: AstNode[]
  [key: string]: unknown
}
export function visitAst(value: unknown, visit: (node: AstNode) => void): void {
  if (!value || typeof value !== 'object') {
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      visitAst(item, visit)
    }
    return
  }
  const node = value as AstNode
  visit(node)
  for (const child of Object.values(node)) {
    visitAst(child, visit)
  }
}
export function parseUpstream(source: string): AstNode {
  const result = parseSync('upstream.ts', source)
  if (result.errors.length) {
    throw new Error('Cannot parse upstream tests')
  }
  return result.program as unknown as AstNode
}
export function isTestCall(node: AstNode): boolean {
  return (
    node.type === 'CallExpression' &&
    (node.callee?.name === 'it' ||
      (node.callee?.type === 'MemberExpression' &&
        (node.callee.object as AstNode)?.name === 'it'))
  )
}
export function literal(node: AstNode | undefined): string | string[] {
  if (node?.type === 'Literal' && typeof node.value === 'string') {
    return node.value
  }
  if (node?.type === 'ArrayExpression') {
    return node.elements!.map(item => {
      const value = literal(item)
      if (typeof value !== 'string') {
        throw new Error('Nested upstream argument array')
      }
      return value
    })
  }
  throw new Error('Nonliteral upstream assertion requires review')
}
export function inventorySource(file: string, source: string): UpstreamFile {
  const cases: UpstreamCase[] = []
  visitAst(parseUpstream(source), node => {
    if (!isTestCall(node)) {
      return
    }
    const title = literal(node.arguments?.[0])
    if (typeof title !== 'string') {
      throw new Error('Nonliteral upstream test title')
    }
    cases.push({
      id: `${file}#${cases.length + 1}`,
      file,
      title,
      line: source.slice(0, node.start).split('\n').length,
    })
  })
  return {
    file,
    sha256: createHash('sha256').update(source).digest('hex'),
    cases,
  }
}
export function inventoryUpstream(checkout: string): UpstreamFile[] {
  return [...globSync('src/**/*.test.ts', { cwd: checkout })]
    .toSorted()
    .map(file =>
      inventorySource(
        file.replaceAll('\\', '/'),
        readFileSync(join(checkout, file), 'utf8'),
      ),
    )
}
export interface QuotingCase {
  title: string
  file: string
  args: string[] | string
  expected: string
}
export function extractQuotingCases(source: string): QuotingCase[] {
  const cases: QuotingCase[] = []
  visitAst(parseUpstream(source), node => {
    if (!isTestCall(node)) {
      return
    }
    const title = literal(node.arguments?.[0])
    if (typeof title !== 'string') {
      throw new Error('Nonliteral test title')
    }
    visitAst(node.arguments?.[1], assertion => {
      if (
        assertion.type !== 'CallExpression' ||
        assertion.callee?.name !== 'check'
      ) {
        return
      }
      const [file, args, expected] = assertion.arguments!.map(literal)
      if (typeof file !== 'string' || typeof expected !== 'string') {
        throw new Error('Invalid command-line assertion')
      }
      cases.push({ title, file, args, expected })
    })
  })
  if (!cases.length) {
    throw new Error('Upstream command-line suite changed')
  }
  return cases
}
