// Adapted from node-pty's MIT-licensed eventEmitter2.test.ts.
import assert from 'node:assert/strict'
import { upstreamTest } from '../suite.mts'
import { mockTerminal } from '../mock-terminal.mts'

upstreamTest('eventEmitter2', 1, {}, async t => {
  const { term } = mockTerminal()
  t.after(() => term.close())
  const order: string[] = []
  term.onData(data => order.push(data + 'a'))
  term.onData(data => order.push(data + 'b'))
  term.emit('data', '1')
  term.emit('data', '2')
  assert.deepEqual(order, ['1a', '1b', '2a', '2b'])
})
upstreamTest('eventEmitter2', 2, {}, async t => {
  const { term } = mockTerminal()
  t.after(() => term.close())
  const order: string[] = []
  term.onData(data => order.push(data + 'a'))
  const b = term.onData(data => order.push(data + 'b'))
  term.onData(data => order.push(data + 'c'))
  term.emit('data', '1')
  b.dispose()
  term.emit('data', '2')
  assert.deepEqual(order, ['1a', '1b', '1c', '2a', '2c'])
})
