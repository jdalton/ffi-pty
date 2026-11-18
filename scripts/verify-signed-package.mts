import { archiveTool } from '../paths/system-tools.mts'
import { repositoryRoot, windowsHelperPath } from '../paths/repository.mts'
import { execFileSync } from 'node:child_process'
import { globSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertPeArchitecture } from './signing-policy.mts'
import { inspectSignedFile, signedFileHash } from './sign-windows-helper.mts'

export function verifySignedPackage(
  root: string,
  arch = process.arch,
  execute = execFileSync,
  inspect = inspectSignedFile,
) {
  const packages = [...globSync('artifacts/*.tgz', { cwd: root })]
  if (packages.length !== 1) {
    throw new Error('Expected exactly one packed distribution')
  }
  const folder = mkdtempSync(join(tmpdir(), 'ffi-pty-packed-'))
  try {
    // A relative archive path avoids GNU tar interpreting a Windows drive as a host.
    execute(archiveTool(), ['-xzf', packages[0]!, '-C', folder], {
      cwd: root,
      stdio: 'pipe',
    })
    const packed = join(folder, `package/bin/win32-${arch}/helper.exe`)
    const source = windowsHelperPath(root, arch)
    assertPeArchitecture(readFileSync(packed), arch)
    if (signedFileHash(packed) !== signedFileHash(source)) {
      throw new Error('Packed helper differs from signed build')
    }
    inspect(packed)
  } finally {
    rmSync(folder, { recursive: true, force: true })
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  verifySignedPackage(repositoryRoot)
  console.log(
    'Packed helper signature, publisher, timestamp and bytes verified.',
  )
}
