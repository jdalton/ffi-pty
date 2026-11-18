import assert from 'node:assert/strict'
import {
  cpSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  mkdirSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { test } from 'node:test'
import {
  runtimePaths,
  buildPackage,
  entries,
  entrySource,
} from '../../scripts/build.mts'

test('runtime paths target emitted modules and packaged native helpers', () => {
  assert.equal(runtimePaths("require('./linux.mts')"), "require('./linux.mjs')")
  assert.equal(
    runtimePaths('new URL(`../build/ffi-pty/win32-${arch}/helper.exe`)'),
    'new URL(`./bin/win32-${arch}/helper.exe`)',
  )
})

test(
  'bundled package spawns a real PTY without source files or node_modules',
  { timeout: 30_000 },
  () => {
    const directory = mkdtempSync(join(tmpdir(), 'ffi-pty-dist-'))
    try {
      cpSync(resolve('dist'), directory, { recursive: true })
      const entry = join(directory, 'index.mjs')
      const code = `const {spawnPty}=require(${JSON.stringify(entry)}); (async()=>{const p=await spawnPty(process.execPath,['-e', 'console.log(process.stdin.isTTY && process.stdout.isTTY ? "BUNDLE_PTY_OK" : "NO_TTY")']);p.onData(d=>process.stdout.write(d));try{const s=await p.exited;process.exitCode=s.exitCode;}finally{await p.close();}})().catch(e=>{console.error(e);process.exitCode=1})`
      const output = execFileSync(
        process.execPath,
        ['--experimental-ffi', '-e', code],
        { cwd: directory, encoding: 'utf8', timeout: 25_000 },
      )
      assert.match(output, /BUNDLE_PTY_OK/)
      for (const name of readdirSync(directory).filter(file =>
        file.endsWith('.mjs'),
      )) {
        assert.doesNotMatch(
          readFileSync(join(directory, name), 'utf8'),
          /\.\/[^'"`]*\.mts['"`]/,
        )
      }
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  },
)

test('distribution includes both supplied Windows helpers byte-for-byte', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ffi-package-fixture-'))
  try {
    mkdirSync(join(root, 'src'))
    for (const name of entries) {
      mkdirSync(resolve(root, entrySource(name), '..'), { recursive: true })
      writeFileSync(join(root, entrySource(name)), 'export const value = 1')
    }
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ name: 'fixture', version: '1.0.0' }),
    )
    for (const file of ['LICENSE', 'README.md']) {
      writeFileSync(join(root, file), file)
    }
    for (const arch of ['x64', 'arm64']) {
      const directory = join(root, 'build/ffi-pty', 'win32-' + arch)
      mkdirSync(directory, { recursive: true })
      writeFileSync(join(directory, 'helper.exe'), 'fixture-' + arch)
    }
    cpSync(resolve('assets/conpty'), join(root, 'assets/conpty'), {
      recursive: true,
    })
    mkdirSync(join(root, '.config'), { recursive: true })
    cpSync(
      resolve('.config/external-tools.json'),
      join(root, '.config/external-tools.json'),
    )
    await buildPackage(root)
    assert.deepEqual(
      readFileSync(join(root, 'dist/bin/conpty/x64/conpty.dll.br')),
      readFileSync(resolve('assets/conpty/x64/conpty.dll.br')),
    )
    for (const arch of ['x64', 'arm64']) {
      assert.equal(
        readFileSync(
          join(root, 'dist/bin', 'win32-' + arch, 'helper.exe'),
          'utf8',
        ),
        'fixture-' + arch,
      )
    }
    assert.equal(
      JSON.parse(readFileSync(join(root, 'dist/package.json'), 'utf8')).version,
      '1.0.0',
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('platform sources retain flat distribution entry names', () => {
  for (const [name, platform] of [
    ['darwin-bootstrap', 'darwin'],
    ['linux', 'linux'],
    ['windows-ffi-worker', 'win32'],
  ]) {
    assert.equal(entrySource(name), 'src/' + platform + '/' + name + '.mts')
    assert.equal(
      runtimePaths("require('./" + platform + '/' + name + ".mts')"),
      "require('./" + name + ".mjs')",
    )
  }
  assert.equal(entrySource('index'), 'src/index.mts')
  assert.equal(entrySource('pty'), 'src/pty.mts')
  assert.equal(
    runtimePaths("new URL('../../assets/conpty/', import.meta.url)"),
    "new URL('./bin/conpty/', import.meta.url)",
  )
  assert.equal(
    runtimePaths("new URL('../../build/ffi-pty/helper.exe', import.meta.url)"),
    "new URL('./bin/helper.exe', import.meta.url)",
  )
})
