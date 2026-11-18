export function recoverTargetEnvironment(
  env: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const privateKey = 'PTY_FFI_TARGET_NODE_ENV'
  const payload = env[privateKey]
  const base = { ...env }
  delete base[privateKey]
  delete base.NODE_V8_COVERAGE
  return { ...base, ...(payload ? JSON.parse(payload) : {}) }
}

export function splitTargetEnvironment(
  env: Record<string, string>,
  coverageDirectory = process.env.NODE_V8_COVERAGE,
): Record<string, string> {
  const bootstrapEnv = Object.create(null) as Record<string, string>
  const nodeEnv = Object.create(null) as Record<string, string>
  for (const [key, value] of Object.entries(env)) {
    if (key.startsWith('NODE_') || key === 'PTY_FFI_TARGET_NODE_ENV') {
      nodeEnv[key] = value
    } else bootstrapEnv[key] = value
  }
  if (coverageDirectory) bootstrapEnv.NODE_V8_COVERAGE = coverageDirectory
  bootstrapEnv.PTY_FFI_TARGET_NODE_ENV = JSON.stringify(nodeEnv)
  return bootstrapEnv
}
