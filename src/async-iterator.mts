export interface DataSubscription {
  dispose(): void
}

export function createDataIterator<T>(
  subscribe: (listener: (chunk: T) => void) => DataSubscription,
  done: Promise<unknown>,
): AsyncIterableIterator<T> {
  const queue: T[] = []
  let wake: (() => void) | undefined
  let settled = false
  let failed = false
  let failure: unknown
  const notify = () => {
    wake?.()
    wake = undefined
  }
  const subscription = subscribe(chunk => {
    queue.push(chunk)
    notify()
  })
  void done.then(
    () => {
      settled = true
      notify()
    },
    error => {
      failed = true
      failure = error
      settled = true
      notify()
    },
  )
  return {
    async next() {
      while (!queue.length && !settled) {
        await new Promise<void>(resolve => {
          wake = resolve
        })
      }
      if (queue.length) return { value: queue.shift()!, done: false }
      subscription.dispose()
      if (failed) throw failure
      return { value: undefined, done: true }
    },
    async return() {
      subscription.dispose()
      settled = true
      notify()
      return { value: undefined, done: true }
    },
    [Symbol.asyncIterator]() {
      return this
    },
  }
}
