/* oxlint-disable unicorn/require-post-message-target-origin -- Node worker_threads has no targetOrigin. */
import type {
  CompatibilityReply,
  CompatibilityRequest,
} from './windows-compat-protocol.mts'
import { Worker } from 'node:worker_threads'
import { PassThrough } from 'node:stream'
import { setImmediate } from 'node:timers'
import { helperStartupEnv } from './windows-helper.mts'
import type { CompatibleBackend } from '../compat-terminal.mts'
import type { SpawnOptions, ExitStatus } from '../contract.mts'

export interface CompatibilityWorker {
  on(event: 'message', callback: (message: CompatibilityReply) => void): unknown
  on(event: 'error', callback: (error: Error) => void): unknown
  on(event: 'exit', callback: (code: number) => void): unknown
  postMessage(value: CompatibilityRequest): void
  terminate(): Promise<number>
}
export function startCompatibilityWorker(
  options: SpawnOptions,
): CompatibilityWorker {
  return new Worker(new URL('./windows-compat-worker.mts', import.meta.url), {
    workerData: { kind: 'compat', options },
    execArgv: ['--experimental-ffi'],
    env: helperStartupEnv(process.env),
  })
}
/**
 * Blocking HWND requests must not block the thread that connects ConPTY's
 * pipes. Keep startup and IPC in a worker so synchronous calls can await the
 * actual native result, including calls made immediately after spawn().
 */
export function createWindowsCompatibilityBackend(
  options: SpawnOptions,
  worker = startCompatibilityWorker(options),
  startupTimeoutMs = 15_000,
): CompatibleBackend {
  const readable = new PassThrough({ highWaterMark: 64 * 1024 })
  let pid = 0,
    serial = 0,
    finished = false,
    closed = false
  let started = false
  let failed: Error | undefined
  let resolveReady!: () => void, rejectReady!: (error: Error) => void
  let resolveExit!: (status: ExitStatus) => void,
    rejectExit!: (error: Error) => void
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve
    rejectReady = reject
  })
  const exited = new Promise<ExitStatus>((resolve, reject) => {
    resolveExit = resolve
    rejectExit = reject
  })
  void ready.catch(() => {})
  void exited.catch(() => {})
  const pending = new Map<
    number,
    { operation: string; resolve(): void; reject(error: Error): void }
  >()
  const fail = (error: Error) => {
    if (failed || finished || closed) return
    clearTimeout(startupTimer)
    failed = error
    rejectReady(error)
    rejectExit(error)
    for (const request of pending.values()) request.reject(error)
    pending.clear()
    readable.destroy(error)
    void worker.terminate()
  }
  readable.on('error', () => {})
  worker.on('error', fail)
  worker.on('exit', () => {
    if (finished || closed) {
      for (const request of pending.values()) {
        if (request.operation === 'close') request.resolve()
        else {
          request.reject(new Error('PTY exited before command acknowledgement'))
        }
      }
      pending.clear()
    }
    if (!finished && !closed) {
      fail(
        new Error('Windows compatibility worker exited before PTY completion'),
      )
    }
  })
  worker.on('message', message => {
    if (failed || closed) return
    if (message.type === 'ready') {
      clearTimeout(startupTimer)
      pid = message.pid
      resolveReady()
    } else if (message.type === 'data') {
      if (!readable.write(Buffer.from(message.data))) {
        worker.postMessage({ type: 'pause' })
      }
    } else if (message.type === 'end') readable.end()
    else if (message.type === 'exit') {
      finished = true
      resolveExit(message.status)
    } else if (message.type === 'error') fail(new Error(message.error))
    else if (message.type === 'ack') {
      const request = pending.get(message.id)
      pending.delete(message.id)
      if (message.error) request?.reject(new Error(message.error))
      else request?.resolve()
    }
  })
  readable.on('drain', () => worker.postMessage({ type: 'resume' }))
  // A same-turn setParentWindow request starts the worker with the HWND before
  // this ordinary start message, preserving node-pty's pre-launch owner setup.
  const startupTimer = setTimeout(
    () => fail(new Error('Timed out waiting for ConPTY output worker')),
    startupTimeoutMs,
  )
  setImmediate(() => {
    if (!closed && !failed) {
      started = true
      worker.postMessage({ type: 'start' })
    }
  })
  const command = (operation: string, args: unknown[] = []) =>
    new Promise<void>((resolve, reject) => {
      if (failed) {
        reject(failed)
        return
      }
      if (finished || closed) {
        resolve()
        return
      }
      const id = ++serial
      pending.set(id, { operation, resolve, reject })
      worker.postMessage({ type: 'command', id, operation, args })
    })
  let cleanup: Promise<void> | undefined
  return {
    get pid() {
      return pid
    },
    ready,
    readable,
    exited,
    write: data => command('write', [data]),
    resize: (cols, rows) => command('resize', [cols, rows]),
    kill: async signal => {
      if (!started && !failed) {
        closed = true
        finished = true
        clearTimeout(startupTimer)
        resolveReady()
        readable.end()
        resolveExit({ exitCode: 0, signal: 0 })
        await worker.terminate()
      } else await command('kill', [signal])
    },
    clear: () => command('clear'),
    setParentWindow(handle) {
      if (finished || closed || !options.conptyDll) return false
      const response = new Int32Array(new SharedArrayBuffer(8))
      worker.postMessage({
        type: 'parent',
        handle: Buffer.from(handle),
        response: response.buffer,
      })
      if (Atomics.wait(response, 0, 0, 30_000) === 'timed-out') {
        throw new Error('ConPTY parent-window request timed out')
      }
      return Atomics.load(response, 1) === 1
    },
    close() {
      return (cleanup ??= (async () => {
        try {
          // Startup failure is already reported by ready/exited. Cleanup must
          // still succeed after the failed worker has been terminated.
          if (!failed) await command('close')
        } finally {
          closed = true
          clearTimeout(startupTimer)
          readable.resume()
          await worker.terminate()
        }
      })())
    },
  }
}
