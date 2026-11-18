import { loadPlatformBackend } from '../../src/pty.mts'
import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'
import { test } from 'vitest'
import { dirname, resolve } from 'node:path'
import { spawn, spawnPty, spawnSync } from '../../src/index.mts'

const fixture = resolve(import.meta.dirname, 'fixture.mts')
const node = process.execPath
const enter = process.platform === 'win32' ? '\r' : '\n'
const env = {
  PATH: process.env.PATH ?? '/bin:/usr/bin',
  TEST_MARKER: 'ffi-pty-test',
  ...(process.platform === 'win32'
    ? {
        SystemRoot: process.env.SystemRoot ?? '',
        WINDIR: process.env.WINDIR ?? '',
      }
    : {}),
}
const timeout = { timeout: 10_000 }
const stripTerminalControls = (value: string) =>
  value.replace(
    /\u001B(?:\][^\u0007]*(?:\u0007|\u001B\\)|\[[0-?]*[ -/]*[@-~])/g,
    '',
  )

function capture(pty: Awaited<ReturnType<typeof spawnPty>>) {
  let text = ''
  pty.onData(chunk => {
    text += chunk
  })
  return {
    get text() {
      return text
    },
    async until(re: RegExp, ms = 5000) {
      const end = Date.now() + ms
      while (Date.now() < end) {
        if (re.test(text)) return text
        await delay(5)
      }
      throw new Error(
        `Timed out waiting for ${re}: ${JSON.stringify(text.slice(-300))}`,
      )
    },
  }
}

async function dispose(pty: Awaited<ReturnType<typeof spawnPty>>) {
  await pty.close()
}

test(
  'child has PTY stdio and receives args, environment, cwd and initial size',
  timeout,
  async () => {
    const cwd = process.cwd()
    const pty = await spawnPty(node, [fixture, 'echo', 'arg one', '🐸'], {
      cwd,
      env,
      cols: 93,
      rows: 31,
    })
    const out = capture(pty)
    try {
      const info = await out.until(/INFO:/)
      const payload = JSON.parse(info.match(/INFO:(\{[^\r\n]+\})/)![1])
      assert.deepEqual(payload.argv, ['arg one', '🐸'])
      assert.equal(payload.cwd, cwd)
      assert.equal(payload.marker, 'ffi-pty-test')
      assert.deepEqual(payload.tty, [true, true, true])
      assert.deepEqual(payload.size, [93, 31])
      if (process.platform !== 'win32') {
        assert.equal(payload.controllingTty, true)
      }
      await out.until(/ECHO_READY/)
      await pty.write(`café 🐸${enter}`)
      assert.match(await out.until(/ECHO:/), /ECHO:"café 🐸"/)
      assert.deepEqual(await pty.exited, { exitCode: 0, signal: 0 })
    } finally {
      await dispose(pty)
    }
  },
)

test(
  'spawn resolves after startup and async iteration yields output through exit',
  timeout,
  async () => {
    const pty = await spawn(node, [fixture, 'exit', '13'], { env })
    let output = ''
    try {
      for await (const chunk of pty) output += chunk
      assert.match(output, /BEFORE_EXIT/)
      assert.deepEqual(await pty.exited, { exitCode: 13, signal: 0 })
    } finally {
      await pty.close()
    }
  },
)

test(
  'spawnSync returns the terminal immediately and supports async iteration',
  timeout,
  async () => {
    const pty = spawnSync(node, [fixture, 'exit', '0'], { env })
    assert.equal(typeof (pty as unknown as Promise<unknown>).then, 'undefined')
    await pty.ready
    let output = ''
    try {
      for await (const chunk of pty) output += String(chunk)
      assert.match(output, /BEFORE_EXIT/)
      assert.equal((await pty.exited).exitCode, 0)
    } finally {
      await pty.close()
    }
  },
)

test('AbortSignal closes a running promise-based PTY', timeout, async () => {
  const controller = new AbortController()
  const pty = await spawn(node, ['-e', 'setInterval(()=>{},1000)'], {
    env,
    signal: controller.signal,
  })
  controller.abort()
  await pty.exited
  await pty.close()
})

test('spawn rejects immediately for an already aborted signal', async () => {
  const controller = new AbortController()
  const reason = new Error('cancel before launch')
  controller.abort(reason)
  await assert.rejects(
    spawn(node, ['-e', 'setInterval(()=>{},1000)'], {
      env,
      signal: controller.signal,
    }),
    error => error === reason,
  )
})

