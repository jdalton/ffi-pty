import test from 'node:test'
import assert from 'node:assert/strict'
import { outputPolicy } from '../plugins/output-policy.mjs'
import { build } from './build-fixture.mts'
test('output budgets and forbidden emitted imports stop a real build', async () => {
  await build(`console.log('ok')`,[outputPolicy({maxBytes:1000,maxChunks:1})])
  await assert.rejects(build(`console.log('ok')`,[outputPolicy({maxBytes:1})]),/byte budget exceeded/)
  await assert.rejects(build(`import fs from 'node:fs';console.log(fs)`,[outputPolicy({forbidImports:['node:fs']})],{external:['node:fs']}),/Forbidden emitted import/)
})
