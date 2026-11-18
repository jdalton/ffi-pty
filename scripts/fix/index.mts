import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runCommands } from '../commands.mts'

export function runFix(execute = runCommands) {
  execute([
    ['exec', 'oxlint', '--fix', 'src', 'test', 'scripts', 'paths'],
    ['run', 'format'],
  ])
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  runFix()
}
