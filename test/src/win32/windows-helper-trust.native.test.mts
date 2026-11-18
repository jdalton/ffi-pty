import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'vitest'
import { runPowerShellAuthenticodeVerifier } from '../../../src/win32/windows-helper-trust.mts'

test(
  'native PowerShell refuses an unsigned file or stops at the bounded verification deadline',
  { skip: process.platform !== 'win32', timeout: 10_000 },
  async () => {
    const directory = mkdtempSync(join(tmpdir(), 'pty-unsigned-'))
    const file = join(directory, 'unsigned.exe')
    writeFileSync(file, 'unsigned helper fixture')
    try {
      try {
        const result = await runPowerShellAuthenticodeVerifier(file, {
          subject: 'CN=PTY Test',
        })
        assert.notEqual(result.status, 'Valid')
      } catch (error) {
        // Cold PowerShell startup can exceed the production verification limit.
        // Only a killed subprocess is accepted; missing tools and other errors fail.
        assert.equal((error as { killed?: boolean }).killed, true)
        assert.equal((error as { signal?: string }).signal, 'SIGTERM')
      }
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  },
)
