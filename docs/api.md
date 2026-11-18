# API

## Entry points

| Import path | Exports | Use it for |
| --- | --- | --- |
| `ffi-pty` | Promise-based `spawn()`, `spawnSync()`, and terminal types | Preferred API for new code, with an explicit compatibility variant. |
| `ffi-pty/spawn` | `spawnPty()` and lower-level spawn helpers | Direct access to the Promise-based implementation module. |
| `ffi-pty/compat` | node-pty-style `spawn()`, `fork()`, `createTerminal()`, and types | Migrating existing node-pty call sites. |
| `ffi-pty/open` | `openUnixPty()` | Working directly with a raw PTY pair on Unix. |

The `spawn` and `open` subpaths target their implementation modules directly. `compat` has a small adapter so its functions and node-pty types are presented as one API surface.

## `spawn()`

`await spawn(file, args, options)` resolves with a terminal after startup succeeds and rejects if startup fails. The returned `FfiPty` has promise-based `write`, `resize`, `kill`, and `close` methods. `spawnPty()` remains an alias for `spawn()`.

```js
const terminal = await spawn(process.execPath, ['-e', 'console.log("ready")'], {
  signal: controller.signal,
})
```

Pass an `AbortSignal` in `options.signal` to stop the terminal. If it aborts before startup completes, `spawn()` rejects with the signal's reason. If it aborts after startup, ffi-pty closes the terminal.

## `spawnSync()`

`spawnSync(file, args, options)` returns a terminal handle immediately. It does not block until the child exits. Await `terminal.ready` to observe startup and use `terminal.exited` for the exit status. Its `write`, `resize`, and `kill` methods follow the node-pty synchronous interface. It accepts `signal` to close the child when aborted.

Use [`ffi-pty/compat`](compat.md) when replacing node-pty without changing the existing `spawn()` call sites.

## Output iteration

Both terminal handles support async iteration:

```js
for await (const chunk of terminal) {
  process.stdout.write(chunk)
}
```

Iteration yields output chunks and ends after output drains. Breaking from the loop removes the iterator's listener; it does not close the terminal. Call `close()` when the terminal should stop.

## Other APIs

`open()` opens a raw Unix PTY pair and returns its master and slave streams. Destroy both streams when finished. The private native addon API is not provided. Node's FFI flag and [platform requirements](platforms.md) still apply.

The Windows `setParentWindow()` method is available on the synchronous terminal handle when using the bundled ConPTY DLL. Native Windows CI covers this path.
