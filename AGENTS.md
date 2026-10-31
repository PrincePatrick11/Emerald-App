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

## Rules

- Work on the branch of the version in progress, never on `main`. See [Branches and Releases](CONTRIBUTING.md#branches-and-releases).
- Follow the code conventions in [`CONTRIBUTING.md`](CONTRIBUTING.md#guidelines).
- A behaviour change updates `Documentation/` in the same change, following [Writing Docs](CONTRIBUTING.md#writing-docs), and adds a line under `[Unreleased]` in `CHANGELOG.md`.
- A schema change follows [`Documentation/database.md`](Documentation/database.md), a user-visible text goes into all four locale files, and a UI change follows [`Documentation/design.md`](Documentation/design.md) and [`Documentation/components.md`](Documentation/components.md).
- The dev bridge never reaches a release build, see [The Dev Bridge](Documentation/security.md#the-dev-bridge).
- Code, comments, commit messages and docs in new work are in English.
- Assistant-specific files stay local and ignored: `.claude/`, `.mcp.json`, `CLAUDE.md`.

## Checks

Run before calling a change done:

```bash
npm run check
cargo check --manifest-path src-tauri/Cargo.toml --locked
```

Add `--features devbridge` to the second command when the change touches the bridge. To see a change in the running app, use the MCP server. Which review agent fits which change is listed in [`Documentation/agents.md`](Documentation/agents.md).
