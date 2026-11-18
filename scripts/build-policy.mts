import type { Plugin } from 'rolldown'

export function readableDistribution(): Plugin {
  return {
    name: 'ffi-pty-readable-distribution',
    outputOptions(options) {
      if (options.minify !== false) {
        throw new Error(
          'Distribution output must explicitly disable minification.',
        )
      }
      return null
    },
    generateBundle(_options, bundle) {
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk') {
          continue
        }
        for (const dependency of [...chunk.imports, ...chunk.dynamicImports]) {
          if (!dependency.startsWith('node:') && !(dependency in bundle)) {
            throw new Error(`Unexpected runtime dependency: ${dependency}`)
          }
        }
      }
    },
  }
}

export function distributionManifest(source: Record<string, unknown>) {
  return {
    name: source.name,
    version: source.version,
    description: source.description,
    license: source.license ?? 'MIT',
    type: 'module',
    main: './index.mjs',
    types: './types/index.d.mts',
    exports: {
      '.': { types: './types/index.d.mts', default: './index.mjs' },
      './compat': {
        types: './types/compat-index.d.mts',
        default: './compat.mjs',
      },
      './spawn': { types: './types/pty.d.mts', default: './pty.mjs' },
      './open': {
        types: './types/unix-open.d.mts',
        default: './unix-open.mjs',
      },
    },
    engines: source.engines,
    files: ['*.mjs', 'types/**', 'bin/**', 'LICENSE', 'README.md'],
  }
}