test(
  'output is delivered before exit and normal exit status is preserved',
  timeout,
  async () => {
    const pty = await spawnPty(node, [fixture, 'exit', '13'], { env })
    const out = capture(pty)
    try {
      assert.match(await out.until(/BEFORE_EXIT/), /BEFORE_EXIT/)
      assert.deepEqual(await pty.exited, { exitCode: 13, signal: 0 })
      assert.match(out.text, /BEFORE_EXIT/)
    } finally {
      await dispose(pty)
    }
  },
)

test('large child output is drained without truncation', timeout, async () => {
  const pty = await spawnPty(node, [fixture, 'large', '262144'], { env })
  const out = capture(pty)
  try {
    await out.until(/ENDLARGE/)
    const text = stripTerminalControls(out.text)
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
    const chunks = [...text.matchAll(/^CHUNK:(\d{4}):(x+)$/gm)]
    assert.equal(chunks.length, 8192)
    assert.equal(
      chunks.reduce((length, chunk) => length + chunk[2].length, 0),
      262_144,
    )
    chunks.forEach((chunk, index) => {
      assert.equal(Number(chunk[1]), index)
      assert.equal(chunk[2].length, 32)
    })
    assert.match(text, /ENDLARGE/)
    assert.equal((await pty.exited).exitCode, 0)
  } finally {
    await dispose(pty)
  }
})

test(
  'large parent input is written completely',
  { timeout: process.platform === 'win32' ? 30_000 : timeout.timeout },
  async () => {
    const size = 256 * 1024
    const pty = await spawnPty(node, [fixture, 'large-input', String(size)], {
      env,
    })
    const out = capture(pty)
    try {
      await out.until(/INFO:/)
      await out.until(/INPUT_READY/)
      await pty.write(Buffer.alloc(size, 120))
      assert.match(
        await out.until(
          /HEARTBEAT:/,
          process.platform === 'win32' ? 10_000 : 5000,
        ),
        /HEARTBEAT:/,
      )
      const inputPattern = new RegExp(`INPUT:${size}`)
      assert.match(
        await out.until(
          inputPattern,
          process.platform === 'win32' ? 25_000 : 5000,
        ),
        inputPattern,
      )
      assert.equal((await pty.exited).exitCode, 0)
    } finally {
      await dispose(pty)
    }
  },
)

test('pause and resume control data delivery', timeout, async () => {
  const pty = await spawnPty(node, [fixture, 'exit', '0'], { env })
  const out = capture(pty)
  try {
    pty.pause()
    await delay(100)
    assert.equal(out.text, '')
    pty.resume()
    assert.match(await out.until(/BEFORE_EXIT/), /BEFORE_EXIT/)
    assert.equal((await pty.exited).exitCode, 0)
  } finally {
    await dispose(pty)
  }
})

test(
  'concurrent sessions keep input and output isolated',
  timeout,
  async () => {
    const a = await spawnPty(node, [fixture, 'echo'], {
      env: { ...env, TEST_MARKER: 'session-a' },
    })
    const ao = capture(a)
    let b: Awaited<ReturnType<typeof spawnPty>> | undefined
    try {
      const second = await spawnPty(node, [fixture, 'echo'], {
        env: { ...env, TEST_MARKER: 'session-b' },
      })
      b = second
      const bo = capture(second)
      await Promise.all([ao.until(/ECHO_READY/), bo.until(/ECHO_READY/)])
      await Promise.all([a.write(`alpha${enter}`), b.write(`beta${enter}`)])
      assert.match(await ao.until(/ECHO:/), /ECHO:"alpha"/)
      assert.match(await bo.until(/ECHO:/), /ECHO:"beta"/)
      assert.doesNotMatch(ao.text, /ECHO:"beta"/)
      assert.doesNotMatch(bo.text, /ECHO:"alpha"/)
      await Promise.all([a.exited, b.exited])
    } finally {
      await Promise.all([dispose(a), ...(b ? [dispose(b)] : [])])
    }
  },
)

test(
  'resize updates the terminal dimensions',
  { ...timeout, skip: process.platform === 'win32' },
  async () => {
    const pty = await spawnPty(node, [fixture, 'echo'], { env })
    const out = capture(pty)
    try {
      await out.until(/INFO:/)
      await pty.resize(117, 43)
      assert.equal(pty.cols, 117)
      assert.equal(pty.rows, 43)
      assert.match(await out.until(/RESIZED:/), /RESIZED:\[117,43\]/)
      await pty.write(`resize-check${enter}`)
      assert.match(await out.until(/ECHO:"resize-check"/), /SIZE:\[117,43\]/)
    } finally {
      await dispose(pty)
    }
  },
)

