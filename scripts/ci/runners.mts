import {
  pathScope,
  runnerTargets,
  type RunnerTarget,
  type Platform,
} from './targets.mts'
export type { Platform } from './targets.mts'
export const platforms: Platform[] = ['darwin', 'linux', 'win32']
export const platformRunners = Object.fromEntries(
  platforms.map(platform => [
    platform,
    runnerTargets
      .filter(target => target.platform === platform)
      .map(target => target.runner),
  ]),
) as Record<Platform, string[]>
export const allRunners = runnerTargets.map(target => target.runner)
export interface RunnerPlan {
  runner: string[]
  docsOnly: boolean
  reason: string
}

export function affectedPlatforms(file: string): Platform[] {
  const path = file.replaceAll('\\', '/')
  const platform = /^(?:src|test\/src)\/(darwin|linux|win32)\//.exec(
    path,
  )?.[1] as Platform | undefined
  if (platform) {
    return [platform]
  }
  if (/^(?:src|test\/src)\/unix[.-]/.test(path)) {
    return ['darwin', 'linux']
  }
  if (/^test\/upstream\/node-pty\/(?:original\/)?src\/windows/.test(path)) {
    return ['win32']
  }
  if (/^test\/upstream\/node-pty\/(?:original\/)?src\/unix/.test(path)) {
    return ['darwin', 'linux']
  }
  if (
    /^test\/upstream\/node-pty\/(?:windows-helpers|window-probe)\.mts$/.test(
      path,
    )
  ) {
    return ['win32']
  }
  if (path.startsWith('assets/conpty/')) {
    return ['win32']
  }
  // Only prose and documentation assets may skip native tests. Unknown files,
  // shared code, lockfiles and build configuration conservatively affect all OSes.
  if (
    path.endsWith('.md') ||
    (path.startsWith('docs/') && /\.(?:svg|png|jpg|webp)$/.test(path))
  ) {
    return []
  }
  return platforms
}

export function selectRunners(
  files: string[] | undefined,
  target = 'auto',
  release = false,
  targets: readonly RunnerTarget[] = runnerTargets,
): RunnerPlan {
  if (release || target === 'all') {
    return {
      runner: allRunners,
      docsOnly: false,
      reason: 'Full release matrix',
    }
  }
  if (target in platformRunners && Object.hasOwn(platformRunners, target)) {
    return {
      runner: [...platformRunners[target as Platform]],
      docsOnly: false,
      reason: `Requested ${target} runners`,
    }
  }
  if (target === 'unix') {
    return {
      runner: [...platformRunners.darwin, ...platformRunners.linux],
      docsOnly: false,
      reason: 'Requested Unix runners',
    }
  }
  if (allRunners.includes(target)) {
    return {
      runner: [target],
      docsOnly: false,
      reason: 'Requested individual runner',
    }
  }
  if (target !== 'auto') {
    throw new Error(`Unknown runner target: ${target}`)
  }
  return selectAutomaticRunners(files, targets)
}

export function selectAutomaticRunners(
  files: string[] | undefined,
  targets: readonly RunnerTarget[] = runnerTargets,
): RunnerPlan {
  const selected = new Set<string>()
  for (const file of files ?? ['unknown']) {
    const affected = affectedPlatforms(file)
    const scope = pathScope(file)
    const matching = targets.filter(
      candidate =>
        candidate.routine &&
        affected.includes(candidate.platform) &&
        (!scope.architecture ||
          candidate.architecture === scope.architecture) &&
        (!scope.libc || candidate.libc === scope.libc),
    )
    if (affected.length && !matching.length) {
      throw new Error('No CI runner configured for ' + file)
    }
    for (const candidate of matching) {
      selected.add(candidate.runner)
    }
  }
  return {
    runner: selected.size
      ? targets
          .filter(candidate => selected.has(candidate.runner))
          .map(candidate => candidate.runner)
      : ['ubuntu-22.04'],
    docsOnly: selected.size === 0,
    reason:
      files === undefined
        ? 'No reliable diff; check every supported OS and architecture'
        : selected.size
          ? 'Changed platform and architecture sources'
          : 'Documentation checks only',
  }
}
