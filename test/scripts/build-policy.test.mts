import assert from 'node:assert/strict'
import { test } from 'node:test'
import { rolldown } from 'rolldown'
import {
  readableDistribution,
  distributionManifest,
} from '../../scripts/build-policy.mts'

export async function generate(code: string, minify: boolean | undefined) {
  const bundle = await rolldown({
    input: 'fixture',
    external: ['node:fs', 'unexpected-dependency'],
    plugins: [
      {
        name: 'fixture',
        buildStart() {
          this.emitFile({
            type: 'asset',
            fileName: 'notice.txt',
            source: 'fixture',
          })
        },
        resolveId: id => (id === 'fixture' ? id : null),
        load: id => (id === 'fixture' ? code : null),
      },
      readableDistribution(),
    ],
  })
  try {
    return await bundle.generate({ format: 'esm', minify })
  } finally {
    await bundle.close()
  }
}

test('distribution rejects enabled or implicit minification', async () => {
  for (const setting of [true, undefined]) {
    await assert.rejects(
      generate('export const value = 1', setting),
      /disable minification/,
    )
  }
})

test('distribution permits Node built-ins and rejects external runtime packages', async () => {
  const result = await generate("export { readFileSync } from 'node:fs'", false)
  assert.equal(result.output.length, 2)
  await assert.rejects(
    generate("export { value } from 'unexpected-dependency'", false),
    /Unexpected runtime dependency/,
  )
})

test('release manifest omits repository hooks, build scripts and development dependencies (#926, #972)', () => {
  const manifest = distributionManifest({
    name: 'ffi-pty',
    version: '0.0.0',
    private: true,
    scripts: { prepare: 'install-hooks', install: 'build-native' },
    devDependencies: { c8: '12.0.0' },
    dependencies: { forbidden: '1.0.0' },
  })
  assert.equal(manifest.main, './index.mjs')
  assert.deepEqual(manifest.exports['./compat'], {
    types: './types/compat-index.d.mts',
    default: './compat.mjs',
  })
  assert.deepEqual(manifest.exports['./spawn'], {
    types: './types/pty.d.mts',
    default: './pty.mjs',
  })
  assert.deepEqual(manifest.exports['./open'], {
    types: './types/unix-open.d.mts',
    default: './unix-open.mjs',
  })
  for (const key of [
    'scripts',
    'private',
    'devDependencies',
    'dependencies',
    'packageManager',
  ]) {
    assert.equal(Object.hasOwn(manifest, key), false)
  }
})
