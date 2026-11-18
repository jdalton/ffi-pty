import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  moduleIssues,
  packageIssues,
  checkPolicies,
} from '../../../scripts/check/policy.mts'

test('source policy catches nested dynamic imports without mistaking comments or strings for code', () => {
  assert.equal(
    moduleIssues(
      'example.mts',
      'export async function load() { return import("x") }',
    ).length,
    1,
  )
  assert.deepEqual(
    moduleIssues(
      'example.mts',
      '// import("x")\nexport const text = \'import("x")\'',
    ),
    [],
  )
  assert.deepEqual(
    moduleIssues('example.mts', 'export const load = () => require("x")'),
    [],
  )
})

test('source policy counts the final newline correctly at the module boundary', () => {
  assert.deepEqual(moduleIssues('example.cpp', '\n'.repeat(500)), [])
  assert.equal(moduleIssues('example.cpp', '\n'.repeat(501)).length, 1)
})

test('package policy rejects runtime dependencies and floating tool versions', () => {
  assert.deepEqual(
    packageIssues({
      devDependencies: { tool: '1.2.3-beta.1' },
      packageManager: 'pnpm@12.12.0',
    }),
    [],
  )
  assert.equal(
    packageIssues({
      optionalDependencies: { tool: '1.2.3' },
      devDependencies: { compiler: '^1.2.3' },
      packageManager: 'npm@12.0.0',
    }).length,
    3,
  )
})

test('source policy reports malformed TypeScript instead of accepting unparsed code', () => {
  assert.ok(
    moduleIssues('broken.mts', 'export const = ;').some(issue =>
      issue.includes('cannot parse'),
    ),
  )
})

test('repository policy reports source and manifest violations together', () => {
  const root = mkdtempSync(join(tmpdir(), 'ffi-policy-'))
  try {
    mkdirSync(join(root, 'src'))
    mkdirSync(join(root, 'scripts'))
    mkdirSync(join(root, 'paths'))
    writeFileSync(join(root, 'package.json'), '{}')
    writeFileSync(join(root, 'scripts/broken.mts'), 'export const = ;')
    assert.throws(
      () => checkPolicies(root),
      error =>
        error instanceof Error &&
        error.message.includes('Pin the pnpm') &&
        error.message.includes('cannot parse'),
    )
    assert.deepEqual(packageIssues({ packageManager: 'pnpm@12.12.0' }), [])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
