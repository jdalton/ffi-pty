import assert from 'node:assert/strict'
import type { execFileSync } from 'node:child_process'
import {
  mkdirSync,
  writeFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { prepareUpstream } from '../../scripts/upstream-checkout.mts'

for (const state of ['initialized', 'absent', 'deinitialized'] as const) {
  test(`explicit sync reuses the pinned revision with an ${state} checkout without fetching`, () => {
    const root = mkdtempSync(join(tmpdir(), 'upstream-'))
    const calls: string[][] = []
    const revision = 'a'.repeat(40)
    const execute = ((_file: string, args: string[]) => {
      calls.push(args)
      if (args[0] === 'ls-files') {
        return `160000 ${revision} 0\tupstream/node-pty`
      }
      if (args[0] === 'rev-parse') {
        return '.git/modules/upstream/node-pty'
      }
      return ''
    }) as typeof execFileSync
    try {
      const exists = (path: Parameters<typeof readFileSync>[0]) => {
        const value = String(path).replaceAll('\\', '/')
        return state === 'initialized'
          ? value.endsWith('node-pty/.git')
          : state === 'deinitialized' &&
              value.endsWith('modules/upstream/node-pty')
      }
      assert.equal(prepareUpstream(root, execute, exists), revision)
      assert.equal(
        calls.some(args => args[0] === 'fetch'),
        false,
      )
      assert.equal(
        calls.some(args => args[0] === 'clone'),
        state === 'absent',
      )
      assert.ok(
        calls.some(
          args =>
            args.join(' ') ===
            'sparse-checkout set --cone src typings fixtures',
        ),
      )
      if (state === 'deinitialized') {
        assert.match(
          readFileSync(join(root, 'upstream/node-pty/.git'), 'utf8'),
          /^gitdir: /,
        )
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
}

test('install, setup and normal test commands do not call upstream synchronization', () => {
  const root = new URL('../../', import.meta.url)
  const { scripts } = JSON.parse(
    readFileSync(new URL('package.json', root), 'utf8'),
  )
  assert.equal(scripts['upstream:sync'], 'node scripts/sync-upstream.mts')
  for (const [name, command] of Object.entries(scripts)) {
    if (name !== 'upstream:sync') {
      assert.doesNotMatch(
        String(command),
        /sync-upstream|upstream-checkout|submodule.*init/,
      )
    }
  }
  for (const file of ['scripts/setup.mts', 'scripts/test.mts']) {
    assert.doesNotMatch(
      readFileSync(new URL(file, root), 'utf8'),
      /sync-upstream|upstream-checkout|submodule.*init/,
    )
  }
  assert.match(
    readFileSync(new URL('.gitmodules', root), 'utf8'),
    /update = none/,
  )
})

test('sync rejects missing pins and dirty checkouts before replacing files', () => {
  const root = mkdtempSync(join(tmpdir(), 'upstream-dirty-'))
  try {
    assert.throws(
      () => prepareUpstream(root, (() => '') as never),
      /pinned submodule/,
    )
    const execute = ((_command, args) => {
      if (args[0] === 'ls-files') {
        return `160000 ${'a'.repeat(40)} 0\tupstream/node-pty`
      }
      if (args[0] === 'status') {
        return ' M src/test.ts'
      }
      return ''
    }) as typeof execFileSync
    assert.throws(
      () => prepareUpstream(root, execute, () => true),
      /local changes/,
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('sync fetches a missing pinned commit before checking it out', () => {
  const calls: string[][] = []
  const revision = 'b'.repeat(40)
  const execute = ((_command, args) => {
    calls.push(args)
    if (args[0] === 'ls-files') {
      return `160000 ${revision} 0\tupstream/node-pty`
    }
    if (args[0] === 'cat-file') {
      throw new Error('missing commit')
    }
    return ''
  }) as typeof execFileSync
  assert.equal(
    prepareUpstream(process.cwd(), execute, () => true),
    revision,
  )
  const fetch = calls.findIndex(args => args[0] === 'fetch')
  assert.ok(fetch >= 0)
  assert.equal(calls[fetch].at(-1), revision)
  assert.equal(calls[fetch + 1][0], 'checkout')
})

test('sync preserves untracked files in an uninitialized checkout', () => {
  const root = mkdtempSync(join(tmpdir(), 'upstream-untracked-'))
  try {
    mkdirSync(join(root, 'upstream/node-pty'), { recursive: true })
    const file = join(root, 'upstream/node-pty/notes.txt')
    writeFileSync(file, 'keep this')
    const execute = ((_command, args) =>
      args[0] === 'ls-files'
        ? `160000 ${'a'.repeat(40)} 0\tupstream/node-pty`
        : '') as typeof execFileSync
    assert.throws(() => prepareUpstream(root, execute), /untracked files/)
    assert.equal(readFileSync(file, 'utf8'), 'keep this')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
