import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { installHooks } from '../../scripts/setup.mts'

for (const existing of ['none', 'configured', 'installed']) {
  test(`hook installation preserves ${existing} existing configuration`, () => {
    const root = mkdtempSync(join(tmpdir(), 'ffi-hooks-'))
    // Hooks export Git variables that would redirect this temporary repository.
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')),
    )
    const run = ((command, args, options) =>
      spawnSync(command, args, { ...options, env })) as typeof spawnSync
    const git = (...args: string[]) =>
      execFileSync('git', args, { cwd: root, encoding: 'utf8', env }).trim()
    try {
      git('init', '--quiet')
      if (existing === 'configured') {
        git('config', 'core.hooksPath', 'custom-hooks')
      }
      if (existing === 'installed') {
        writeFileSync(join(root, '.git/hooks/pre-push'), 'custom hook')
      }
      if (existing !== 'none') {
        assert.throws(() => installHooks(root, run), /manual|manually/)
      } else {
        assert.equal(installHooks(root, run), true)
        assert.equal(installHooks(root, run), true)
        assert.equal(git('config', '--get', 'core.hooksPath'), '.githooks')
        const nested = join(root, 'nested')
        mkdirSync(nested)
        assert.equal(installHooks(nested, run), false)
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
}

for (const failure of ['config', 'locate', 'install']) {
  for (const stderr of ['', 'permission denied']) {
    test(`hook installation surfaces ${failure} errors ${stderr ? 'with' : 'without'} stderr`, () => {
      const root = mkdtempSync(join(tmpdir(), 'ffi-hooks-error-'))
      const run = (_command: string, args: string[]) => {
        const operation = args.includes('--show-toplevel')
          ? 'root'
          : args.includes('--get')
            ? 'config'
            : args.includes('--git-path')
              ? 'locate'
              : 'install'
        if (operation === failure) {
          return { status: 2, stdout: '', stderr }
        }
        return {
          status: operation === 'config' ? 1 : 0,
          stdout:
            operation === 'root'
              ? root
              : operation === 'config'
                ? ''
                : '.git/hooks',
          stderr: '',
        }
      }
      try {
        assert.throws(
          () => installHooks(root, run as never),
          /permission denied|Cannot/,
        )
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    })
  }
}
