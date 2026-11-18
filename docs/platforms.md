# Platform support

`ffi-pty` supports macOS, Linux, and Windows on x64 and ARM64. All platforms require Node.js 26.4+ with `--experimental-ffi`.

| Platform | Requirements                                                                              |
| -------- | ----------------------------------------------------------------------------------------- |
| macOS    | Uses the built-in terminal APIs and `/bin/stty`.                                          |
| Linux    | Requires glibc 2.34+ and `stty`.                                                          |
| Windows  | Requires Windows 10 1809+ or Windows Server 2019+. Uses ConPTY, the Windows terminal API. |

## macOS and Linux

Both platforms use system APIs to create terminals and `stty` to resize them.

On macOS, a small Node process starts the requested program. `spawnPty()` waits for the requested program to start and rejects if startup fails. A program that starts successfully can still exit with code 127.

## Windows

`ffi-pty` selects the backend from the Windows build number:

| Windows build | Backend                                                           |
| ------------- | ----------------------------------------------------------------- |
| 17763–26099   | A separate Node process, or the signed C++ helper when available. |
| 26100+        | A worker inside your Node process. No helper process.             |
| Below 17763   | Unsupported.                                                      |

Build 26100 includes Windows 11 24H2 and Server 2025. Older builds need a separate process to contain a [Windows terminal resource leak](https://github.com/microsoft/terminal/issues/17903#issuecomment-2343499050). When that process exits, Windows releases its resources.

All Windows backends close the terminal's child processes during cleanup. Worker threads keep blocking Windows terminal calls off your application's main thread.

### Optional C++ helper

The helper replaces the extra Node process on older Windows builds. `ffi-pty` checks its signature and publisher before running it. Missing files, failed checks, or verification timeouts select the Node fallback.

Verification uses Windows PowerShell and can request certificate information over the network. The result is cached until your application exits. Restart your application after updating the helper.

To build the helper, install Visual Studio C++ tools and run:

```sh
pnpm run build:windows-helper
```

The executable goes to `build/ffi-pty/win32-<arch>/helper.exe`. Use `--arch=x64` or `--arch=arm64` to choose a target. Terminal startup never builds or downloads it.

See [Windows signing](signing.md) for maintainer signing and verification steps.

### Bundled ConPTY

Pass `{ useConptyDll: true }` to `spawn()` to use the pinned Microsoft DLL and `OpenConsole.exe`. Both x64 and ARM64 assets are Brotli-compressed in the package. First use extracts the current architecture synchronously into the user's local application-data cache; later uses verify and reuse it.

On NTFS, extraction requests filesystem compression before writing. Unsupported filesystems retain ordinary files. The original signed bytes are preserved in either case. Extraction needs filesystem access when Node's permission model is enabled; no network permission is needed.
