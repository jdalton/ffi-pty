import { resolve } from 'node:path'

export const repositoryRoot = resolve(import.meta.dirname, '..')

export function windowsHelperPath(
  root: string,
  arch: string,
  packaged = false,
): string {
  if (arch !== 'x64' && arch !== 'arm64') {
    throw new Error('Unsupported Windows helper architecture')
  }
  return resolve(
    root,
    packaged ? 'dist/bin' : 'build/ffi-pty',
    `win32-${arch}`,
    'helper.exe',
  )
}
