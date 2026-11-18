# Contributing and local development

## Setup

```sh
pnpm install
```

Installation sets up the pre-push hook. Run `pnpm run setup` to reinstall it. Existing custom hooks are preserved.

## Build

```sh
pnpm run build
```

The build writes readable JavaScript to `dist/`. `pnpm pack` builds and packages
it. For the optional Windows helper build, see
[platform support](platforms.md#optional-c-helper). Maintainer signing and
verification steps are in [Windows helper signing](signing.md).

## Test

| Command               | Runs                                        |
| --------------------- | ------------------------------------------- |
| `pnpm test`           | Fast unit tests.                            |
| `pnpm run test:mid`   | Isolated tests and tests that use mocks.    |
| `pnpm run test:slow`  | Native process and terminal tests.          |
| `pnpm run test:all`   | All three lanes.                            |
| `pnpm run test:build` | Repository tooling and the built package.   |
| `pnpm run check`      | Formatting, lint, policy checks, and tests. |

[Lane settings](../scripts/test-lanes.mts) define test groups and time limits. Tests mirror source paths under `test/`. Unit tests block live network access and use `nock` for HTTP fixtures.

## CI runners

Platform code lives in `src/darwin/`, `src/linux/`, and `src/win32/`, with matching test directories. Shared Unix helpers stay at the source root. Architecture-specific code belongs in `<platform>/x64/` or `<platform>/arm64/`. Linux libc variants use `linux/<libc>/<architecture>/`. Create those directories only when they contain specific code; keep shared implementations in their parent directory.

Routine CI selects one runner per affected OS and architecture. Shared platform code selects both architectures; shared repository code or an unavailable diff selects all supported OS/architecture pairs; prose-only changes run repository checks on Linux. Moves check both the old and new paths. ConPTY assets select their Windows architecture. Older Windows versions stay in the full matrix.

The [runner catalog](../scripts/ci/targets.mts) records OS, architecture, and libc. Linux currently supports glibc only. A musl-specific path fails planning until a real musl runtime and runner are configured; it never substitutes a glibc run.

Run [ci.yml](../.github/workflows/ci.yml) manually to select one runner, a platform group, or `all`. Published releases run all seven runners. The fast, mid, and slow test lanes stay separate.

## Coverage

CI collects coverage during the fast, mid, slow, build, and integration tests, then validates and combines reports per runner. Windows also tests without the optional helper before building it. For release review, run [ci.yml](../.github/workflows/ci.yml) with target `all` and `coverage-gate` enabled. Routine runs warn below the target; invalid or missing evidence always fails.

Node's test runner and `c8` collect JavaScript/MTS coverage. The [coverage config](../.config/coverage.json) defines the threshold and exclusions. The gate checks lines and branches separately on each platform and architecture. Native C++ coverage is not included.

Reports combine unit, integration, and tooling runs. The gate accepts only successful runs with matching source files. Update the local SVG badge after a full pass. It shows the lowest platform line coverage, rounded to an integer.

## Project rules

See [AGENTS.md](../AGENTS.md) for coding rules.

## Update bundled ConPTY

Run `pnpm run update` to check NuGet for a newer stable ConPTY release. The updater respects the release-age gate in [external-tools.json](../.config/external-tools.json), verifies NuGet's archive hash, and rebuilds both architectures' compressed assets. It then runs package checks. Commit the metadata and assets together.

`conpty.dll` and `OpenConsole.exe` always come from the same release. Builds verify the committed files without network access. Package users never download them at startup. See [the updater](../scripts/update/conpty.mts) and its mirrored tests.

## Sync upstream tests

`upstream/node-pty` is a pinned, shallow, sparse submodule initialized when update or test sync needs it. Install, setup, and normal tests never initialize or
fetch it. Local tests and fixtures remain committed and run independently.

- `pnpm run upstream:sync` imports fixtures from the pinned revision.
- `pnpm run update` runs `scripts/update/*`, including upstream test updates.
- `node scripts/update/upstream.mts` updates only upstream tests and stages the new pin.

Review changed assertions and adapt the local tests before committing the pin
and fixtures together. All upstream test cases have local adaptations under `test/upstream/node-pty/src/`.
The suite checks every case is registered, including both Windows ConPTY variants.
A separate hash check requires review whenever upstream assertions change.
Original sources and the MIT license are preserved beside the adaptations.

Repository commands are grouped by purpose under `scripts/check/`, `scripts/fix/`,
`scripts/lint/`, `scripts/fmt/`, and `scripts/update/`. Tests mirror those paths.
