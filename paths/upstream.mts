import { join } from 'node:path'
import { repositoryRoot } from './repository.mts'
export const upstreamRepository = 'https://github.com/microsoft/node-pty.git'
export const upstreamRelative = 'upstream/node-pty'
export function upstreamPaths(root = repositoryRoot) {
  return {
    checkout: join(root, upstreamRelative),
    fixtures: join(root, 'test/upstream/node-pty'),
    inventory: join(root, 'test/upstream/node-pty/inventory.json'),
  }
}
