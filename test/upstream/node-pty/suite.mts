import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { afterAll, onTestFinished, test, vi } from 'vitest'
import { setTimeout as delay } from 'node:timers/promises'
import { spawn } from '../../../src/compat.mts'
import type { IWindowsPtyForkOptions } from '../../../src/compat-options.mts'

export const inventory = JSON.parse(
  readFileSync(new URL('./inventory.json', import.meta.url), 'utf8'),
) as {
  revision: string
  files: Array<{
    file: string
    sha256: string
    cases: Array<{ id: string; title: string }>
  }>
}
const registered = new Map<string, number>()
type UpstreamContext = {
  after(callback: () => unknown): void
  mock: {
    timers: {
      enable(options: { apis?: string[]; now?: number }): void
      tick(milliseconds: number): void
    }
  }
}
export function upstreamTest(
  file: string,
  id: number,
  options: { skip?: boolean; timeout?: number },
  body: (context: UpstreamContext) => unknown,
) {
  const entry = inventory.files.find(
    item => item.file === `src/${file}.test.ts`,
  )?.cases[id - 1]
  assert.ok(entry, `Missing upstream case: ${file}#${id}`)
  registered.set(entry.id, (registered.get(entry.id) ?? 0) + 1)
  return test(
    `${entry.id}: ${entry.title}`,
    { timeout: 30_000, ...options },
    () =>
      body({
        after: onTestFinished,
        mock: {
          timers: {
            enable: timerOptions => vi.useFakeTimers(timerOptions as never),
            tick: milliseconds => vi.advanceTimersByTime(milliseconds),
          },
        },
      }),
  )
}
export async function until(
  predicate: () => boolean | Promise<boolean>,
  timeout = 10_000,
) {
  const deadline = Date.now() + timeout
  while (!(await predicate())) {
    assert.ok(
      Date.now() < deadline,
      'Timed out waiting for expected terminal state',
    )
    await delay(10)
  }
}
export function terminal(
  t: UpstreamContext,
  file?: string,
  args?: string[] | string,
  options?: IWindowsPtyForkOptions,
): TerminalFixture
export function terminal(
  t: UpstreamContext,
  title: UpstreamContext,
  file?: string,
  args?: string[] | string,
  options?: IWindowsPtyForkOptions,
): TerminalFixture
export function terminal(
  t: UpstreamContext,
  fileOrTitle?: string | UpstreamContext,
  argsOrFile?: string | string[],
  optionsOrArgs?: string | string[] | IWindowsPtyForkOptions,
  titleOptions?: IWindowsPtyForkOptions,
) {
  const hasTitle = typeof fileOrTitle === 'object' && fileOrTitle !== null
  const file = hasTitle ? (argsOrFile as string | undefined) : fileOrTitle
  const args = hasTitle
    ? (optionsOrArgs as string[] | string | undefined)
    : (argsOrFile as string[] | string | undefined)
  const options = hasTitle
    ? titleOptions
    : (optionsOrArgs as IWindowsPtyForkOptions | undefined)
  const term = spawn(file, args, options)
  t.after(() => term.close())
  let output = ''
  const chunks: Array<string | Buffer> = []
  term.on('data', (chunk: string | Buffer) => {
    output += chunk
    chunks.push(chunk)
  })
  return { term, chunks, output: () => output }
}
type TerminalFixture = {
  term: ReturnType<typeof spawn>
  chunks: Array<string | Buffer>
  output: () => string
}
export const unix = { skip: process.platform === 'win32' }
export const windows = { skip: process.platform !== 'win32', timeout: 60_000 }

afterAll(() => {
  for (const file of inventory.files) {
    if (!file.cases.some(entry => registered.has(entry.id))) {
      continue
    }
    const variants = file.file === 'src/windowsTerminal.test.ts' ? 2 : 1
    for (const entry of file.cases) {
      assert.equal(
        registered.get(entry.id),
        variants,
        `Upstream case missing or duplicated: ${entry.id}`,
      )
    }
  }
})
