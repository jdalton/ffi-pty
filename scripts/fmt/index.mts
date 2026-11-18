import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runCommands } from '../commands.mts'

export function runFmt(execute = runCommands) {
  execute([
    [
      'exec',
      'oxfmt',
      '--config',
      '.config/oxfmtrc.json',
      'src',
      'test',
      'scripts',
      'paths',
      'package.json',
      'README.md',
      '.github',
    ],
  ])
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  runFmt()
}
