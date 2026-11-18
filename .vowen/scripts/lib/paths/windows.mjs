// MIT licensed. See LICENSE in the generated library.
import { win32 } from 'node:path'

/**
 * Split a Windows path into its root and remaining lexical components. Works on
 * every host OS. Does not resolve dot segments or inspect the filesystem.
 *
 * @param {string} filepath
 *
 * @returns {{ root: string; parts: string[] }}
 */
export function splitWindowsPath(filepath) {
  const { root } = win32.parse(filepath)
  // Retain '..': resolving it here could hide a symlink ancestor from callers
  // that inspect each component before traversing it.
  const parts = filepath
    .slice(root.length)
    .split(/[\\/]+/)
    .filter(Boolean)
  return { root, parts }
}
