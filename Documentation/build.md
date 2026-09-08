# Build & Release

How Emerald gets from a commit to a downloadable binary. Three GitHub Actions
workflows do the work; this file says what each one is for, what it does *not*
cover, and what has to be true before a tag is pushed.

## The three workflows

| Workflow | Trigger | Purpose |
|---|---|---|
| [`ci.yml`](../.github/workflows/ci.yml) | every push, every pull request | Does it still compile — on all three operating systems? |
| [`manual-desktop-builds.yml`](../.github/workflows/manual-desktop-builds.yml) | `workflow_dispatch` | Real bundles on demand, as downloadable artifacts. The dress rehearsal before a tag. |
| [`release.yml`](../.github/workflows/release.yml) | pushing a `v*` tag | Creates the GitHub release and uploads the signed bundles to it. |

## CI — the smoke detector

Two jobs, on every push to every branch and on every pull request.
`cancel-in-progress` is on, so a quick follow-up push supersedes the previous run
rather than queueing behind it.

**`frontend`** (`ubuntu-latest`, once — the frontend build is platform-independent,
so the glibc argument below does not apply to it):
`npm run check:schema` (needs `esbuild`, declared in `devDependencies`), then
`npm run check:i18n` (`scripts/i18n-check.mjs` — the four locale files carry the same
keys and the same `{{placeholder}}`s, see [`internationalization.md`](internationalization.md)),
then `npm run build`, which is `tsc && vite build --configLoader runner` and so carries
the typecheck.

All workflows pin **Node 22**, and `package.json` records the same floor under
`engines`. `scripts/schema-check.mjs` imports `node:sqlite`, which does not exist
in Node 20 — the first CI run failed on exactly that, because the workflows had
inherited a `node-version: 20` that nothing in the repo justified.

**`rust`** (matrix: `ubuntu-22.04`, `macos-14`, `windows-latest`):
`cargo check --manifest-path src-tauri/Cargo.toml --locked --all-targets`.

The matrix is the entire point of the file. `src-tauri/src/pdf_export/` holds
three implementations — `windows.rs`, `macos.rs`, `linux.rs` — separated by
`#[cfg(target_os = "…")]`, and `lib.rs` has four more macOS-gated spots. Whoever
develops on Windows never compiles the other two. Without this matrix a typo in
`macos.rs` stays invisible until a tag is pushed and the release build goes red
in public. `--locked` additionally catches `Cargo.lock` drifting from
`Cargo.toml`.

**Two things worth knowing:**

- The Rust jobs run `npm run build` even though they compile no frontend code.
  `tauri-build` reads `frontendDist: "../dist"` from `tauri.conf.json` and aborts
  when that directory is missing, so `cargo check` needs a built frontend to run
  at all.
- `cargo check` stops before codegen and linking. It does **not** cover link
  errors, bundling (DMG, AppImage, `.deb`, NSIS/MSI), code signing, or
  notarisation. A broken AppImage build still surfaces first in a full build.

That gap is deliberate: three full `tauri build` runs per push would cost twenty
to thirty minutes for every typo. `cargo check` lands at two to four with a warm
cache. The first run is longer — Linux pulls the WebKit packages and the whole
dependency tree before `Swatinem/rust-cache` has anything to restore.

## Manual builds — the dress rehearsal

`manual-desktop-builds.yml` runs the same build steps as the release, but from a
branch instead of a tag, and uploads the results as workflow artifacts rather
than publishing anything. Start it from the Actions tab with per-platform
checkboxes (`build_macos`, `build_windows`, `build_linux`, all default on).
Its `concurrency` group does not cancel in-progress runs — two manual builds
queue rather than killing each other.

This is what closes most of CI's gap: run it before tagging and the bundling and
linking steps have actually been exercised. Apple code signing is deliberately
left out here — that step exists only in `release.yml` and is first exercised by
the tag build itself.

## Release — what a tag sets off

