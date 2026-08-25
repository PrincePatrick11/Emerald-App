# Contributing to Emerald

Thanks for your interest in contributing!

## Getting Started

1. Fork the repository
2. Create a feature branch: `git checkout -b my-feature`
3. Make your changes
4. Open a pull request

## Development Setup

**Prerequisites:** Node.js, Rust toolchain, [Tauri prerequisites](https://tauri.app/start/prerequisites/)

```bash
npm install --cache /tmp/npm-emerald-cache
npm run tauri:dev
```

The dev build uses a separate database and app identity (`com.emerald.magical-journal.dev`) so it won't interfere with an installed production build.

## Guidelines

- Follow the conventions described in `Documentation/architecture.md`
- Add i18n keys to **all four** locale files (`src/i18n/locales/en.json`, `de.json`, `es.json`, `fr.json`)
- Keep Zustand selectors specific: `useStore((s) => s.field)`, never bare `useStore()`
- All hooks (`useState`, `useEffect`, `useMemo`, `useRef`) must appear **before** any early `return` in a component
- Use Pointer Events for drag & drop (HTML5 DnD is incompatible with Tauri/WKWebView)

## Continuous Integration

Every push and pull request runs `ci.yml`: a frontend job (`npm run check:schema`,
then the typecheck-carrying `npm run build`) and a `cargo check --locked
--all-targets` matrix across Linux, macOS, and Windows, since parts of the Rust
side are platform-gated and only actually compile on their own OS. See
`Documentation/build.md` for the full pipeline, including what CI does *not*
cover (bundling, signing, notarisation).

## Reporting Issues

Please use the [GitHub issue tracker](https://github.com/PrincePatrick11/Emerald-App/issues).

## Code of Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). Please be respectful.
