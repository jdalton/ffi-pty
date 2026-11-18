import assert from 'node:assert/strict'
import { test } from 'node:test'
import { join } from 'node:path'
import { conptyPaths } from '../../paths/conpty.mts'
import { repositoryRoot } from '../../paths/repository.mts'
test('ConPTY metadata and asset paths resolve from an explicit or repository root', () => {
  for (const root of ['fixture', repositoryRoot]) {
    assert.deepEqual(conptyPaths(root), {
      metadata: join(root, '.config/external-tools.json'),
      assets: join(root, 'assets/conpty'),
    })
  }
  assert.deepEqual(conptyPaths(), conptyPaths(repositoryRoot))
})
