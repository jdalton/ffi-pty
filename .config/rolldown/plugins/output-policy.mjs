// Check the emitted graph, after tree shaking, rather than source imports.
export function outputPolicy({ maxBytes, maxChunks, forbidImports = [] } = {}) {
  for (const [name, value] of Object.entries({ maxBytes, maxChunks })) if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) throw new Error(`Invalid ${name}`)
  return {
    name: 'vowen-output-policy',
    generateBundle(options, bundle) {
      const chunks = Object.values(bundle).filter(item => item.type === 'chunk')
      if (maxChunks !== undefined && chunks.length > maxChunks) this.error(`Chunk budget exceeded: ${chunks.length} > ${maxChunks}`)
      const bytes = chunks.reduce((sum, chunk) => sum + Buffer.byteLength(chunk.code), 0)
      if (maxBytes !== undefined && bytes > maxBytes) this.error(`JavaScript byte budget exceeded: ${bytes} > ${maxBytes}`)
      for (const chunk of chunks) for (const specifier of [...chunk.imports, ...chunk.dynamicImports]) {
        if (forbidImports.includes(specifier)) this.error(`Forbidden emitted import: ${specifier}`)
      }
    },
  }
}
