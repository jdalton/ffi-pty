import assert from 'node:assert/strict'
import { test } from 'vitest'
import { createDataIterator } from '../../src/async-iterator.mts'

test('data iterator delivers queued chunks before ending', async () => {
  let emit!: (chunk: string) => void
  let finish!: () => void
  const done = new Promise<void>(resolve => {
    finish = resolve
  })
  const iterator = createDataIterator<string>(listener => {
    emit = listener
    return { dispose() {} }
  }, done)
  const pending = iterator.next()
  emit('first')
  assert.deepEqual(await pending, { value: 'first', done: false })
  emit('second')
  finish()
  assert.deepEqual(await iterator.next(), { value: 'second', done: false })
  assert.deepEqual(await iterator.next(), { value: undefined, done: true })
})

test('return disposes the data subscription', async () => {
  let disposed = false
  const iterator = createDataIterator<string>(
    () => ({ dispose: () => (disposed = true) }),
    new Promise(() => {}),
  )
  await iterator.return?.()
  assert.equal(disposed, true)
})
