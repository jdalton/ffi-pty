import { fileURLToPath } from 'node:url'
import { credentialArguments } from '../unix-credentials.mts'
import { splitTargetEnvironment } from '../unix-environment.mts'
import { dlopen, getInt32 } from 'node:ffi'
import { openSync, closeSync, constants as fsConstants } from 'node:fs'
import { constants as osConstants } from 'node:os'
import { createUnixBackend, type UnixBindings } from '../unix-common.mts'
import { makePointerVector, resolveExecutable } from '../unix-native.mts'
import { getUnixControl } from '../unix-control.mts'
import type { SpawnOptions } from '../contract.mts'

if (
  process.platform !== 'linux' ||
  (process.arch !== 'x64' && process.arch !== 'arm64')
) {
  throw new Error('The Linux FFI PTY backend requires Linux x64 or ARM64')
}
export function assertSupportedGlibc(
  version = process.report?.getReport().header.glibcVersionRuntime,
): void {
  const match = version?.match(/^(\d+)\.(\d+)/)
  if (
    !match ||
    Number(match[1]) < 2 ||
    (Number(match[1]) === 2 && Number(match[2]) < 34)
  ) {
    throw new Error(
      `The Linux FFI PTY backend requires glibc 2.34 or newer (found ${version ?? 'unknown'})`,
    )
  }
}
let c: any
export function isLinuxNativeLoaded(): boolean {
  return c !== undefined
}

export function getLibcFunctions() {
  if (c) return c
  assertSupportedGlibc()
  c = dlopen('libc.so.6', {
    openpty: {
      arguments: ['pointer', 'pointer', 'pointer', 'pointer', 'pointer'],
      return: 'int32',
    },
    posix_spawnattr_init: { arguments: ['pointer'], return: 'int32' },
    posix_spawnattr_setflags: {
      arguments: ['pointer', 'int16'],
      return: 'int32',
    },
    posix_spawnattr_setsigdefault: {
      arguments: ['pointer', 'pointer'],
      return: 'int32',
    },
    posix_spawnattr_setsigmask: {
      arguments: ['pointer', 'pointer'],
      return: 'int32',
    },
    posix_spawnattr_destroy: { arguments: ['pointer'], return: 'int32' },
    posix_spawn_file_actions_init: { arguments: ['pointer'], return: 'int32' },
    posix_spawn_file_actions_addopen: {
      arguments: ['pointer', 'int32', 'string', 'int32', 'uint32'],
      return: 'int32',
    },
    posix_spawn_file_actions_adddup2: {
      arguments: ['pointer', 'int32', 'int32'],
      return: 'int32',
    },
    posix_spawn_file_actions_addclosefrom_np: {
      arguments: ['pointer', 'int32'],
      return: 'int32',
    },
    posix_spawn_file_actions_addchdir_np: {
      arguments: ['pointer', 'string'],
      return: 'int32',
    },
    posix_spawn_file_actions_destroy: {
      arguments: ['pointer'],
      return: 'int32',
    },
    posix_spawn: {
      arguments: [
        'pointer',
        'string',
        'pointer',
        'pointer',
        'pointer',
        'pointer',
      ],
      return: 'int32',
    },
    sigemptyset: { arguments: ['pointer'], return: 'int32' },
    sigaddset: { arguments: ['pointer', 'int32'], return: 'int32' },
    close: { arguments: ['int32'], return: 'int32' },
    __errno_location: { arguments: [], return: 'pointer' },
    waitpid: { arguments: ['int32', 'pointer', 'int32'], return: 'int32' },
    kill: { arguments: ['int32', 'int32'], return: 'int32' },
  }).functions
  return c
}
export const GLIBC_LP64_ABI = Object.freeze({
  spawnAttrBytes: 336,
  fileActionsBytes: 80,
  sigsetBytes: 128,
  modeBytes: 4,
})

export function readErrno(c = getLibcFunctions()): number {
  return getInt32(c.__errno_location())
}

