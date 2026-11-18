import assert from 'node:assert/strict'
import { test } from 'vitest'
import {
  recoverTargetEnvironment,
  splitTargetEnvironment,
} from '../../src/unix-environment.mts'

test('bootstrap restores target NODE_* values and private-key collisions without mutating input', () => {
  const original = {
    PATH: '/bin',
    PTY_FFI_TARGET_NODE_ENV: JSON.stringify({
      NODE_OPTIONS: '--no-warnings',
      NODE_PATH: '/target/modules',
      PTY_FFI_TARGET_NODE_ENV: 'target-value',
    }),
  }
  const target = recoverTargetEnvironment(original)
  assert.deepEqual(target, {
    PATH: '/bin',
    NODE_OPTIONS: '--no-warnings',
    NODE_PATH: '/target/modules',
    PTY_FFI_TARGET_NODE_ENV: 'target-value',
  })
  assert.equal(typeof original.PTY_FFI_TARGET_NODE_ENV, 'string')
})

test('bootstrap preserves special environment keys through its target payload', () => {
  const original = Object.create(null) as Record<string, string>
  original.PATH = '/bin'
  original.NODE_OPTIONS = '--no-warnings'
  original.PTY_FFI_TARGET_NODE_ENV = 'target-private-key'
  original.__proto__ = 'target-prototype-key'

  const bootstrapEnv = splitTargetEnvironment(original)
  assert.equal(Object.getPrototypeOf(bootstrapEnv), null)
  assert.equal(Object.hasOwn(bootstrapEnv, '__proto__'), true)
  assert.equal(bootstrapEnv.__proto__, 'target-prototype-key')
  const restored = recoverTargetEnvironment(bootstrapEnv)
  assert.equal(restored.__proto__, 'target-prototype-key')
  assert.equal(Object.hasOwn(restored, '__proto__'), true)
  assert.equal(restored.PTY_FFI_TARGET_NODE_ENV, 'target-private-key')
  assert.equal(restored.NODE_OPTIONS, '--no-warnings')
  assert.equal(original.__proto__, 'target-prototype-key')
})

test('bootstrap coverage capture does not leak into a target with an explicit environment', () => {
  const capture = '/tmp/ffi-pty-coverage'
  const bootstrap = splitTargetEnvironment({ PATH: '/bin' }, capture)
  assert.equal(bootstrap.NODE_V8_COVERAGE, capture)
  assert.deepEqual(recoverTargetEnvironment(bootstrap), { PATH: '/bin' })
  const target = splitTargetEnvironment(
    { NODE_V8_COVERAGE: '/target' },
    capture,
  )
  assert.equal(target.NODE_V8_COVERAGE, capture)
  assert.equal(recoverTargetEnvironment(target).NODE_V8_COVERAGE, '/target')
  assert.deepEqual(recoverTargetEnvironment({ PATH: '/bin' }), { PATH: '/bin' })
})
