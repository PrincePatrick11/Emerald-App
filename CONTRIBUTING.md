# Contributing to Emerald

Thanks for your interest in contributing!

## Getting Started

1. Fork the repository
2. Create a feature branch from the current `version/x.y.z` branch: `git checkout -b my-feature version/x.y.z`
3. Make your changes and run `npm run check`
4. Open a pull request against that same version branch

## Branches and Releases

- **Each version has one branch, `version/x.y.z`.** The branch with the highest version number is the one in progress. Work lands there directly or through a short-lived branch.
- **`main` holds the latest finished version.** It only changes through a pull request from a version branch, merged as a merge commit and never squashed, so the version's history stays intact and later merges stay clean.
- **Tags mark releases, `vX.Y.Z`, on the merge commit in `main`.** Branch names carry the `version/` prefix so that a branch and a tag never share a name. After the release the tag is the fixed point, and the version branch can go.
- **A patch to a finished version** gets its own version branch from `main`. Once it is released, merge `main` into the version in progress.

The steps of a release are in [Cutting a release](Documentation/build.md#cutting-a-release).

## Development Setup

**Prerequisites:** Node.js 22 or newer, Rust toolchain, [Tauri prerequisites](https://tauri.app/start/prerequisites/)

The database is SQLCipher, built together with OpenSSL from source, and that build needs Perl and `make`. macOS and Debian/Ubuntu ship both; Fedora/RHEL need `dnf install perl-core make`; on Windows install [Strawberry Perl](https://strawberryperl.com/) (`winget install StrawberryPerl.StrawberryPerl`) — the Perl that comes with Git does not work. The first build takes several minutes longer because of OpenSSL.

```bash
npm install
npm run tauri:dev
```

The dev build uses a separate database and app identity (`com.emerald.app.dev`) so it won't interfere with an installed production build.

## Guidelines

- Follow the conventions described in `Documentation/architecture.md` and the per-area files in `Documentation/architecture/`
- Add i18n keys to **all four** locale files (`src/i18n/locales/en.json`, `de.json`, `es.json`, `fr.json`)
- Keep Zustand selectors specific: `useStore((s) => s.field)`, never bare `useStore()`
- All hooks (`useState`, `useEffect`, `useMemo`, `useRef`) must appear **before** any early `return` in a component
- Use Pointer Events for drag & drop (HTML5 DnD is incompatible with Tauri/WKWebView)

## Continuous Integration

Every push to `main` or a version branch and every pull request runs `ci.yml`: a frontend job (`npm run check`, which runs `check:schema`, `check:i18n`, `check:blocks` and `check:docs`, then the typecheck-carrying `build`) and a `cargo check --locked --all-targets` matrix across Linux, macOS, and Windows, with and without the `devbridge` feature, since parts of the Rust side are platform-gated and only actually compile on their own OS. `rust-tests.yml` runs `cargo test --lib` when `src-tauri/` changes. See [`Documentation/build.md`](Documentation/build.md#ci--the-smoke-detector) for the full pipeline, including what CI does *not* cover (bundling, signing, notarisation).

## Working with a Coding Assistant

[`AGENTS.md`](AGENTS.md) is the entry point for an assistant. The repository carries its own review agents (`tools/agents/`, set up with `npm run agents:link`), and an MCP server (`tools/mcp/`, registered with `npm run mcp:register`) that drives a running Emerald instance so an assistant can check a change in the app itself. [`Documentation/agents.md`](Documentation/agents.md) lists the agents, which one fits which kind of change, and what each may do; [`Documentation/mcp.md`](Documentation/mcp.md) covers using the MCP server.

## Writing Docs

`Documentation/` describes how Emerald works today; `CHANGELOG.md` and git record how it got there. The rules below apply to every doc file except `CHANGELOG.md`.

- **The current state only.** No "used to", "formerly", "no longer", "now also", "replaces the old …", "since vNN". A migration or importer that converts old data is current behaviour — describe what it converts, not the old feature.
- **Keep the why, drop the when.** A reason that still explains today's design stays; a reason that only explains how the code got here goes.
- **Name symbols, not line numbers.** Write `normalizeSchema.ts` or `.vault-card`, never `index.css:1426`.
- **One paragraph per line.** No hard wrapping, so a diff shows the paragraph that changed. Split anything long into several paragraphs or a list.
- **Say it once.** Each topic has one home; other files link to it.
- **Rewrite, don't append.** When behaviour changes, rewrite the section so it reads as one description, instead of adding a sentence that amends the previous ones.
- **`features.md` is the user's view.** No component, store, function or storage-key names — those belong in `architecture/`.

Where things go: the table at the top of [`Documentation/architecture.md`](Documentation/architecture.md) lists the per-area files; schema and migrations go to `database.md`, shared building blocks to `components.md`, visual rules to `design.md`.

Files link to each other by heading anchor, so renaming a heading breaks links elsewhere. `npm run check:docs` finds broken links and anchors; it runs in CI.

## Reporting Issues

Please use the [GitHub issue tracker](https://github.com/PrincePatrick11/Emerald-App/issues).

## Code of Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). Please be respectful.
