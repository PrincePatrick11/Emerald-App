# Working in This Repository

Entry point for coding assistants. It says where things are and which rules apply; the details live in the files it links to.

## Map

| Path | What |
| --- | --- |
| `src/` | React frontend |
| `src-tauri/` | Rust backend and Tauri configuration |
| `scripts/` | Setup scripts for the agents and the MCP server, run with `node` |
| `tools/agents/` | Review and maintenance agents, see [`Documentation/agents.md`](Documentation/agents.md) |
| `tools/mcp/` | MCP server that drives a running instance, see [`Documentation/mcp.md`](Documentation/mcp.md) |
| `Documentation/` | How Emerald works today. Start at [`architecture.md`](Documentation/architecture.md) |

## Setup

Every fresh checkout or git worktree needs `npm install`; the prerequisites are in [Development Setup](CONTRIBUTING.md#development-setup).

`npm run agents:link` makes the review agents available, see [Setting Them Up](Documentation/agents.md#setting-them-up). `npm run mcp:register` registers the MCP server, see [Registration](Documentation/mcp.md#registration); it also needs Python 3.10 or newer and [uv](https://github.com/astral-sh/uv), see [Requirements](Documentation/mcp.md#requirements). If its tools are missing, say so rather than reporting a change as tested in the app.

## Rules

- Work on the branch of the version in progress, `version/<version>` (four-part in 0.1.3.x, such as `version/0.1.3.7`), never on `main`.
- Follow the code conventions in [`CONTRIBUTING.md`](CONTRIBUTING.md#guidelines).
- A behaviour change updates `Documentation/` in the same change and adds a line to the open section at the top of `CHANGELOG.md`, `## [<version>] - Unreleased`.
- The dev bridge (Cargo feature `devbridge`, `src-tauri/src/devbridge.rs`) never reaches a release build; a `compile_error!` in `src-tauri/src/lib.rs` refuses it without debug assertions.
- Code, comments, log messages, commit messages and docs are in English. The one exception is `Documentation/design.md`, which is written in German; keep it in German when you edit it.
- Assistant-specific files stay local and ignored: `.claude/`, `.mcp.json`, `CLAUDE.md`.

## Where to Look First

The long documents are references: read the section you need, not the whole file. Where a document and the code disagree, the code is right: correct the document in the same change.

| Change | Read |
| --- | --- |
| Database schema or migration | [Rules for Future Schema Changes](Documentation/database.md#rules-for-future-schema-changes) and [Migration Model](Documentation/database.md#migration-model) |
| A new module or table | [`database.md`](Documentation/database.md), including the [backup format](Documentation/database.md#db-backup--restore-emeralddb), and the [Module Map](Documentation/architecture.md#module-map) |
| An existing module | [`architecture.md`](Documentation/architecture.md) and [`features.md`](Documentation/features.md) |
| UI | [`design.md`](Documentation/design.md) and [Theming System](Documentation/architecture.md#theming-system) |
| User-visible text | [`internationalization.md`](Documentation/internationalization.md); it goes into all four locale files |
| Tauri commands, files | [`security.md`](Documentation/security.md) and [IPC Command Surface](Documentation/architecture.md#ipc-command-surface) |
| CI or a release | `.github/workflows/release.yml` and `manual-desktop-builds.yml`; there is no push-triggered CI |

## Checks

There are no check scripts and no automated tests of the app in this version. Run before calling a change done:

```bash
npx tsc --noEmit -p .
cargo check --manifest-path src-tauri/Cargo.toml
```

`cargo check` needs a `dist/` folder, which `npm run build` produces, because `tauri.conf.json` points `frontendDist` at it. When the change touches the bridge, repeat the `cargo check` with `--features devbridge`. When it touches `tools/mcp/`, run `python -m pytest` there, see [Development](tools/mcp/README.md#development).

Nothing compiles the other platforms on push: platform-gated Rust is only built by `manual-desktop-builds.yml` and the release. A frontend behaviour is checked in the running app through the MCP server. Which review agent fits which change is listed in [`Documentation/agents.md`](Documentation/agents.md).