test("bare command lookup uses the child's PATH and cwd", timeout, async () => {
  const pty = await spawnPty('node', [fixture, 'exit', '0'], {
    env: { ...env, PATH: dirname(process.execPath) },
  })
  const out = capture(pty)
  try {
    assert.match(await out.until(/BEFORE_EXIT/), /BEFORE_EXIT/)
    assert.equal((await pty.exited).exitCode, 0)
  } finally {
    await dispose(pty)
  }
})

test('explicit termination reports its signal', timeout, async () => {
  const pty = await spawnPty(node, [fixture, 'echo'], { env })
  const out = capture(pty)
  try {
    await out.until(/INFO:/)
    await pty.kill('SIGTERM')
    assert.deepEqual(await pty.exited, { exitCode: null, signal: 15 })
  } finally {
    await dispose(pty)
  }
})

test('repeated PTY sessions can exit or be killed', timeout, async () => {
  const fdDirectory = process.platform === 'linux' ? '/proc/self/fd' : '/dev/fd'
  const count =
    process.platform === 'win32'
      ? undefined
      : () => readdirSync(fdDirectory).length
  const before = count?.()
  for (let i = 0; i < 3; i++) {
    const exited = await spawnPty(node, [fixture, 'exit', '0'], { env })
    try {
      assert.equal((await exited.exited).exitCode, 0)
    } finally {
      await dispose(exited)
    }

    const pty = await spawnPty(node, [fixture, 'stall-input'], { env })
    const out = capture(pty)
    try {
      await out.until(/STALL_READY/)
      await pty.kill('SIGTERM')
      assert.deepEqual(await pty.exited, { exitCode: null, signal: 15 })
    } finally {
      await dispose(pty)
    }
  }
  if (count) assert.equal(count(), before)
})

test(
  'an existing executable with a missing child cwd fails cleanly',
  timeout,
  async () => {
    const fdDirectory =
      process.platform === 'linux' ? '/proc/self/fd' : '/dev/fd'
    const count =
      process.platform === 'win32'
        ? undefined
        : () => readdirSync(fdDirectory).length
    const before = count?.()
    await assert.rejects(
      spawnPty(node, [fixture, 'exit', '0'], {
        cwd: resolve(process.cwd(), 'missing-ffi-pty-cwd'),
        env,
      }),
    )
    assert.equal(count?.(), before)
  },
)

test(
  'resize updates both dimensions atomically before SIGWINCH reaches the foreground child',
  {
    ...timeout,
    skip: process.platform === 'win32',
  },
  async () => {
    const pty = await spawnPty(node, [fixture, 'winch'], { env })
    const out = capture(pty)
    try {
      await out.until(/WINCH_READY/)
      await pty.resize(119, 45)
      assert.match(await out.until(/WINCH:/), /WINCH:\[119,45\]/)
    } finally {
      await dispose(pty)
    }
  },
)

test('write queue rejects payloads larger than 8 MiB', timeout, async () => {
  const pty = await spawnPty(node, [fixture, 'stall-input'], { env })
  const out = capture(pty)
  try {
    await out.until(/STALL_READY/)
    await assert.rejects(
      pty.write(Buffer.alloc(8 * 1024 * 1024 + 1)),
      /8 MiB|queue limit/i,
    )
  } finally {
    await dispose(pty)
  }
})

test('close unblocks an in-flight large write', timeout, async () => {
  const pty = await spawnPty(node, [fixture, 'stall-input'], { env })
  const out = capture(pty)
  try {
    await out.until(/STALL_READY/)
    const writeResult = pty.write(Buffer.alloc(7 * 1024 * 1024, 120)).then(
      () => ({ fulfilled: true }),
      (error: Error) => ({ fulfilled: false, error }),
    )
    await delay(50)
    await pty.close()
    assert.equal((await writeResult).fulfilled, false)
    assert.ok((await pty.exited).signal > 0)
  } finally {
    await dispose(pty)
  }
})

test(
  'Ctrl-C is delivered through the terminal foreground process group',
  { ...timeout, skip: process.platform === 'win32' },
  async () => {
    const pty = await spawnPty(node, [fixture, 'ctrlc'], { env })
    const out = capture(pty)
    try {
      await out.until(/CTRL_C_READY/)
      await pty.write('\x03')
      assert.match(await out.until(/INTERRUPTED/), /INTERRUPTED/)
      assert.deepEqual(await pty.exited, { exitCode: 23, signal: 0 })
    } finally {
      await dispose(pty)
    }
  },
)

