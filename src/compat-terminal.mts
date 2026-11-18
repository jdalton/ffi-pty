import { validateWindowHandle } from './win32/windows-console-controls.mts'
import { createDataIterator } from './async-iterator.mts'
import { EventEmitter } from 'node:events'
import { StringDecoder } from 'node:string_decoder'
import { setImmediate as defer } from 'node:timers'
import { validateDimension } from './validation.mts'
import type { Backend, ExitStatus } from './contract.mts'
import type { CompatibleOptions } from './compat-options.mts'

export interface IDisposable {
  dispose(): void
}
export interface IEvent<T> {
  (listener: (event: T) => void): IDisposable
}
export interface CompatibleExit {
  exitCode: number
  signal?: number
}
export interface PixelSize {
  width: number
  height: number
}
export interface CompatibleBackend extends Backend {
  masterFd?: number
  slaveName?: string
  ready?: Promise<void>
  resizeSync?(cols: number, rows: number, pixels?: PixelSize): void
  killSync?(signal: string): void
  processTitle?(): string
  clear?(): Promise<void>
  setParentWindow?(handle: Buffer): boolean
}
export interface IPty {
  readonly pid: number
  readonly cols: number
  readonly rows: number
  readonly process: string
  handleFlowControl: boolean
  readonly onData: IEvent<string>
  readonly onExit: IEvent<CompatibleExit>
  write(data: string | Buffer): void
  resize(cols: number, rows: number, pixels?: PixelSize): void
  kill(signal?: string): void
  clear(): void
  setParentWindow(handle: Buffer): boolean
  pause(): void
  resume(): void
}
export function compatibleExit(
  status: ExitStatus,
  platform: string,
): CompatibleExit {
  return platform === 'win32'
    ? { exitCode: status.exitCode ?? 0 }
    : { exitCode: status.exitCode ?? 0, signal: status.signal }
}

export class CompatibleTerminal extends EventEmitter implements IPty {
  readonly ready: Promise<void>
  readonly exited: Promise<CompatibleExit>
  readonly onData: IEvent<string>
  readonly onExit: IEvent<CompatibleExit>
  handleFlowControl: boolean
  private backend?: CompatibleBackend
  private width: number
  private height: number
  private paused = false
  private closing = false
  private ended = false
  private killed = false
  private started = false
  private closePromise?: Promise<void>
  private tail = Promise.resolve()
  private resolveExit!: (status: CompatibleExit) => void
  private rejectExit!: (error: Error) => void
  private failed = false

  private readonly options: CompatibleOptions
  private readonly platform: string

  constructor(
    options: CompatibleOptions,
    factory: () => CompatibleBackend | Promise<CompatibleBackend>,
    platform: string = process.platform,
  ) {
    super()
    this.options = options
    this.platform = platform
    this.width = options.spawn.cols
    this.height = options.spawn.rows
    this.handleFlowControl = options.handleFlowControl
    this.onData = this.subscribe<string>('data')
    this.onExit = this.subscribe<CompatibleExit>('ptyExit')
    this.exited = new Promise((resolve, reject) => {
      this.resolveExit = resolve
      this.rejectExit = reject
    })
    void this.exited.catch(() => {})
    let created: CompatibleBackend | Promise<CompatibleBackend>
    try {
      created = factory()
    } catch (error) {
      created = Promise.reject(error)
    }
    if (!(created instanceof Promise)) this.attach(created)
    this.ready = Promise.resolve(created).then(async backend => {
      if (!this.backend) this.attach(backend)
      await backend.ready
      this.started = true
    })
    void this.ready.catch(error => this.fail(error))
  }

