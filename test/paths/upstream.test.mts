import assert from 'node:assert/strict'
import { test } from 'node:test'
import { join } from 'node:path'
import {
  upstreamPaths,
  upstreamRepository,
  upstreamRelative,
} from '../../paths/upstream.mts'
import { repositoryRoot } from '../../paths/repository.mts'
test('upstream checkout and committed fixture paths share a root but remain separate', () => {
  assert.equal(upstreamRepository, 'https://github.com/microsoft/node-pty.git')
  assert.equal(upstreamRelative, 'upstream/node-pty')
  for (const root of ['fixture', repositoryRoot]) {
    assert.deepEqual(upstreamPaths(root), {
      checkout: join(root, upstreamRelative),
      fixtures: join(root, 'test/upstream/node-pty'),
      inventory: join(root, 'test/upstream/node-pty/inventory.json'),
    })
  }
  assert.deepEqual(upstreamPaths(), upstreamPaths(repositoryRoot))
})
