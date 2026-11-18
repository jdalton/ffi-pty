import { buildTypes } from './build-types.mts'
import { verifyConptyAssets } from './check/conpty.mts'
import { repositoryRoot } from '../paths/repository.mts'
import { readableDistribution, distributionManifest } from './build-policy.mts'
import {
  cpSync,
  existsSync,
  mkdirSync,
  rmSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'rolldown'
import { outputPolicy } from '../.config/rolldown/plugins/output-policy.mjs'
import { buildReport } from '../.config/rolldown/plugins/build-report.mjs'

export const entries = [
  'index',
  'compat',
  'pty',
  'unix-open',
  'darwin',
  'linux',
  'windows',
  'darwin-bootstrap',
  'linux-bootstrap',
  'windows-broker',
  'windows-broker-client',
  'windows-helper',
  'windows-ffi',
  'windows-ffi-worker',
  'windows-cache-compression',
  'windows-compat-worker',
]

export function entrySource(name: string): string {
  if (name === 'compat') {
    return 'src/compat-index.mts'
  }
  const platform = name.startsWith('darwin')
    ? 'darwin'
    : name.startsWith('linux')
      ? 'linux'
      : name.startsWith('windows')
        ? 'win32'
        : ''
  return ['src', platform, name + '.mts'].filter(Boolean).join('/')
}

export function runtimePaths(code: string): string {
  // Static imports have already been bundled. These are runtime require/worker
  // paths; keeping all entry points and chunks together preserves import.meta.url.
  return code
    .replace(
      /['"`]\.{1,2}\/(?:[\w.-]+\/)*([\w-]+)\.mts['"`]/g,
      (match, name) => match[0] + './' + name + '.mjs' + match[0],
    )
    .replace(/(?:\.\.\/)+build\/ffi-pty\//g, './bin/')
    .replace(/(?:\.\.\/)+assets\/conpty\//g, './bin/conpty/')
}

export async function buildPackage(root = repositoryRoot) {
  verifyConptyAssets(root)
  const dist = resolve(root, 'dist')
  rmSync(dist, { recursive: true, force: true })
  await build({
    cwd: root,
    input: Object.fromEntries(entries.map(name => [name, entrySource(name)])),
    platform: 'node',
    external: /^node:/,
    plugins: [
      readableDistribution(),
      {
        name: 'runtime-paths',
        renderChunk: code => ({ code: runtimePaths(code), map: null }),
      },
      outputPolicy({ maxBytes: 160_000, maxChunks: 30 }),
      buildReport(),
    ],
    output: {
      dir: dist,
      format: 'esm',
      entryFileNames: '[name].mjs',
      chunkFileNames: 'shared-[hash].mjs',
      minify: false,
      sourcemap: false,
    },
  })
  buildTypes(root)
  writeFileSync(
    resolve(dist, 'package.json'),
    JSON.stringify(
      distributionManifest(
        JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')),
      ),
      null,
      2,
    ) + '\n',
  )
  for (const file of ['LICENSE', 'README.md']) {
    cpSync(resolve(root, file), resolve(dist, file))
  }
  cpSync(resolve(root, 'assets/conpty'), resolve(dist, 'bin/conpty'), {
    recursive: true,
  })
  for (const arch of ['x64', 'arm64']) {
    const source = resolve(root, `build/ffi-pty/win32-${arch}/helper.exe`)
    if (existsSync(source)) {
      const target = resolve(dist, `bin/win32-${arch}`)
      mkdirSync(target, { recursive: true })
      cpSync(source, resolve(target, 'helper.exe'))
    }
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await buildPackage()
}