export function spawnLinux(
  { file, args, cols, rows, cwd, env, uid, gid }: SpawnOptions,
  c = getLibcFunctions(),
) {
  const masterOut = Buffer.alloc(4),
    slaveOut = Buffer.alloc(4),
    name = Buffer.alloc(256)
  const size = Buffer.alloc(8)
  size.writeUInt16LE(rows, 0)
  size.writeUInt16LE(cols, 2)
  const rc = c.openpty(masterOut, slaveOut, name, null, size)
  if (rc !== 0) throw new Error(`openpty failed (errno ${readErrno(c)})`)
  const masterFd = masterOut.readInt32LE(),
    slaveFd = slaveOut.readInt32LE()
  const slaveName = name.toString('utf8', 0, name.indexOf(0))
  if (masterFd < 3 || slaveFd < 3) {
    c.close(masterFd)
    c.close(slaveFd)
    throw new Error(
      'openpty returned a standard descriptor; cannot safely spawn',
    )
  }
  const attr = Buffer.alloc(GLIBC_LP64_ABI.spawnAttrBytes),
    actions = Buffer.alloc(GLIBC_LP64_ABI.fileActionsBytes),
    pidOut = Buffer.alloc(4)
  let attrReady = false,
    actionsReady = false,
    spawned = false
  const ck = (result: number, op: string) => {
    if (result !== 0) throw new Error(`${op} failed with ${result}`)
  }
  try {
    ck(c.posix_spawnattr_init(attr), 'posix_spawnattr_init')
    attrReady = true
    const sigdefault = Buffer.alloc(GLIBC_LP64_ABI.sigsetBytes),
      sigmask = Buffer.alloc(GLIBC_LP64_ABI.sigsetBytes)
    ck(c.sigemptyset(sigdefault), 'sigemptyset')
    // Reset caught signals to default in the child; clear inherited blocked mask.
    for (let sig = 1; sig <= 64; sig++) {
      // Linux reserves 32 and 33 for the threading runtime; glibc rejects them.
      if (sig !== 9 && sig !== 19 && sig !== 32 && sig !== 33) {
        ck(c.sigaddset(sigdefault, sig), 'sigaddset')
      }
    }
    ck(c.sigemptyset(sigmask), 'sigemptyset')
    ck(c.posix_spawnattr_setsigdefault(attr, sigdefault), 'setsigdefault')
    ck(c.posix_spawnattr_setsigmask(attr, sigmask), 'setsigmask')
    ck(c.posix_spawnattr_setflags(attr, 0x80 | 0x04 | 0x08), 'set spawn flags')
    ck(c.posix_spawn_file_actions_init(actions), 'actions init')
    actionsReady = true
    ck(
      c.posix_spawn_file_actions_addopen(actions, 0, slaveName, 2, 0),
      'open slave in child',
    )
    ck(c.posix_spawn_file_actions_adddup2(actions, 0, 1), 'dup stdout')
    ck(c.posix_spawn_file_actions_adddup2(actions, 0, 2), 'dup stderr')
    ck(c.posix_spawn_file_actions_addchdir_np(actions, cwd), 'set child cwd')
    ck(
      c.posix_spawn_file_actions_addclosefrom_np(actions, 3),
      'close child descriptors',
    )
    let executable = resolveExecutable(file, cwd, env)
    let argvValues = [file, ...args]
    if (uid !== undefined || gid !== undefined) {
      argvValues = [
        process.execPath,
        '--experimental-ffi',
        '-e',
        'require(process.argv[1])',
        fileURLToPath(new URL('./linux-bootstrap.mts', import.meta.url)),
        ...credentialArguments({ uid, gid }),
        executable,
        file,
        ...args,
      ]
      executable = process.execPath
      env = splitTargetEnvironment(env)
    }
    const argv = makePointerVector(argvValues)
    const envp = makePointerVector(
      Object.entries(env).map(([k, v]) => `${k}=${v}`),
    )
    // Resolve against the requested child cwd and PATH before spawning, since
    // posix_spawnp searches the parent's PATH before the chdir action runs.
    ck(
      c.posix_spawn(
        pidOut,
        executable,
        actions,
        attr,
        argv.pointers,
        envp.pointers,
      ),
      'posix_spawn',
    )
    void argv.buffers
    void envp.buffers
    spawned = true
  } finally {
    if (actionsReady) c.posix_spawn_file_actions_destroy(actions)
    if (attrReady) c.posix_spawnattr_destroy(attr)
    c.close(slaveFd)
    if (!spawned) c.close(masterFd)
  }
  return { pid: pidOut.readInt32LE(), masterFd, slaveName }
}

export function waitLinux(pid: number, c = getLibcFunctions()) {
  const status = Buffer.alloc(4)
  const found = c.waitpid(pid, status, 1)
  if (found === 0) return null
  if (found < 0) {
    const error = readErrno(c)
    if (error === 4) return null // EINTR
    throw new Error(`waitpid failed (errno ${error})`)
  }
  const raw = status.readInt32LE(),
    sig = raw & 0x7f
  return { exitCode: sig === 0 ? (raw >>> 8) & 0xff : null, signal: sig }
}

export function killLinux(
  pid: number,
  signal: string | number = 'SIGTERM',
  c = getLibcFunctions(),
): void {
  const number =
    typeof signal === 'number'
      ? signal
      : osConstants.signals[signal as keyof typeof osConstants.signals]
  if (!number) throw new Error(`Unknown signal: ${signal}`)
  if (c.kill(pid, number) !== 0) {
    throw new Error(`kill failed (errno ${readErrno(c)})`)
  }
}

export async function resizeLinux(
  slaveName: string,
  cols: number,
  rows: number,
): Promise<void> {
  const fd = openSync(slaveName, fsConstants.O_RDWR | fsConstants.O_NOCTTY)
  try {
    // One TIOCSWINSZ updates both dimensions before delivering SIGWINCH.
    // stty can update rows and columns separately, exposing an intermediate size.
    getUnixControl().resize(fd, cols, rows)
  } finally {
    closeSync(fd)
  }
}

export function closeLinuxFd(fd: number, c = getLibcFunctions()): void {
  if (c.close(fd) !== 0) throw new Error(`close failed (errno ${readErrno(c)})`)
}

export function createLinuxBindings(): UnixBindings {
  return {
    spawn: spawnLinux,
    wait: waitLinux,
    kill: killLinux,
    resize: resizeLinux,
    closeFd: closeLinuxFd,
  }
}

export async function createBackend(options: SpawnOptions) {
  return createUnixBackend(options, createLinuxBindings())
}

export function createBackendSync(options: SpawnOptions) {
  const control = getUnixControl()
  const backend = createUnixBackend(options, createLinuxBindings())
  return Object.assign(backend, {
    resizeSync: (
      cols: number,
      rows: number,
      pixels?: { width: number; height: number },
    ) => control.resize(backend.masterFd, cols, rows, pixels),
    killSync: (signal: string) => {
      try {
        process.kill(backend.pid, signal as NodeJS.Signals)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
      }
    },
    processTitle: () => control.title(backend.masterFd, options.file),
  })
}
