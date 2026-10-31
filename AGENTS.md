# Working in This Repository

Entry point for coding assistants. It says where things are and which rules apply; the details live in the files it links to.

## Map

| Path | What |
| --- | --- |
| `src/` | React frontend |
| `src-tauri/` | Rust backend and Tauri configuration |
| `scripts/` | Repository checks and generators, run through `npm run` |
| `tools/agents/` | Review and maintenance agents, see [`Documentation/agents.md`](Documentation/agents.md) |
| `tools/mcp/` | MCP server that drives a running instance, see [`Documentation/mcp.md`](Documentation/mcp.md) |
| `Documentation/` | How Emerald works today. Start at [`architecture.md`](Documentation/architecture.md) |

## Setup

Every fresh checkout or git worktree needs `npm install`, and its first Rust build compiles SQLCipher and OpenSSL, which takes several minutes. See the [native build requirements](Documentation/build.md#native-build-requirements).

`npm run agents:link` makes the review agents available. `npm run mcp:register` registers the MCP server, which also needs Python 3.10 or newer and [uv](https://github.com/astral-sh/uv), see [Requirements](Documentation/mcp.md#requirements). If its tools are missing, say so rather than reporting a change as tested in the app.

## Rules

- Work on the branch of the version in progress, never on `main`. See [Branches and Releases](CONTRIBUTING.md#branches-and-releases).
- Follow the code conventions in [`CONTRIBUTING.md`](CONTRIBUTING.md#guidelines).
- A behaviour change updates `Documentation/` in the same change, following [Writing Docs](CONTRIBUTING.md#writing-docs), and adds a line under `[Unreleased]` in `CHANGELOG.md`.
- The dev bridge never reaches a release build, see [The Dev Bridge](Documentation/security.md#the-dev-bridge).
- Code, comments, commit messages and docs in new work are in English.
- Assistant-specific files stay local and ignored: `.claude/`, `.mcp.json`, `CLAUDE.md`.

## Where to Look First

The long documents are references: read the section you need, not the whole file. Where a document and the code disagree, the code is right: correct the document in the same change.

| Change | Read |
| --- | --- |
| Database schema or migration | [Rules for Future Schema Changes](Documentation/database.md#rules-for-future-schema-changes) |
| A new module or table | [Adding a Module or Table](Documentation/architecture/modules.md#adding-a-module-or-table) |
| An existing module | [`architecture/modules.md`](Documentation/architecture/modules.md) |
| UI | [`design.md`](Documentation/design.md) and [`components.md`](Documentation/components.md) |
| User-visible text | [`internationalization.md`](Documentation/internationalization.md); it goes into all four locale files |
| Tauri commands, files, keys | [`security.md`](Documentation/security.md) |
| CI or a release | [`build.md`](Documentation/build.md) |

## Checks

Run before calling a change done, in this order, since the Rust build needs the `dist/` that `npm run check` produces:

```bash
npm run check
cargo check --manifest-path src-tauri/Cargo.toml --locked --all-targets
```

When the change touches `src-tauri/`, also run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml --locked --lib
```

When it touches the bridge, repeat the `cargo check` with `--features devbridge`. When it touches `tools/mcp/`, run `python -m pytest` there, see [Development](tools/mcp/README.md#development); CI does not run those tests.

Rust tests live inline in `#[cfg(test)]` modules. The frontend has no unit tests, so its behaviour is checked in the running app through the MCP server. Which review agent fits which change is listed in [`Documentation/agents.md`](Documentation/agents.md).
