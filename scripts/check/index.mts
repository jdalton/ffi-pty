import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runCommands } from '../commands.mts'

export function runCheck(execute = runCommands) {
  execute([
    ['run', 'check:policy'],
    ['exec', 'node', 'scripts/check/upstream.mts'],
    ['run', 'format:check'],
    ['run', 'lint'],
    ['run', 'test:all'],
    ['run', 'test:build'],
  ])
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  runCheck()
}
