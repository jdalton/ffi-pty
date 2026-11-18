import { dlopen, getInt32 } from 'node:ffi'
import { takeCoverage } from 'node:v8'
import { createReadStream, writeSync } from 'node:fs'
import { makePointerVector } from '../unix-native.mts'

export const STARTUP_FD = 3
export const STARTUP_READY = '\x01'

export function startupBindings() {
  return dlopen('/usr/lib/libSystem.B.dylib', {
    pipe: { arguments: ['pointer'], return: 'int32' },
    close: { arguments: ['int32'], return: 'int32' },
    // FIOCLEX takes no variadic argument; do not model a variadic fcntl call
    // as fixed-arity FFI on Apple Silicon (the calling conventions differ).
    ioctl: { arguments: ['int32', 'uint64'], return: 'int32' },
    execve: { arguments: ['string', 'pointer', 'pointer'], return: 'int32' },
    __error: { arguments: [], return: 'pointer' },
  }).functions
}

export function createStartupPipe(native = startupBindings()) {
  const fds = Buffer.alloc(8)
  if (native.pipe(fds) !== 0) throw new Error('Cannot create PTY startup pipe')
  const read = fds.readInt32LE()
  const write = fds.readInt32LE(4)
  try {
    if (read < 3 || write < 3) {
      throw new Error('Startup pipe overlaps standard I/O')
    }
    markCloseOnExec(read, native)
    markCloseOnExec(write, native)
    return { read, write }
  } catch (error) {
    native.close(read)
    native.close(write)
    throw error
  }
}

export function markCloseOnExec(fd: number, native = startupBindings()): void {
  // Darwin FIOCLEX = _IO('f', 1). The kernel closes this pipe only after a
  // successful exec; exec failure leaves it open so the bootstrap can report it.
  if (native.ioctl(fd, 0x20_00_66_01n) !== 0) {
    throw new Error('Cannot mark PTY startup pipe close-on-exec')
  }
}

export function validateStartupResult(message: string): void {
  if (message === STARTUP_READY) return
  throw new Error(
    `PTY target startup failed: ${message.replace(STARTUP_READY, '') || 'bootstrap exited before exec'}`,
  )
}

export function waitForStartup(fd: number, timeout = 15_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = createReadStream('', { fd, autoClose: true })
    let message = ''
    let settled = false
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.destroy()
      if (error) reject(error)
      else resolve()
    }
    const timer = setTimeout(
      () => finish(new Error('PTY target startup timed out')),
      timeout,
    )
    socket.on('error', finish)
    socket.on('data', (chunk: Buffer) => {
      message += chunk.toString('utf8')
      if (message.length > 4096) {
        finish(new Error('PTY startup response exceeds 4096 bytes'))
      }
    })
    socket.on('end', () => {
      try {
        validateStartupResult(message)
        finish()
      } catch (error) {
        finish(error as Error)
      }
    })
    socket.on('close', () => {
      if (!settled) finish(new Error('PTY startup pipe closed before EOF'))
    })
  })
}

export function execWithStartup(
  executable: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  native = startupBindings(),
  write = writeSync,
): never {
  const argv = makePointerVector(args)
  const envp = makePointerVector(
    Object.entries(env)
      .filter((entry): entry is [string, string] => entry[1] !== undefined)
      .map(([key, value]) => `${key}=${value}`),
  )
  // Node may mark inherited stdio close-on-exec during initialization.
  // Keep the terminal descriptors while the dedicated status pipe closes.
  for (const fd of [0, 1, 2]) {
    if (native.ioctl(fd, 0x20_00_66_02n) !== 0) {
      throw new Error('Cannot preserve PTY stdio')
    }
  }
  markCloseOnExec(STARTUP_FD, native)
  write(STARTUP_FD, STARTUP_READY)
  // Node's process.execve may close non-stdio descriptors before exec. Calling
  // libc preserves the error pipe until the kernel atomically commits exec.
  if (process.env.NODE_V8_COVERAGE) takeCoverage()
  native.execve(executable, argv.pointers, envp.pointers)
  void argv.buffers
  void envp.buffers
  throw new Error(
    `execve failed with errno ${getInt32(native.__error())}: ${executable}`,
  )
}

export function reportStartupFailure(error: unknown, write = writeSync): void {
  const message = error instanceof Error ? error.message : String(error)
  try {
    write(STARTUP_FD, message.slice(0, 2048))
  } catch {
    /* parent may have died */
  }
}
