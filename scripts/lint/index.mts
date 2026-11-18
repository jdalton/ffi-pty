import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runCommands } from '../commands.mts'

export function runLint(execute = runCommands) {
  execute([
    ['exec', 'oxlint', '--deny-warnings', 'src', 'test', 'scripts', 'paths'],
  ])
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  runLint()
}
