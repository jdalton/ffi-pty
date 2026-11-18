export type Platform = 'darwin' | 'linux' | 'win32'
export type Architecture = 'x64' | 'arm64'
export type Libc = 'glibc' | 'musl'
export interface RunnerTarget {
  runner: string
  platform: Platform
  architecture: Architecture
  libc?: Libc
  routine: boolean
}
export const runnerTargets: readonly RunnerTarget[] = [
  {
    runner: 'macos-15',
    platform: 'darwin',
    architecture: 'arm64',
    routine: true,
  },
  {
    runner: 'macos-15-intel',
    platform: 'darwin',
    architecture: 'x64',
    routine: true,
  },
  {
    runner: 'ubuntu-22.04',
    platform: 'linux',
    architecture: 'x64',
    libc: 'glibc',
    routine: true,
  },
  {
    runner: 'ubuntu-22.04-arm',
    platform: 'linux',
    architecture: 'arm64',
    libc: 'glibc',
    routine: true,
  },
  {
    runner: 'windows-2025',
    platform: 'win32',
    architecture: 'x64',
    routine: true,
  },
  {
    runner: 'windows-2022',
    platform: 'win32',
    architecture: 'x64',
    routine: false,
  },
  {
    runner: 'windows-11-arm',
    platform: 'win32',
    architecture: 'arm64',
    routine: true,
  },
]

// Scope only recognized directory positions, never architecture words in filenames.
// Linux uses linux/<libc>/<architecture>/; linux/<architecture>/ is shared libc code.
export function pathScope(file: string): {
  architecture?: Architecture
  libc?: Libc
} {
  const path = file.replaceAll('\\', '/')
  const match = /^(?:src|test\/src)\/(darwin|linux|win32)\/(.*)$/.exec(path)
  if (!match) {
    const asset = /^assets\/conpty\/(x64|arm64)\//.exec(path)
    return asset ? { architecture: asset[1] as Architecture } : {}
  }
  const parts = match[2].split('/')
  const libc =
    match[1] === 'linux' && ['glibc', 'musl'].includes(parts[0])
      ? (parts.shift() as Libc)
      : undefined
  const architecture =
    parts.length > 1 && ['x64', 'arm64'].includes(parts[0])
      ? (parts[0] as Architecture)
      : undefined
  return {
    ...(libc ? { libc } : {}),
    ...(architecture ? { architecture } : {}),
  }
}
