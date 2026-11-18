import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runCommands } from '../commands.mts'

export function runUpdate(execute = runCommands) {
  execute([
    ['exec', 'node', 'scripts/update/conpty.mts'],
    ['exec', 'node', 'scripts/update/upstream.mts'],
    ['run', 'test:build'],
  ])
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  runUpdate()
}
