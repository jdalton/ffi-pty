# Agent guidance

Read [.vowen/AGENTS.md](.vowen/AGENTS.md) before changing this repository. It contains the repository's engineering policies.

## Repository map

| Task                             | Start here                                                                                                               |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Install or use the package       | [README](README.md) and [API](docs/api.md)                                                                               |
| Change public behavior           | [Public exports](src/index.mts), [spawn](src/pty.mts), [contract](src/contract.mts), [events](src/events.mts)            |
| Change platform behavior         | [Platform guide](docs/platforms.md), then [macOS](src/darwin/darwin.mts), [Linux](src/linux/linux.mts), or [Windows](src/win32/windows.mts) |
| Build, test, or measure coverage | [Development](docs/development.md)                                                                                       |
| Change signing                   | [Maintainer signing guide](docs/signing.md)                                                                              |

Tests mirror source paths under `test/`. Shared tool configuration lives in `.config/`; workflow definitions live in `.github/workflows/`.
