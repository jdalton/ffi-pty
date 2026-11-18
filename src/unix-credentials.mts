export interface Credentials {
  uid?: number
  gid?: number
}

export function credentialArguments(options: Credentials): string[] {
  if (options.uid === undefined && options.gid === undefined) return []
  return [
    '--ffi-credentials',
    JSON.stringify({ uid: options.uid, gid: options.gid }),
  ]
}

export function consumeCredentials(
  args: string[],
  apply: (credentials: Credentials) => void = applyCredentials,
): string[] {
  if (args[0] !== '--ffi-credentials') return args
  const value: unknown = JSON.parse(args[1] ?? '')
  if (!value || typeof value !== 'object') {
    throw new TypeError('Invalid credentials')
  }
  const credentials = value as Credentials
  for (const key of ['uid', 'gid'] as const) {
    if (
      credentials[key] !== undefined &&
      (!Number.isInteger(credentials[key]) || credentials[key]! < 0)
    ) {
      throw new TypeError(`Invalid ${key}`)
    }
  }
  apply(credentials)
  return args.slice(2)
}

export function applyCredentials(
  { uid, gid }: Credentials,
  setGroup: (value: number) => void = value => process.setgid!(value),
  setUser: (value: number) => void = value => process.setuid!(value),
): void {
  // Drop group privileges before user privileges, in the child only.
  if (gid !== undefined) setGroup(gid)
  if (uid !== undefined) setUser(uid)
}
