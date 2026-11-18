import type {
  CompatibilityReply,
  CompatibilityRequest,
} from './windows-compat-protocol.mts'
import { setImmediate } from 'node:timers'
import { parentPort, workerData, isMainThread } from 'node:worker_threads'
import { createBackend } from './windows.mts'
import type { SpawnOptions, Backend } from '../contract.mts'

export interface CompatibilityPort {
  postMessage(value: CompatibilityReply): void
  on(
    event: 'message',
    listener: (message: CompatibilityRequest) => void,
  ): unknown
  close(): void
}
export async function compatibilityCommand(
  backend: Backend,
  operation: string,
  args: unknown[],
): Promise<void> {
  if (operation === 'write') {
    await backend.write(Buffer.from(args[0] as Uint8Array))
  } else if (operation === 'resize') {
    await backend.resize(Number(args[0]), Number(args[1]))
  } else if (operation === 'kill') {
    await backend.kill(args[0] as string | undefined)
  } else if (operation === 'clear') await backend.clear?.()
  else if (operation === 'close') await backend.close()
  else throw new Error('Unknown Windows compatibility command')
}
export function runCompatibilityWorker(
  port: CompatibilityPort,
  options: SpawnOptions,
  factory = createBackend,
) {
  let started: Promise<Backend> | undefined
  let backend: Backend | undefined
  const start = () =>
    (started ??= factory(options)
      .then(value => {
        backend = value
        port.postMessage({ type: 'ready', pid: value.pid })
        value.readable.on('data', (data: Buffer) =>
          port.postMessage({ type: 'data', data }),
        )
        value.readable.on('end', () => port.postMessage({ type: 'end' }))
        value.readable.on('error', error =>
          port.postMessage({ type: 'error', error: error.message }),
        )
        void value.exited.then(
          status => {
            port.postMessage({ type: 'exit', status })
            setImmediate(() => port.close())
          },
          error => port.postMessage({ type: 'error', error: String(error) }),
        )
        return value
      })
      .catch(error => {
        port.postMessage({ type: 'error', error: String(error) })
        throw error
      }))
  port.on('message', message => {
    if (message.type === 'pause') {
      backend?.readable.pause()
      return
    }
    if (message.type === 'resume') {
      backend?.readable.resume()
      return
    }
    if (message.type === 'parent') {
      // Seed the initial owner before creating the process; later calls issue
      // the same native request through the broker and return its actual result.
      if (!started) options.parentWindow = Buffer.from(message.handle)
      const response = new Int32Array(message.response)
      void start()
        .then(value => value.reparent?.(Buffer.from(message.handle)))
        .then(
          () => {
            Atomics.store(response, 1, 1)
          },
          () => {
            Atomics.store(response, 1, 0)
          },
        )
        .finally(() => {
          Atomics.store(response, 0, 1)
          Atomics.notify(response, 0)
        })
      return
    }
    void start()
      .then(async value => {
        if (message.type === 'command') {
          try {
            await compatibilityCommand(value, message.operation, message.args)
            port.postMessage({ type: 'ack', id: message.id })
          } catch (error) {
            port.postMessage({
              type: 'ack',
              id: message.id,
              error: String(error),
            })
          }
        }
      })
      .catch(error => port.postMessage({ type: 'error', error: String(error) }))
  })
}
if (!isMainThread && parentPort && workerData?.kind === 'compat') {
  runCompatibilityWorker(parentPort, workerData.options)
}
