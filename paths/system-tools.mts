import { win32 } from 'node:path'

export function archiveTool(
  platform = process.platform,
  env = process.env,
): string {
  if (platform !== 'win32') {
    return 'tar'
  }
  const root = env.SystemRoot ?? env.SYSTEMROOT
  if (!root || !win32.isAbsolute(root)) {
    throw new Error('Windows SystemRoot must be absolute')
  }
  return win32.join(root, 'System32', 'tar.exe')
}
