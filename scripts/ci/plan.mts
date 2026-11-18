import { execFileSync } from 'node:child_process'
import { appendFileSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { selectRunners } from './runners.mts'

export interface WorkflowEvent {
  before?: string
  pull_request?: { base: { sha: string } }
  inputs?: { target?: string }
}

export function changedFiles(
  event: WorkflowEvent,
  execute = execFileSync,
): Array<{ path: string; deleted: boolean }> | undefined {
  const base = event.pull_request?.base.sha ?? event.before
  if (!base || !/^[a-f0-9]{40,64}$/.test(base) || /^0+$/.test(base)) {
    return undefined
  }
  try {
    execute('git', ['fetch', '--no-tags', '--depth=1', 'origin', base], {
      stdio: 'pipe',
    })
    // Disable rename collapsing so moves between platforms select both sides.
    const diff = execute(
      'git',
      ['diff', '--no-renames', '--name-status', '-z', base, 'HEAD'],
      { encoding: 'utf8' },
    ).split('\0')
    const files: Array<{ path: string; deleted: boolean }> = []
    for (let index = 0; index < diff.length - 1; index += 2) {
      files.push({ path: diff[index + 1], deleted: diff[index] === 'D' })
    }
    return files
  } catch {
    // Deleted branches or unavailable history must broaden tests, never omit them.
    return undefined
  }
}
export function planMain(
  env = process.env,
  execute = execFileSync,
  append = appendFileSync,
  read = readFileSync,
) {
  if (!env.GITHUB_EVENT_PATH || !env.GITHUB_OUTPUT) {
    throw new Error('Missing workflow event or output path')
  }
  const event = JSON.parse(read(env.GITHUB_EVENT_PATH, 'utf8')) as WorkflowEvent
  const release = env.GITHUB_EVENT_NAME === 'release'
  const files = release ? undefined : changedFiles(event, execute)
  const plan = selectRunners(
    files?.filter(file => !file.deleted).map(file => file.path),
    event.inputs?.target ?? 'auto',
    release,
  )
  append(
    env.GITHUB_OUTPUT,
    `matrix=${JSON.stringify({ runner: plan.runner })}\ndocs-only=${plan.docsOnly}\n`,
  )
  if (env.GITHUB_STEP_SUMMARY) {
    append(
      env.GITHUB_STEP_SUMMARY,
      `Selected runners: ${plan.runner.join(', ')}\n\n${plan.reason}\n`,
    )
  }
  return plan
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  planMain()
}