Pushing a `v*` tag runs `prepare-release` first; every build job hangs off it via
`needs`, so a failure there costs no build minutes and leaves no half-finished
release on GitHub.

`prepare-release` does two things, in this order:

1. **Verifies the tag against all three version sites.** The version lives in
   `package.json`, `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`, and
   the three must be character-identical — `SettingsModal.tsx` imports
   `package.json` directly and shows the version in the UI, while the bundle
   filename comes from `Cargo.toml`. A tag of `v0.2.1` against files saying
   `0.2.0` fails the job with an annotation naming which files disagree.
2. **Extracts the changelog section for the version.** An `awk` pass pulls
   `## [<version>]` out of `CHANGELOG.md` and hands it to the release as the
   body. Note that it does not fail on an empty result — if the section is still
   headed `## [Unreleased]`, the release is created with no notes and no
   complaint. Cutting `## [Unreleased]` into a versioned section is a manual
   step before tagging.

`concurrency` is set without `cancel-in-progress`: pushing the same tag twice
makes the second run wait rather than race the first for the same asset names.
A running release build is not something to abort halfway.

## Platform matrix

| Platform | Runner | Target | Bundles |
|---|---|---|---|
| macOS | `macos-14` | `aarch64-apple-darwin` | `.dmg` |
| Windows | `windows-latest` | `x86_64-pc-windows-msvc` | `.exe` (NSIS), `.msi` |
| Linux | `ubuntu-22.04` | `x86_64-unknown-linux-gnu` | `.deb`, `.AppImage` |

**No Intel macOS build is published.** Apple Silicon only.

**The macOS floor is 13.0 (Ventura)**, set via `bundle.macOS.minimumSystemVersion`
in `tauri.conf.json`. The interface uses CSS `color-mix()` in fourteen places and
that needs WebKit 16.2; below it most of those declarations are dropped silently,
and one of them sits inside a `border` shorthand, which takes the whole
declaration with it. Tauri's default floor is 10.13, so leaving it unset had the
DMG claiming support it did not have.

Do not also set `MACOSX_DEPLOYMENT_TARGET` in the workflow. The Tauri CLI derives
it from `minimumSystemVersion` itself; a second copy in the workflow is a second
truth that will drift.

Linux builds on 22.04 LTS on purpose — glibc compatibility is downward, so a
binary built there runs on 24.04, but not the other way round.

## Per-platform Tauri configs

`tauri.conf.json` is not the whole story: at build time Tauri merges a
platform-specific file over it, and the window chrome depends on exactly that.

| File | Carries |
| --- | --- |
| `tauri.windows.conf.json` | `decorations: false`, `shadow: true` — the undecorated window behind the custom title bar |
| `tauri.linux.conf.json` | `decorations: false` |
| `tauri.macos.conf.json` | `titleBarStyle: "Overlay"`, `hiddenTitle: true`, `trafficLightPosition` — native traffic lights stay |
| `tauri.dev.conf.json` | dev identifier `com.emerald.app.dev` and `productName: "Emerald App Dev"`; selected by `npm run tauri:dev`. The window *title* is not in here — it comes from the platform file and reads `Emerald App` in dev too |

**These files replace arrays and objects wholesale rather than merging them.**
Each platform file therefore repeats the complete window object, and
`tauri.dev.conf.json` must never gain an `app.windows` key, or the platform
settings vanish for dev builds.

`bundle.targets` in `tauri.conf.json` is `"all"`, so macOS and Windows build more
bundle formats than the release uploads (the workflow filters to `.dmg` and
`.exe`/`.msi`); only Linux narrows the build itself with `--bundles deb,appimage`.

## Product name vs. identifier

`productName` (`"Emerald App"`, dev `"Emerald App Dev"`) and `identifier`
(`com.emerald.app`, dev `com.emerald.app.dev`) in `tauri.conf.json` /
`tauri.dev.conf.json` name two different things and changing one does not
imply the other:

