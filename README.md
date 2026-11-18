# ffi-pty

<picture><img src="assets/repo/coverage.svg?v=66258ab9f3b4" height="20" alt="Coverage" /></picture>

Run programs in a pseudoterminal from Node.js on macOS, Linux, and Windows. `ffi-pty` uses Node's built-in FFI, has no runtime dependencies, and ships its Windows ConPTY runtime so Windows users need no startup download.

Inspired by [node-pty](https://github.com/microsoft/node-pty) and [@lydell/node-pty](https://github.com/lydell/node-pty).

## Install

Requires Node.js 26.4+ with `--experimental-ffi`.

```sh
pnpm add ffi-pty
```

## Usage

Run your app with `node --experimental-ffi app.mjs`. The preferred API is promise-based: `spawn()` waits for startup, accepts an `AbortSignal`, and returns a terminal you can consume with events or `for await`.

```js
import { spawn } from 'ffi-pty'

const terminal = await spawn(process.execPath, ['-e', 'console.log("Hello!")'])
try {
  for await (const chunk of terminal) process.stdout.write(chunk)
} finally {
  await terminal.close()
}
```

<details>
<summary>Using Node <code>--permission</code></summary>

When Node's permission model is enabled, pass `--allow-ffi` to allow `ffi-pty` to use FFI:

```sh
node --permission --allow-ffi --experimental-ffi app.mjs
```

</details>

<details>
<summary>Focused imports</summary>

- `ffi-pty/spawn` imports the Promise-based spawning API from its implementation module.
- `ffi-pty/open` imports `openUnixPty()` for raw Unix PTY pairs.
- `ffi-pty/compat` imports the node-pty-style API and types.

The focused subpaths map to implementation modules; only the compatibility surface needs a small adapter to gather its API and types. See [all entry points](docs/api.md#entry-points).

</details>

<details>
<summary>Node-pty compatibility</summary>

For a node-pty-compatible API, change the import to `ffi-pty/compat`. It exports the pinned node-pty API with the same `spawn()` behavior.

- [Compatible API and migration notes](docs/compat.md)

</details>

<details>
<summary>Additional API and compatibility notes</summary>

- [Main API: spawn variants, cancellation, and iteration](docs/api.md)
- [Node-pty API methods and platform notes](docs/compat.md#terminal-methods-and-events)

</details>

<details>
<summary>Platform support</summary>

- [Operating system requirements](docs/platforms.md)
- [Windows backends and helpers](docs/platforms.md#windows)

</details>

<details>
<summary>Development</summary>

- [Setup, builds, and tests](docs/development.md)
- [Windows signing for maintainers](docs/signing.md)

</details>

License: MIT
