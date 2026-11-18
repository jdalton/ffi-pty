import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { repositoryRoot } from '../paths/repository.mts'

const require = createRequire(import.meta.url)
export function buildTypes(
  root = repositoryRoot,
  execute = execFileSync,
): void {
  const directory = join(root, 'dist/types')
  execute(
    process.execPath,
    [
      join(dirname(require.resolve('typescript/package.json')), 'bin/tsc'),
      '--declaration',
      '--emitDeclarationOnly',
      '--noEmitOnError',
      '--exactOptionalPropertyTypes',
      '--module',
      'nodenext',
      '--target',
      'esnext',
      '--types',
      'node',
      '--typeRoots',
      dirname(dirname(require.resolve('@types/node/package.json'))),
      '--allowImportingTsExtensions',
      '--skipLibCheck',
      '--outDir',
      directory,
      join(root, 'src/index.mts'),
      join(root, 'src/compat-index.mts'),
    ],
    { cwd: root, stdio: 'pipe' },
  )
  for (const file of readdirSync(directory, { recursive: true })) {
    if (file.endsWith('.d.mts')) {
      const path = join(directory, file)
      writeFileSync(
        path,
        readFileSync(path, 'utf8').replaceAll(".mts'", ".mjs'"),
      )
    }
  }
}
