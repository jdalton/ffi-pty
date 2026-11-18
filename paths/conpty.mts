import { join } from 'node:path'
import { repositoryRoot } from './repository.mts'

export function conptyPaths(root = repositoryRoot) {
  return {
    metadata: join(root, '.config/external-tools.json'),
    assets: join(root, 'assets/conpty'),
  }
}