- **`productName`** names the built artifact — the executable, the
  installation folder, the bundle. Renaming it does not move a single byte of
  a user's data.
- **`identifier`** is what the OS uses to key `app_data_dir()` /
  `app_config_dir()` (and, on Windows, the WebView2 profile). Renaming it
  *does* move where the app looks for its data.

Both changed together for the "Emerald" → "Emerald App" rename (identifier
`com.emerald.magical-journal` → `com.emerald.app`). That has a real
consequence for anyone upgrading an existing installation, since installers
key "is this an upgrade of the same app?" off `productName`, not
`identifier`: on Windows, NSIS's uninstall registry key is named after
`productName`, so it no longer recognises a prior "Emerald" install as the
same app and both can end up listed side by side; on macOS,
`Emerald App.app` installs next to an existing `Emerald.app` instead of
replacing it. Because the identifier moved too, the two are entirely
separate applications as far as the system is concerned, data directory
included — the old install keeps its own copy of everything until it is
deleted. This was accepted knowingly for this rename; a user upgrading
across it has to remove the old installation, and carry its data over,
by hand.

**Naming convention going forward:** the product is "Emerald App" — window
title, macOS menu, About card, PDF-export window titles. The user's data and
the file format stay plain "Emerald" — vault folder names
(`Documents/Emerald Vaults/{name}`), the `.emeralddb` backup file-picker
filter ("Emerald Backup"), and the `.emerald` export format and its menu
entries ("Export as Emerald…" / "From Emerald…"). Those name what the data
*is*, not what the program is called, and stay untouched by a future product
rename.

## App icons

`npm run icons` (`scripts/make-icons.mjs`) regenerates every binary icon
under `src-tauri/icons/` plus `public/favicon.svg`, from two hand-maintained
SVG templates in `src-tauri/icons/source/`: `emerald.svg` (cut out, no
background — what Windows and Linux use) and `emerald-macos.svg` (the same
mark sitting on the rounded plate macOS expects — 824 of 1024px, corner
radius 185, i.e. the OS's own ~22.5% proportion). `tauri icon` writes *all*
targets on every run, so the two templates are rasterised into separate
temp directories and only `icon.icns` — the one file macOS reads — is taken
from the plate run; a single plain `tauri icon <file>` invocation would
silently overwrite one platform's icon with the other's shape. Not run in
CI: the generated files are committed, since the Rust build needs them and
regenerating them is a design decision, not a build step.

## Signing

macOS signing and notarisation are wired up but optional. The step reads
`APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`,
`APPLE_ID`, `APPLE_PASSWORD` and `APPLE_TEAM_ID` from repository secrets and
skips itself cleanly when `APPLE_CERTIFICATE` is unset — which is the current
state, and why `README.md` tells macOS users how to get past Gatekeeper.

Windows builds are unsigned; SmartScreen warns on first run.

## Cutting a release

1. Set the version in `package.json`, `src-tauri/tauri.conf.json` and
   `src-tauri/Cargo.toml` — character-identical in all three — and rename
   `## [Unreleased]` in `CHANGELOG.md` to `## [<version>] - <date>`.
2. Run `manual-desktop-builds.yml` from the branch and confirm all three
   platforms produce bundles.
3. Commit, push, then tag and push the tag. `prepare-release` re-checks the
   versions; if step 1 was skipped it fails there rather than later.

## Known gaps

- CI proves compilation, not bundling. Only a manual or release build does that.
- The changelog extraction cannot fail — an empty section yields an empty
  release body silently.
- Nothing runs clippy, and warnings do not fail a build. (`src-tauri/Cargo.toml`
  declares an empty `cargo-clippy` feature so that a manual clippy run compiles;
  CI does not use it.)
- There are no automated tests. CI proves the code compiles, nothing more —
  behaviour is only ever verified by running the app by hand.