  subscribe<T>(event: string): IEvent<T> {
    return listener => {
      this.on(event, listener)
      return {
        dispose: () => {
          this.removeListener(event, listener)
        },
      }
    }
  }
  get pid(): number {
    return this.backend?.pid ?? 0
  }
  get fd(): number {
    return this.backend?.masterFd ?? -1
  }
  get ptsName(): string {
    return this.backend?.slaveName ?? ''
  }
  get cols(): number {
    return this.width
  }
  get rows(): number {
    return this.height
  }
  get process(): string {
    if (this.platform === 'win32') return this.options.name
    return this.backend?.processTitle?.() || this.options.spawn.file
  }
  attach(backend: CompatibleBackend): void {
    this.backend = backend
    this.started = !backend.ready
    const decoder =
      this.options.encoding === null
        ? undefined
        : new StringDecoder(this.options.encoding)
    let drained = false
    let status: CompatibleExit | undefined
    const settle = () => {
      if (!drained || !status || this.ended) return
      this.ended = true
      this.emit('ptyExit', status)
      this.emit('exit', status.exitCode, status.signal)
      this.resolveExit(status)
    }
    backend.readable.pause()
    backend.readable.on('data', (chunk: Buffer) => {
      const value = decoder ? decoder.write(chunk) : chunk
      if (value.length) this.emit('data', value)
    })
    backend.readable.once('end', () => {
      const final = decoder?.end()
      if (final) this.emit('data', final)
      drained = true
      settle()
    })
    backend.readable.once('error', error => this.fail(error))
    void backend.exited.then(
      value => {
        status = compatibleExit(value, this.platform)
        settle()
      },
      error => this.fail(error),
    )
    defer(() => {
      if (!this.paused || this.closing) backend.readable.resume()
    })
  }
  fail(cause: unknown): void {
    if (this.failed) return
    this.failed = true
    const error = cause instanceof Error ? cause : new Error(String(cause))
    this.rejectExit(error)
    void this.close().catch(() => {})
    // Legacy node-pty consumers can observe I/O failures with on('error').
    // The additive ready/exited promises also retain the original failure.
    if (this.listenerCount('error')) this.emit('error', error)
    if (!this.ended) {
      this.ended = true
      const status = compatibleExit({ exitCode: 1, signal: 0 }, this.platform)
      this.emit('ptyExit', status)
      this.emit('exit', status.exitCode, status.signal)
    }
  }
  enqueue(
    operation: (backend: CompatibleBackend) => void | Promise<void>,
  ): void {
    const next = this.tail.then(async () => {
      await this.ready
      await operation(this.backend!)
    })
    this.tail = next.catch(error => this.fail(error))
  }
  write(data: string | Buffer): void {
    if (this.handleFlowControl && data === this.options.flowControlPause) {
      this.pause()
      return
    }
    if (this.handleFlowControl && data === this.options.flowControlResume) {
      this.resume()
      return
    }
    if (this.closing || this.ended) return
    const bytes = Buffer.isBuffer(data)
      ? Buffer.from(data)
      : Buffer.from(data, this.options.encoding || 'utf8')
    this.enqueue(async backend => {
      // node-pty accepts large writes. Feed bounded chunks to our backend without
      // exposing its internal queue limit through the compatibility API.
      for (let offset = 0; offset < bytes.length; offset += 64 * 1024) {
        await backend.write(bytes.subarray(offset, offset + 64 * 1024))
      }
    })
  }
  resize(cols: number, rows: number, pixels?: PixelSize): void {
    validateDimension(cols, 'cols')
    validateDimension(rows, 'rows')
    if (pixels && this.platform !== 'win32') {
      for (const value of [pixels.width, pixels.height]) {
        if (!Number.isInteger(value) || value < 0 || value > 65_535) {
          throw new RangeError('Invalid pixel dimension')
        }
      }
    }
    if (
      this.platform === 'win32' &&
      (this.closing || this.ended || this.killed)
    ) {
      throw new Error('Cannot resize a closed terminal')
    }
    if (this.closing || this.ended) return
    if (this.backend?.resizeSync) this.backend.resizeSync(cols, rows, pixels)
    else this.enqueue(backend => backend.resize(cols, rows))
    this.width = cols
    this.height = rows
  }
  kill(signal?: string): void {
    if (this.platform === 'win32' && signal) {
      throw new Error('Signals are not supported on Windows')
    }
    if (this.closing || this.ended) return
    this.killed = true
    const selected =
      signal || (this.platform === 'win32' ? 'SIGTERM' : 'SIGHUP')
    if (this.started && this.backend?.killSync) this.backend.killSync(selected)
    else {
      this.enqueue(backend =>
        backend.killSync ? backend.killSync(selected) : backend.kill(selected),
      )
    }
  }
  clear(): void {
    if (
      this.platform === 'win32' &&
      !this.closing &&
      !this.ended &&
      !this.killed
    ) {
      this.enqueue(backend => backend.clear?.())
    }
  }
  setParentWindow(handle: Buffer): boolean {
    if (this.platform !== 'win32') return false
    validateWindowHandle(handle)
    if (
      this.closing ||
      this.ended ||
      this.killed ||
      !this.options.spawn.conptyDll
    ) {
      return false
    }
    return this.backend?.setParentWindow?.(Buffer.from(handle)) ?? false
  }
  pause(): void {
    this.paused = true
    this.backend?.readable.pause()
  }
  resume(): void {
    this.paused = false
    this.backend?.readable.resume()
  }
  destroy(): void {
    this.kill()
  }
  close(): Promise<void> {
    if (!this.closePromise) {
      this.closing = true
      this.closePromise = this.ready
        .catch(() => {})
        .then(async () => {
          this.backend?.readable.resume()
          await this.backend?.close()
        })
    }
    return this.closePromise
  }
  [Symbol.asyncIterator](): AsyncIterableIterator<string | Buffer> {
    return createDataIterator(
      listener => this.subscribe<string | Buffer>('data')(listener),
      this.exited,
    )
  }
}
