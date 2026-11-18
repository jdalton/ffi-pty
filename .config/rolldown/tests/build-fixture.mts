import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
export async function build(code, plugins, options = {}) {
  const source = process.env.VOWEN_ROLLDOWN_MODULE
  const { rolldown } = require(source || 'rolldown')
  const bundle = await rolldown({
    input: 'fixture:entry',
    ...options,
    plugins: [
      {
        name: 'fixture',
        resolveId: id => (id === 'fixture:entry' ? id : null),
        load: id => (id === 'fixture:entry' ? code : null),
      },
      ...plugins,
    ],
  })
  try {
    return await bundle.generate({ format: 'esm' })
  } finally {
    await bundle.close()
  }
}
