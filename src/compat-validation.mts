/**
 * Validate JavaScript values before passing them across the native boundary.
 */
export function checkCompatibleType(
  name: string,
  value: unknown,
  type: string,
  allowArray = false,
): void {
  if (value === undefined) return
  if (allowArray && Array.isArray(value)) {
    for (const item of value) checkCompatibleType(name, item, type)
  } else if (typeof value !== type) {
    throw new TypeError(`${name} must be a ${type} (not a ${typeof value})`)
  }
}