test('close terminates a live child and settles exit', timeout, async () => {
  const pty = await spawnPty(node, [fixture, 'echo'], { env })
  try {
    await delay(50)
    await pty.close()
    const status = await pty.exited
    assert.ok(status.signal > 0 || status.exitCode !== null)
  } finally {
    await dispose(pty)
  }
})

test(
  'failed spawn and invalid input leave no file descriptors behind',
  {
    ...timeout,
    skip: process.platform === 'win32',
  },
  async () => {
    const fdDirectory =
      process.platform === 'linux' ? '/proc/self/fd' : '/dev/fd'
    const count = () => readdirSync(fdDirectory).length
    const before = count()
    for (let i = 0; i < 5; i++) {
      await assert.rejects(spawnPty('/no-such-ffi-pty-command', [], { env }))
      await assert.rejects(spawnPty(node, ['bad\0arg'], { env }))
    }
    assert.equal(count(), before)
  },
)

test(
  'own __proto__ environment entries reach the target on every platform (#993)',
  timeout,
  async () => {
    const pty = await spawnPty(
      node,
      ['-e', 'console.log("SPECIAL:" + process.env["__proto__"])'],
      {
        env: { ...env, ...JSON.parse('{"__proto__":"preserved"}') },
      },
    )
    const out = capture(pty)
    try {
      assert.equal((await pty.exited).exitCode, 0)
      assert.match(out.text, /SPECIAL:preserved/)
    } finally {
      await dispose(pty)
    }
  },
)

test(
  'oversized argv spawn failures release both PTY descriptors (#950)',
  { ...timeout, skip: process.platform === 'win32' },
  async () => {
    const directory = process.platform === 'linux' ? '/proc/self/fd' : '/dev/fd'
    // Warm up native bindings before comparing descriptors.
    const warmup = await spawnPty(node, ['-e', ''], { env })
    capture(warmup)
    await warmup.exited
    await dispose(warmup)
    const baseline = readdirSync(directory).length
    for (let i = 0; i < 5; i++) {
      await assert.rejects(
        spawnPty(node, ['-e', 'x'.repeat(3 * 1024 * 1024)], { env }),
        /posix_spawn/,
      )
      assert.equal(readdirSync(directory).length, baseline)
    }
  },
)

test(
  'concurrent kill and close settle without duplicate cleanup or late output (#983, #72)',
  timeout,
  async () => {
    for (let i = 0; i < 3; i++) {
      const pty = await spawnPty(node, [fixture, 'echo'], { env })
      let exited = false
      let lateData = false
      pty.onData(() => {
        if (exited) lateData = true
      })
      pty.onExit(() => {
        exited = true
      })
      try {
        // Backends may reject a redundant command once shutdown begins; none may
        // crash the host or leave cleanup unresolved.
        await Promise.allSettled([pty.kill(), pty.kill(), pty.close()])
        await pty.exited
        await assert.rejects(pty.write('after exit'), /closed|exited/i)
        await assert.rejects(pty.resize(80, 24), /closed|exited/i)
        await delay(20)
        assert.equal(lateData, false)
      } finally {
        await dispose(pty)
      }
    }
  },
)

test('backend loading rejects unsupported runtimes and platforms before loading native code', () => {
  const load = () => {
    throw new Error('must not load')
  }
  for (const version of ['25.9.0', '26.3.0']) {
    assert.throws(
      () => loadPlatformBackend(version, 'darwin', 'arm64', load),
      /requires Node/,
    )
  }
  for (const [os, arch] of [
    ['freebsd', 'x64'],
    ['linux', 'ia32'],
  ]) {
    assert.throws(
      () => loadPlatformBackend('26.4.0', os, arch, load),
      /Unsupported/,
    )
  }
  const cause = new Error('missing native library')
  assert.throws(
    () =>
      loadPlatformBackend('26.4.0', 'linux', 'x64', () => {
        throw cause
      }),
    error =>
      error instanceof Error &&
      error.cause === cause &&
      /backend unavailable/.test(error.message),
  )
  for (const os of ['darwin', 'linux', 'win32']) {
    const backend = { createBackend: () => {} }
    assert.equal(
      loadPlatformBackend('26.4.0', os, 'x64', file => {
        assert.equal(file, `./${os}/${os === 'win32' ? 'windows' : os}.mts`)
        return backend
      }),
      backend,
    )
  }
})
