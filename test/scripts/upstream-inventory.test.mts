import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  inventorySource,
  extractQuotingCases,
  literal,
  parseUpstream,
} from '../../scripts/upstream-inventory.mts'

test('upstream inventory parses real declarations, including skipped tests, without executing code', () => {
  const source = `// it('comment', () => {})\ndescribe('group',()=>{it('one',()=>{}); it.skip('two',()=>{})}); throw new Error('never execute')`
  const result = inventorySource('src/a.test.ts', source)
  assert.deepEqual(
    result.cases.map(entry => entry.title),
    ['one', 'two'],
  )
  assert.equal(result.cases[0].id, 'src/a.test.ts#1')
  assert.match(result.sha256, /^[a-f0-9]{64}$/)
  assert.throws(
    () => inventorySource('a', 'it(compute(),()=>{})'),
    /Nonliteral/,
  )
  assert.throws(() => parseUpstream('it('), /Cannot parse/)
})
test('upstream quoting extraction preserves every literal assertion without running suite code', () => {
  const rows = extractQuotingCases(
    `it('quotes',()=>{check('file', ['a b'], 'file "a b"'); check('f', '', 'f'); throw new Error('never execute')})`,
  )
  assert.equal(rows.length, 2)
  assert.deepEqual(rows[0], {
    title: 'quotes',
    file: 'file',
    args: ['a b'],
    expected: 'file "a b"',
  })
  assert.throws(() => extractQuotingCases('it("x",()=>{})'), /suite changed/)
  assert.throws(
    () => extractQuotingCases('it("x",()=>{check("x",run(),"x")})'),
    /Nonliteral/,
  )
  assert.throws(
    () =>
      literal({
        type: 'ArrayExpression',
        elements: [{ type: 'ArrayExpression', elements: [] }],
      }),
    /Nested/,
  )
})

test('upstream review rejects array titles and malformed quoting assertions', () => {
  assert.throws(() => inventorySource('bad', 'it([],()=>{})'), /test title/)
  assert.throws(() => extractQuotingCases('it([],()=>{})'), /test title/)
  for (const body of ['check([], [], "x")', 'check("x", [], [])']) {
    assert.throws(
      () => extractQuotingCases(`it('bad',()=>{${body}})`),
      /Invalid command-line/,
    )
  }
})
