import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: [
      'test/vitest/**/*.test.mts',
      'test/src/**/*.test.mts',
      'test/upstream/node-pty/src/**/*.test.mts',
    ],
    exclude: ['**/*.integration.test.mts'],
    pool: 'forks',
    maxWorkers: 2,
    setupFiles: ['test/setup/no-network.mts'],
    testTimeout: 60_000,
  },
})
