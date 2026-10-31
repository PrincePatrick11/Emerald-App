# Emerald

Emerald is a private desktop workspace for magical practice: journal, wiki, operations with sigils, altar, tasks and a lexicon for your own languages, with templates and custom blocks, all in encrypted vaults. This repository is where it is developed; [`Documentation/features.md`](Documentation/features.md) describes what the app does.

Built with Tauri 2, React 19 and SQLCipher, for macOS, Windows and Linux. Emerald is in early development: expect breaking changes between versions and back up your data.

## Download

Pre-built binaries are on the [Releases](../../releases) page.

| Platform | What is built |
|---|---|
| macOS | Apple Silicon only, macOS 13 Ventura or newer |
| Windows | x64, `.exe` (NSIS) and `.msi` |
| Linux | x64, `.deb` and `.AppImage`, built on Ubuntu 22.04 |

The macOS app is not notarised. On first launch, right-click it in Finder, choose **Open** and confirm, or run `sudo xattr -cr "/Applications/Emerald App.app"`. On Windows, SmartScreen may warn: choose **More info**, then **Run anyway**.

## Development

Requires Node.js 22 or newer, the Rust toolchain, the [Tauri prerequisites](https://tauri.app/start/prerequisites/), and Perl and `make` for the SQLCipher build; see [`CONTRIBUTING.md`](CONTRIBUTING.md#development-setup).

```bash
npm install
npm run tauri:dev     # dev build with its own identity and database
npm run check         # everything the frontend CI job runs
npm run tauri build   # production build
```

`npm run tauri build` needs the updater signing key, see [Manual builds](Documentation/build.md#manual-builds--the-dress-rehearsal).

Work happens on the branch of the version in progress, `version/x.y.z`, not on `main`. [`CONTRIBUTING.md`](CONTRIBUTING.md#branches-and-releases) has the rules. Coding assistants start at [`AGENTS.md`](AGENTS.md).

## Documentation

| Document | Description |
|---|---|
| [Documentation/features.md](Documentation/features.md) | Full feature guide |
| [Documentation/architecture.md](Documentation/architecture.md) | Architecture overview: module map, data flow, IPC |
| [Documentation/architecture/](Documentation/architecture/) | Per-area patterns: modules, editing, blocks, templates, navigation, altar, storage, appearance, window shell |
| [Documentation/design.md](Documentation/design.md) | Design tokens, component patterns, and known inconsistencies |
| [Documentation/components.md](Documentation/components.md) | Shared UI building blocks and when to use them |
| [Documentation/database.md](Documentation/database.md) | SQLite schema and conventions |
| [Documentation/internationalization.md](Documentation/internationalization.md) | Adding and managing translations |
| [Documentation/security.md](Documentation/security.md) | Capability model and sandboxing |
| [Documentation/build.md](Documentation/build.md) | CI, build and release pipeline |
| [Documentation/agents.md](Documentation/agents.md) | The review agents for coding assistants and when to use which |
| [Documentation/mcp.md](Documentation/mcp.md) | The MCP server that lets an assistant drive the running app |

## License

Copyright (C) 2024–2026 Lukas Reuter

This program is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version. See [LICENSE](LICENSE) for the full text.
