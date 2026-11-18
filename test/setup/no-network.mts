import { AsyncLocalStorage } from 'node:async_hooks'
import net from 'node:net'
import http from 'node:http'
import https from 'node:https'
import dgram from 'node:dgram'
import dns from 'node:dns'
import { createRequire, syncBuiltinESMExports } from 'node:module'

// Preserve real IPC before Nock installs its socket interception. A named pipe
// is not HTTP: an intercepted socket can report connect before opening the pipe,
// leaving ConPTY blocked in ConnectNamedPipe while its peer waits for startup.
const nativeConnect = net.Socket.prototype.connect
const nock = createRequire(import.meta.url)('nock').default
nock.disableNetConnect()
const httpFixture = new AsyncLocalStorage<boolean>()

export function denyNetwork(): never {
  throw new Error(
    'Network access is disabled in unit tests; use a Nock fixture',
  )
}

export function isLocalIpc(args: unknown[]): boolean {
  // net.connect passes its normalized [options, callback] array to Socket.connect.
  const first = Array.isArray(args[0]) ? args[0][0] : args[0]
  return (
    (typeof first === 'string' && !/^\d+$/.test(first)) ||
    Boolean(
      first &&
      typeof first === 'object' &&
      'path' in first &&
      typeof first.path === 'string',
    )
  )
}

// Nock owns HTTP socket interception. Let requests reach it so mocked requests
// work and unmatched requests receive Nock's normal error, not a stalled socket.
for (const api of [http, https]) {
  for (const key of ['request', 'get'] as const) {
    const original = api[key]
    api[key] = function (...args: unknown[]) {
      return httpFixture.run(true, () => Reflect.apply(original, api, args))
    } as typeof original
  }
}
const connect = net.Socket.prototype.connect
net.Socket.prototype.connect = function (...args: unknown[]) {
  if (isLocalIpc(args)) {
    return Reflect.apply(nativeConnect, this, args)
  }
  if (!httpFixture.getStore()) {
    denyNetwork()
  }
  return Reflect.apply(connect, this, args)
} as typeof connect
const listen = net.Server.prototype.listen
net.Server.prototype.listen = function (...args: unknown[]) {
  if (!isLocalIpc(args)) {
    denyNetwork()
  }
  return Reflect.apply(listen, this, args)
} as typeof listen
for (const name of ['send', 'connect', 'bind'] as const) {
  dgram.Socket.prototype[name] = denyNetwork
}
for (const name of [
  'lookup',
  'resolve',
  'resolve4',
  'resolve6',
  'reverse',
] as const) {
  dns[name] = denyNetwork
  dns.promises[name] = async () => denyNetwork()
}
syncBuiltinESMExports()
