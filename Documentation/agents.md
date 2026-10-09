# Agents

The repository carries review and maintenance agents for two coding assistants, so every checkout and every contributor works with the same set. Claude Code loads them from `.claude/agents/` in any session inside a checkout; OpenCode loads the same agents from `.opencode/agent/` and its commands from `opencode.json`.

Two of them, `qacheck` and `designcheck`, look at the running app through the MCP server described in [`mcp.md`](mcp.md).

## The Agents

| Agent | Purpose |
| --- | --- |
| `review` | Code quality: naming, control flow, cohesion, duplication, error handling |
| `bugcheck` | Correctness: whether a change does what its task and approved plan say, and whether it holds for every input, state and order of events. Every finding names a failing case |
| `crosscheck` | Missing cross-module updates: shared schema, migrations, the backup format and its version, export/import, referential integrity between modules. Enforces the rules in [`database.md`](database.md) and runs `check:schema` |
| `securitycheck` | Tauri commands, the SQL boundary, key handling and encryption at rest, input validation, trust boundaries. Reads [`security.md`](security.md) and [`architecture/encryption.md`](architecture/encryption.md) |
| `oscheck` | Compatibility across Windows, macOS and Linux: platform-gated Rust, per-platform Tauri configs, WebView engine differences, path handling. Reads [`build.md`](build.md) for the platform matrix |
| `centralize` | Consolidation in both directions: duplication that should become a shared building block, and shared building blocks that were bypassed. Works off [`components.md`](components.md) |
| `i18ncheck` | Drift between the `de`/`en`/`es`/`fr` locale files: missing or orphaned keys, hardcoded visible strings, mismatched placeholders |
| `designcheck` | UI changes against the binding rules in [`design.md`](design.md) and the building blocks in [`components.md`](components.md), and the rendered result in the running app in both themes |
| `qacheck` | Drives the running app end to end to validate a feature, with what it read from the page and the console as evidence per test case |
| `optimize` | Finds and fixes measurable performance bottlenecks: React render, SQLite, the Tauri bridge, startup |
| `sync-docs` | Updates `CHANGELOG.md` and `Documentation/` with what a session actually landed, leaving out intermediate steps and reverted changes |
| `release` | Prepares a release: syncs the version across the three manifests, cuts the changelog, checks the release workflow. Prints the tag command and never tags or pushes |

## Which Agent for Which Change

| What was changed | Agent |
| --- | --- |
| Components, styles, visible text | `designcheck` |
| A UI pattern that already exists in a similar form | `centralize` |
| Module, table, shared type | `crosscheck` |
| Tauri command, file or database access, import/export | `securitycheck` |
| `cfg(target_os)`, window chrome, PDF export, build config, `.github/workflows/` | `oscheck` |
| Locale file or visible text | `i18ncheck` |
| Non-trivial code in general | `review` |
| Logic: stores, migrations, Rust, anything with state or async work | `bugcheck` |
| A visible feature finished | `qacheck` |
| Something is measurably slow | `optimize` |

When several apply, the static reviewers come first, in any order, since they only cost reading time. `designcheck` and `qacheck` follow one after the other: both drive the same app instance, and `qacheck` is the most expensive of all.

`optimize` runs on a concrete occasion, not routinely. `sync-docs` and `release` start only on explicit request.

## What an Agent May Do

The eight reviewers (`review`, `bugcheck`, `crosscheck`, `securitycheck`, `oscheck`, `centralize`, `i18ncheck`, `designcheck`) and `qacheck` cannot change the codebase. In Claude Code each carries a `tools:` allowlist without `Edit` or `Write`, which is what makes it safe to let them run without asking; acting on their findings is the main session's job. Bash stays on the list because they resolve the changed files through `git diff`, and each definition forbids using it to modify anything.

`qacheck` and `designcheck` additionally list the MCP tools they use, one by one. A tool added to or removed from the MCP server has to be added or removed there as well. `reset_database` is left out on purpose.

`sync-docs`, `release` and `optimize` have write access, because writing is their job. `sync-docs` and `release` are marked manual-only in their descriptions, and `optimize` waits for approval before applying a change.

OpenCode has no equivalent of the allowlist in this setup, so its variants rely on the rules in their text alone.

## Models

Every Claude Code agent pins a `model:`. The judgement-heavy ones (`review`, `bugcheck`, `crosscheck`, `securitycheck`, `oscheck`, `centralize`, `optimize`) use `opus`, because a wrong call there means missed data loss, false positives or needless rewrites. The reference- or procedure-driven ones (`designcheck`, `qacheck`, `i18ncheck`, `sync-docs`, `release`) use `sonnet`. The OpenCode variants pin their own model per file.

## Changing an Agent

Each agent exists twice: as a Claude Code subagent in `.claude/agents/`, and as an OpenCode agent in `.opencode/agent/` or as a command in `opencode.json`. A change to one belongs in the other as well.

Agent definitions are written in English, like this documentation, so the instructions and the docs they cite need no translating between each other.

An agent names the doc file that holds its rules instead of repeating them. A rule that changes is changed in `Documentation/`, and the agent picks it up from there.
