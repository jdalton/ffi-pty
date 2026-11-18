import test from 'node:test'
import assert from 'node:assert/strict'
import { buildReport } from '../plugins/build-report.mjs'
import { build } from './build-fixture.mts'
test('build reports describe actual emitted chunks', async () => {
  const {output}=await build(`console.log('ok')`,[buildReport()])
  const chunk=output.find(x=>x.type==='chunk'), report=JSON.parse(output.find(x=>x.fileName==='vowen-build-report.json').source)
  assert.equal(report.chunks[0].fileName,chunk.fileName)
  assert.equal(report.chunks[0].bytes,Buffer.byteLength(chunk.code))
})
