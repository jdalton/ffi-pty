// Adapted from node-pty's MIT-licensed windowsTerminal.test.ts. Both backends run.
import assert from 'node:assert/strict'
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { upstreamTest, terminal, windows, until } from '../suite.mts'
import {
  hostWindow,
  readWindows,
  windowArgs,
  toHandle,
  processTree,
  powershellArgs,
} from '../windows-helpers.mts'

for (const useConptyDll of [false, true]) {
  upstreamTest('windowsTerminal', 1, windows, async t => {
    const { term } = terminal(t, 'cmd.exe', [], { useConptyDll })
    term.kill()
    await term.exited
  })
  upstreamTest('windowsTerminal', 2, windows, async t => {
    // Launch the same cmd -> PowerShell -> Node tree without PSReadLine, which
    // can wait for terminal cursor-query responses in headless Windows ARM CI.
    const script = powershellArgs(
      `& '${process.execPath.replaceAll("'", "''")}' -e 'setInterval(()=>{},1000)'`,
    )
    const { term, output } = terminal(
      t,
      t,
      'cmd.exe',
      `/c powershell.exe ${script}`,
      {
        useConptyDll,
      },
    )
    // Process creation is the readiness condition for this upstream case.
    // Console output may be buffered, so a marker must not gate tree cleanup.
    await term.ready
    let tree: ReturnType<typeof processTree> = []
    await until(() => {
      tree = processTree(term.pid)
      return tree.length === 3
    }, 20_000).catch(error => {
      throw new Error(
        `${error.message}; tree=${JSON.stringify(tree)}; output=${output()}`,
        {
          cause: error,
        },
      )
    })
    assert.deepEqual(
      tree.map(row => row.Name.toLowerCase()),
      ['cmd.exe', 'powershell.exe', 'node.exe'],
    )
    term.kill()
    await term.exited
    await until(() =>
      tree.every(row => {
        try {
          process.kill(row.ProcessId, 0)
          return false
        } catch (error) {
          assert.equal((error as NodeJS.ErrnoException).code, 'ESRCH')
          return true
        }
      }),
    )
  })
  upstreamTest('windowsTerminal', 3, windows, async t => {
    const { term } = terminal(t, 'cmd.exe', [], { useConptyDll })
    assert.equal(term.pid, 0)
    await term.ready
    assert.ok(term.pid > 0)
  })
  upstreamTest('windowsTerminal', 4, windows, async t => {
    const { term } = terminal(t, 'cmd.exe', [], { useConptyDll })
    assert.throws(() => term.resize(-1, -1))
    assert.throws(() => term.resize(0, 0))
    assert.doesNotThrow(() => term.resize(1, 1))
    term.kill()
    await term.exited
  })
  upstreamTest('windowsTerminal', 5, windows, async t => {
    const { term } = terminal(t, 'cmd.exe', [], { useConptyDll })
    await term.ready
    term.destroy()
    await term.exited
    assert.throws(() => term.resize(1, 1))
  })
  upstreamTest('windowsTerminal', 6, windows, async t => {
    const directory = mkdtempSync(join(tmpdir(), 'ffi space folder '))
    t.after(() => rmSync(directory, { recursive: true, force: true }))
    const exe = join(directory, 'cmd.exe')
    copyFileSync(join(process.env.SystemRoot!, 'System32', 'cmd.exe'), exe)
    const { term, output } = terminal(t, exe, '/c echo "hello world"', {
      useConptyDll,
    })
    await term.exited
    assert.match(output(), /hello world/)
  })
  upstreamTest('windowsTerminal', 7, windows, async t => {
    const { term, output } = terminal(t, 'cmd.exe', '/C echo %FOO%', {
      useConptyDll,
      env: { FOO: 'BAR' },
    })
    await term.exited
    assert.match(output(), /BAR/)
  })
  upstreamTest('windowsTerminal', 8, windows, async t => {
    const { term } = terminal(
      t,
      t,
      fileURLToPath(new URL('../../../../package.json', import.meta.url)),
      [],
      { useConptyDll },
    )
    const status = await new Promise<{ exitCode: number }>(resolve =>
      term.onExit(resolve),
    )
    assert.notEqual(status.exitCode, 0)
    assert.equal(term.pid, 0)
  })
  for (const [id, code] of [
    [9, 0],
    [10, 2],
  ] as const) {
    upstreamTest('windowsTerminal', id, windows, async t => {
      const { term } = terminal(t, 'cmd.exe', `/C exit ${code}`, {
        useConptyDll,
      })
      assert.equal((await term.exited).exitCode, code)
    })
  }
  upstreamTest('windowsTerminal', 11, windows, async t => {
    const { term } = terminal(t, 'cmd.exe', '', { useConptyDll })
    term.write('exit\r')
    assert.equal((await term.exited).exitCode, 0)
  })
  upstreamTest('windowsTerminal', 12, windows, async t => {
    const host = await hostWindow(t, useConptyDll)
    const { term, output } = terminal(t, process.execPath, windowArgs(), {
      useConptyDll,
    })
    assert.equal(term.setParentWindow(toHandle(host)), useConptyDll)
    const result = await readWindows(output)
    assert.equal(result.rootOwner, useConptyDll ? host : result.console)
  })
  upstreamTest('windowsTerminal', 13, windows, async t => {
    const host = await hostWindow(t, useConptyDll)
    const { term, output } = terminal(t, process.execPath, windowArgs(3000), {
      useConptyDll,
    })
    await until(() => output().includes('shell-running'), 30_000)
    assert.equal(term.setParentWindow(toHandle(host)), useConptyDll)
    const result = await readWindows(output)
    assert.equal(result.rootOwner, useConptyDll ? host : result.console)
  })
  upstreamTest('windowsTerminal', 14, windows, async t => {
    const { term, output } = terminal(t, 'cmd.exe', [], { useConptyDll })
    await until(() => output().length > 0)
    term.kill()
    assert.equal(term.setParentWindow(Buffer.alloc(8)), false)
    await term.exited
    assert.equal(term.setParentWindow(Buffer.alloc(8)), false)
  })
  upstreamTest('windowsTerminal', 15, windows, async t => {
    const { term } = terminal(t, 'cmd.exe', [], { useConptyDll })
    for (const handle of [
      Buffer.alloc(4),
      Buffer.alloc(9),
      Buffer.alloc(0),
      1,
      1n,
      '0x1234',
      undefined,
    ]) {
      assert.throws(
        () => term.setParentWindow(handle as Buffer),
        /hwnd must be a Buffer the size of an HWND/,
      )
    }
  })
  upstreamTest('windowsTerminal', 16, windows, async t => {
    const terms = Array.from({ length: 30 }, () =>
      terminal(t, 'cmd.exe', [], { useConptyDll }),
    )
    await until(() => terms.every(item => item.output().length > 0), 45_000)
    const spam = setInterval(() => {
      for (const { term } of terms) {
        try {
          term.resize(90, 30)
        } catch {
          /* closed terminal */
        }
        term.clear()
        term.setParentWindow(Buffer.alloc(8))
      }
    }, 1)
    t.after(() => clearInterval(spam))
    for (const { term } of terms) {
      term.kill()
    }
    await Promise.all(terms.map(({ term }) => term.exited))
    clearInterval(spam)
  })
}
