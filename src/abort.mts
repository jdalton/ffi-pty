export function abortReason(signal: AbortSignal): unknown {
  return (
    signal.reason ?? new DOMException('The operation was aborted', 'AbortError')
  )
}

export function validateAbortSignal(
  value: unknown,
): asserts value is AbortSignal {
  if (
    value !== undefined &&
    (!value ||
      typeof value !== 'object' ||
      typeof (value as AbortSignal).addEventListener !== 'function' ||
      typeof (value as AbortSignal).removeEventListener !== 'function' ||
      typeof (value as AbortSignal).aborted !== 'boolean')
  ) {
    throw new TypeError('signal must be an AbortSignal')
  }
}

export function bindAbortSignal(
  signal: AbortSignal | undefined,
  close: () => Promise<void>,
  done: Promise<unknown>,
): void {
  if (!signal) return
  let active = true
  const onAbort = () => {
    if (active) void close().catch(() => {})
  }
  const cleanup = () => {
    if (!active) return
    active = false
    signal.removeEventListener('abort', onAbort)
  }
  if (signal.aborted) onAbort()
  else signal.addEventListener('abort', onAbort, { once: true })
  void done.then(cleanup, cleanup)
}
