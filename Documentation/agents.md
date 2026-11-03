# Agents

The repository carries review and maintenance agents for a coding assistant in `tools/agents/`, so every contributor works with the same set. They are written as Claude Code subagents.

Two of them, `qacheck` and `designcheck`, look at the running app through the MCP server described in [`mcp.md`](mcp.md).

## Setting Them Up

Claude Code looks for agents in `.claude/agents/`, which this repository does not contain. `npm run agents:link` (`node scripts/link-agents.mjs`) makes that folder a link to `tools/agents/` — a link and not a copy, so the installed set cannot fall behind the repository; on Windows it is a junction and needs no admin rights. `node scripts/link-agents.mjs --user` links them under your home directory instead, for every project, and `--remove` takes the link away again. A folder that is already there and is not a link is left alone: move a local `.claude/agents/` folder out of the way first.

A git worktree is a checkout of its own and needs its own link, unless the agents are linked under the home directory.

[`AGENTS.md`](../AGENTS.md) at the root of the repository is the tool-neutral entry point. Nothing assistant-specific is checked in: `.claude/`, `.mcp.json` and `CLAUDE.md` are local files, created by this step and by registering the MCP server (see [`mcp.md`](mcp.md#registration)). In a checkout, this step adds a `CLAUDE.md` that points at `AGENTS.md`, and leaves one that already exists alone.

## The Agents

| Agent | Purpose |
| --- | --- |
| `review` | Code quality: naming, control flow, cohesion, duplication, error handling |
| `bugcheck` | Correctness: whether a change does what its task and approved plan say, and whether it holds for every input, state and order of events. Every finding names a failing case |
| `crosscheck` | Missing cross-module updates: the migrations in `src/lib/db.ts`, the `.emeralddb` backup format, export/import, trash and cleanup, referential integrity between modules. Enforces the rules in [`database.md`](database.md) |
| `securitycheck` | Tauri commands and capabilities, file-command confinement, exported HTML, input validation, the dev bridge, trust boundaries. Reads [`security.md`](security.md) |
| `oscheck` | Compatibility across Windows, macOS (Apple Silicon and Intel) and Linux: platform-gated Rust, the Tauri configs, WebView engine differences, path handling. Reads the two workflow files for the platform matrix |
| `centralize` | Consolidation in both directions: duplication that should become a shared building block, and shared building blocks that were bypassed. Works off the component patterns in [`design.md`](design.md) |
| `i18ncheck` | Drift between the `de`/`en`/`es`/`fr` locale files: missing or orphaned keys, hardcoded visible strings, mismatched placeholders |
| `designcheck` | UI changes against the theming rules in [`architecture.md`](architecture.md#theming-system), the patterns recorded in [`design.md`](design.md) and the neighbouring screens, and the rendered result in the running app in both themes |
| `qacheck` | Drives the running app end to end to validate a feature, with what it read from the page and the console as evidence per test case |
| `optimize` | Finds and fixes measurable performance bottlenecks: React render, SQLite, the Tauri bridge, startup |
| `sync-docs` | Updates `CHANGELOG.md` and `Documentation/` with what a session actually landed, leaving out intermediate steps and reverted changes |
| `release` | Prepares a release: checks the version across the three manifests, dates the changelog's open version section, checks the release workflow. Prints the tag command and never tags or pushes |

## Which Agent for Which Change

| What was changed | Agent |
| --- | --- |
| Components, styles, visible text | `designcheck` |
| A UI pattern that already exists in a similar form | `centralize` |
| Module, table, migration, shared type | `crosscheck` |
| Tauri command, capability, file or database access, import/export | `securitycheck` |
| `cfg(target_os)`, native menus, PDF export, Tauri config, `.github/workflows/` | `oscheck` |
| Locale file or visible text, including text written into exported files | `i18ncheck` |
| Non-trivial code in general | `review` |
| Logic: stores, migrations, Rust, anything with state or async work | `bugcheck` |
| A visible feature finished | `qacheck` |
| Something is measurably slow | `optimize` |

When several apply, the static reviewers come first, in any order, since they only cost reading time. `designcheck` and `qacheck` follow one after the other: both drive the same app instance, and `qacheck` is the most expensive of all.

This version has no automated tests of the app and no check scripts, and no CI on push — the reviewers and `qacheck` are most of what stands between a change and a release, so a change that touches several of the rows above deserves each of them.

`optimize` runs on a concrete occasion, not routinely. `sync-docs` and `release` start only on explicit request.

## What an Agent May Do

The eight reviewers (`review`, `bugcheck`, `crosscheck`, `securitycheck`, `oscheck`, `centralize`, `i18ncheck`, `designcheck`) and `qacheck` cannot change the codebase. Each carries a `tools:` allowlist without `Edit` or `Write`, which is what makes it safe to let them run without asking; acting on their findings is the main session's job. Bash stays on the list because they resolve the changed files through `git diff`, and each definition forbids using it to modify anything.

`qacheck` and `designcheck` additionally list the MCP tools they use, one by one. A tool added to or removed from the MCP server has to be added or removed there as well.

`sync-docs`, `release` and `optimize` have write access, because writing is their job. `sync-docs` and `release` are marked manual-only in their descriptions, and `optimize` waits for approval before applying a change.

## Models

Every agent pins a `model:`. The judgement-heavy ones (`review`, `bugcheck`, `crosscheck`, `securitycheck`, `oscheck`, `centralize`, `optimize`) use `opus`, because a wrong call there means missed data loss, false positives or needless rewrites. The reference- or procedure-driven ones (`designcheck`, `qacheck`, `i18ncheck`, `sync-docs`, `release`) use `sonnet`.

## Changing an Agent

Agent definitions are written in English, like the rest of this documentation, so the instructions and the docs they cite need no translating between each other. `design.md` is the exception: it is written in German, and the agents cite its German headings as they are.

An agent names the doc file that holds its rules instead of repeating them. A rule that changes is changed in `Documentation/`, and the agent picks it up from there. Where this version has no doc for a topic — the platform matrix, the release steps — the agent names the code or workflow file instead, and says so.
