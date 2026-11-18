import { dlopen } from 'node:ffi'
import { ReadStream } from 'node:tty'
import { initializeNonblockingPoll } from './unix-poll.mts'
import { validateDimension } from './validation.mts'

export interface OpenOptions {
  cols?: number | undefined
  rows?: number | undefined
  encoding?: BufferEncoding | null | undefined
}
export function openUnixPty(options: OpenOptions = {}) {
  if (process.platform !== 'darwin' && process.platform !== 'linux') {
    throw new Error('open is supported only on Unix')
  }
  const cols = options.cols || 80,
    rows = options.rows || 24
  validateDimension(cols, 'cols')
  validateDimension(rows, 'rows')
  const { functions: c } = dlopen(
    process.platform === 'darwin' ? '/usr/lib/libSystem.B.dylib' : 'libc.so.6',
    {
      openpty: {
        arguments: ['pointer', 'pointer', 'pointer', 'pointer', 'pointer'],
        return: 'int32',
      },
      close: { arguments: ['int32'], return: 'int32' },
    },
  )
  const masterFd = Buffer.alloc(4),
    slaveFd = Buffer.alloc(4),
    name = Buffer.alloc(1024),
    size = Buffer.alloc(8)
  size.writeUInt16LE(rows)
  size.writeUInt16LE(cols, 2)
  if (c.openpty(masterFd, slaveFd, name, 0n, size) !== 0) {
    throw new Error('openpty failed')
  }
  const descriptors = [masterFd.readInt32LE(), slaveFd.readInt32LE()]
  const streams: ReadStream[] = []
  try {
    for (const fd of descriptors) {
      initializeNonblockingPoll(fd)
      const stream = new ReadStream(fd)
      streams.push(stream)
      if (options.encoding !== null) {
        stream.setEncoding(options.encoding ?? 'utf8')
      }
      stream.resume()
    }
    return {
      master: streams[0],
      slave: streams[1],
      fd: descriptors[0],
      ptsName: name.toString('utf8', 0, name.indexOf(0)),
    }
  } catch (error) {
    for (let i = 0; i < descriptors.length; i++) {
      if (streams[i]) streams[i].destroy()
      else c.close(descriptors[i])
    }
    throw error
  }
}
