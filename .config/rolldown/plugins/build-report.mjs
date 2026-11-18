export function buildReport({ fileName = 'vowen-build-report.json' } = {}) {
  return {
    name: 'vowen-build-report',
    generateBundle(options, bundle) {
      const chunks = Object.values(bundle).filter(item => item.type === 'chunk').map(chunk => ({
        fileName: chunk.fileName, bytes: Buffer.byteLength(chunk.code), imports: chunk.imports, dynamicImports: chunk.dynamicImports,
        modules: Object.entries(chunk.modules).map(([id, info]) => ({ id, renderedBytes: info.renderedLength, renderedExports: info.renderedExports ?? [], removedExports: info.removedExports ?? [] })),
      }))
      this.emitFile({ type: 'asset', fileName, source: JSON.stringify({ schemaVersion: 1, chunks }, null, 2) + '\n' })
    },
  }
}
