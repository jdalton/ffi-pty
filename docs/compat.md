# Node-pty-compatible API

Import from `ffi-pty/compat` to use the pinned node-pty public API. This is the drop-in entry point:

```js
import * as pty from 'ffi-pty/compat'

const terminal = pty.spawn(process.execPath, ['-e', 'console.log("Hello!")'])
terminal.onData(data => process.stdout.write(data))
```

The entry point exports `spawn`, `fork`, `createTerminal`, and the node-pty option, terminal, event, and disposable types. The declarations are checked against the [pinned node-pty contract](../test/fixtures/node-pty.d.mts) and upstream tests run in CI on each supported platform.

## Options

| Option                                  | Default                        | Purpose                                                        |
| --------------------------------------- | ------------------------------ | -------------------------------------------------------------- |
| `cols`, `rows`                          | `80`, `24`                     | Terminal size in cells.                                        |
| `cwd`                                   | Current directory              | Child working directory.                                       |
| `env`                                   | Current environment            | Replacement environment; undefined values are omitted.         |
| `name`                                  | `env.TERM` or platform default | Unix `TERM`; Windows terminal name.                            |
| `encoding`                              | `utf8`                         | Text encoding, or `null` for raw Buffer input and output.      |
| `uid`, `gid`                            | Current user/group             | Unix child credentials.                                        |
| `handleFlowControl`                     | `false`                        | Consume pause/resume messages instead of sending them.         |
| `flowControlPause`, `flowControlResume` | XOFF, XON                      | Whole-message flow-control strings.                            |
| `useConptyDll`                          | `false`                        | Use our bundled ConPTY on Windows. No download.                |
| `conptyInheritCursor`                   | `false`                        | Request cursor inheritance on Windows.                         |

The deprecated `useConpty` option is accepted and ignored, as in current node-pty. The optional `signal` field is an ffi-pty addition; aborting it closes the terminal.

## Terminal methods and events

| Member                           | Purpose                                                                          |
| -------------------------------- | -------------------------------------------------------------------------------- |
| `pid`, `cols`, `rows`, `process` | Child ID, dimensions, and process title.                                         |
| `onData(listener)`               | Receive output chunks; returns a disposable subscription.                        |
| `onExit(listener)`               | Receive `{ exitCode, signal? }` after output drains.                             |
| `write(data)`                    | Send a string or Buffer; returns void.                                           |
| `resize(cols, rows, pixelSize?)` | Resize; optional pixel dimensions apply on Unix. Returns void.                   |
| `kill(signal?)`                  | Default `SIGHUP` on Unix. Windows rejects explicit signals. Returns void.        |
| `pause()`, `resume()`            | Control output delivery.                                                         |
| `handleFlowControl`              | Enable or disable automatic flow control.                                        |
| `clear()`                        | Clear bundled ConPTY's buffer; otherwise a no-op.                                |
| `setParentWindow(handle)`        | Set the Windows host window with bundled ConPTY. Pass an eight-byte HWND Buffer. |

ffi-pty adds `ready` and `exited` promises, `close()`, and async iteration to the terminal handle. Attach `onData` immediately; data arrives in chunks, not lines. Pausing output can delay exit delivery until you resume it.

## Platform requirements

The compatible API still requires Node.js 26.4+ with `--experimental-ffi`. See [platform support](platforms.md).
