import { PassThrough } from 'node:stream'
import { CompatibleTerminal } from '../../../src/compat-terminal.mts'
import { normalizeCompatibleOptions } from '../../../src/compat-options.mts'

export function mockTerminal() {
  const readable = new PassThrough()
  let finish!: (value: { exitCode: number; signal: number }) => void
  const exited = new Promise<{ exitCode: number; signal: number }>(resolve => {
    finish = resolve
  })
  const config = normalizeCompatibleOptions('shell', [], {
    handleFlowControl: true,
    flowControlPause: 'abc',
    flowControlResume: '123',
  })
  const term = new CompatibleTerminal(config, () => ({
    pid: 1,
    readable,
    exited,
    async write() {},
    async resize() {},
    async kill() {},
    async close() {
      readable.end()
      finish({ exitCode: 0, signal: 0 })
    },
  }))
  return { term, readable }
}
