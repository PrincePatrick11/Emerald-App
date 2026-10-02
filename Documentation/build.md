# Build & Release

How Emerald gets from a commit to a downloadable binary: what each GitHub Actions workflow is for, what it does *not* cover, and what has to be true before a tag is pushed.

## The four workflows

| Workflow | Trigger | Purpose |
|---|---|---|
| [`ci.yml`](../.github/workflows/ci.yml) | every push, every pull request | Does it still compile — on all three operating systems? |
| [`manual-desktop-builds.yml`](../.github/workflows/manual-desktop-builds.yml) | `workflow_dispatch` | Real bundles on demand, as downloadable artifacts. The dress rehearsal before a tag. |
| [`release.yml`](../.github/workflows/release.yml) | pushing a `v*` tag | Creates the GitHub release and uploads the signed bundles to it. |
| [`rust-tests.yml`](../.github/workflows/rust-tests.yml) | pushes and pull requests that touch `src-tauri/**` | `cargo test --lib` on all three. Its own file, not a line in `ci.yml`: what it runs has an expiry date — see [Known gaps](#known-gaps). |

All workflows pin **Node 22**, and `package.json` records the same floor under `engines`: `scripts/schema-check.mjs` imports `node:sqlite`, which Node 20 lacks.

## CI — the smoke detector

Two jobs, on every push to every branch and on every pull request. `cancel-in-progress` is on, so a quick follow-up push supersedes the previous run rather than queueing behind it.

**`frontend`** (`ubuntu-latest`, once — the frontend build is platform-independent):

1. `npm run check:schema` (needs `esbuild` from `devDependencies`)
2. `npm run check:i18n` — the four locale files carry the same keys and `{{placeholder}}`s, see [`internationalization.md`](internationalization.md)
3. `npm run check:blocks` (`scripts/check-blocks.mjs`) — the stored block format in `src/lib/blocks/blockHtml.ts` round-trips and runs under Node without a DOM
4. `npm run check:docs` (`scripts/check-docs.mjs`) — every relative link in `README.md`, `CONTRIBUTING.md`, `CHANGELOG.md` and `Documentation/` points to an existing file and, with `#anchor`, to an existing heading
5. `npm run build` — `tsc && vite build --configLoader runner`, so it carries the typecheck

**`rust`** (matrix: `ubuntu-22.04`, `macos-14`, `windows-latest`): `cargo check --manifest-path src-tauri/Cargo.toml --locked --all-targets`.

The matrix is the point of the file. `src-tauri/src/pdf_export/` holds three implementations — `windows.rs`, `macos.rs`, `linux.rs` — separated by `#[cfg(target_os = "…")]`, and `lib.rs` has several macOS-gated spots. Whoever develops on Windows never compiles the other two; without the matrix a typo in `macos.rs` stays invisible until the release build goes red in public. `--locked` additionally catches `Cargo.lock` drifting from `Cargo.toml`.

**Two things worth knowing:**

- The Rust jobs run `npm run build` even though they compile no frontend code. `tauri-build` reads `frontendDist: "../dist"` from `tauri.conf.json` and aborts when that directory is missing.
- `cargo check` stops before codegen and linking. It does **not** cover link errors, bundling (DMG, AppImage, `.deb`, NSIS/MSI), code signing, or notarisation. A broken AppImage build surfaces first in a full build.

That gap is deliberate: three full `tauri build` runs per push would cost twenty to thirty minutes for every typo; `cargo check` takes two to four with a warm cache. The first run is longer — Linux pulls the WebKit packages and the whole dependency tree before `Swatinem/rust-cache` has anything to restore.

## Manual builds — the dress rehearsal

`manual-desktop-builds.yml` runs the same build steps as the release, but from a branch, and uploads the results as workflow artifacts instead of publishing. Start it from the Actions tab with per-platform checkboxes (`build_macos`, `build_windows`, `build_linux`, all default on). Its `concurrency` group does not cancel in-progress runs — two manual builds queue rather than killing each other.

Run it before tagging and the bundling and linking steps have actually been exercised. Apple code signing is deliberately left out — it exists only in `release.yml` and is first exercised by the tag build itself.

**Update signing is not left out, and cannot be.** With `createUpdaterArtifacts` on, the bundler aborts without a private key (*"A public key has been found, but no private key"*), so every job that bundles carries the two signing secrets. Locally, `npm run tauri build` needs `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` in the environment. `npm run tauri:dev` does not bundle and is unaffected.

## Testing the updater

The update path can only be exercised against a real, signed bundle behind an https address, and the first version carrying the updater has nothing to update *from*.

One rule is easy to break here: ***the production signing key signs releases, nothing else.*** A test bundle signed with it under a made-up version and left at a public address would let anyone who gets a user to paste that address install a build that never went through a release, under a version number that outranks every real one.

What remains for testing an update before shipping one:

- **A prerelease.** Tag a real version, mark the GitHub release as a prerelease so `releases/latest` keeps pointing at the previous one, then set the update source in Settings to that release's own `latest.json` URL. Same path, same key, nothing published to anyone who did not go looking.
- **The negative test, which is the one worth doing.** Take a published `latest.json`, change the announced `version` while leaving `url` and `signature` alone, serve it over https, and point the update source at it. With `requireSignedVersion` on, the update must be refused. That proves the guard fires — flipping a character in the signature only proves minisign works.

## Release — what a tag sets off

Pushing a `v*` tag runs `prepare-release` first; every build job hangs off it via `needs`, so a failure there costs no build minutes and leaves no half-finished release on GitHub. It does two things, in order:

1. **Verifies the tag against all three version sites** — `package.json`, `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml` must be character-identical to the tag. `settings/AboutPage.tsx` imports `package.json` to show the version, while the bundle filename comes from `Cargo.toml`. A mismatch fails the job with an annotation naming the files.
2. **Extracts the changelog section for the version.** An `awk` pass pulls `## [<version>]` out of `CHANGELOG.md` as the release body. It does not fail on an empty result — if the section is still headed `## [Unreleased]`, the release is created with no notes and no complaint.

After all three build jobs, **`publish-manifest` writes the `latest.json` the in-app updater reads** and attaches it to the release. It runs last on purpose: the manifest is the switch that makes a version visible to installed apps, so it must not exist before the bundles it points at. If a platform build fails, no manifest is written and installed apps keep seeing the previous release.

Two scripts do the work, so all three runners (two bash, one pwsh) share one implementation:

- `scripts/updater-fragment.mjs` runs in each build job, finds the single `.sig` Tauri wrote next to the updater bundle and saves it as a workflow artifact. It fails loudly on zero or several matches — a guessed signature would be noticed only by a user whose update refuses to install.

  **The `.sig` files are deliberately not published.** `updater-manifest.mjs` copies their contents into `latest.json`, the only place the updater reads a signature from; uploading them too would add three assets nothing reads.
- `scripts/updater-manifest.mjs` combines the fragments into `latest.json`. It resolves download URLs from the release's own asset list rather than building them: GitHub rewrites special characters in asset names (`Emerald App_0.3.0…` becomes `Emerald.App_0.3.0…`), so a hand-built URL would 404.

`concurrency` is set without `cancel-in-progress`: pushing the same tag twice makes the second run wait rather than race the first for the same asset names. A running release build is not something to abort halfway.

## Platform matrix

| Platform | Runner | Target | Bundles | Updates via |
|---|---|---|---|---|
| macOS | `macos-14` | `aarch64-apple-darwin` | `.dmg` | `.app.tar.gz` (`darwin-aarch64`) |
| Windows | `windows-latest` | `x86_64-pc-windows-msvc` | `.exe` (NSIS), `.msi` | the NSIS `.exe` (`windows-x86_64`) |
| Linux | `ubuntu-22.04` | `x86_64-unknown-linux-gnu` | `.deb`, `.AppImage` | the `.AppImage` only (`linux-x86_64`) |

**No Intel macOS build is published.** Apple Silicon only — and since the updater only offers what the manifest lists, an Intel Mac running under Rosetta is never offered an update either.

**A `.deb` install is not offered updates.** The plugin could do it (it shells out to `pkexec dpkg -i`), but that needs its own `linux-x86_64-deb` key in the manifest, and the release publishes only `linux-x86_64`, pointing at the AppImage. Adding it is a manifest change, not an app change. Until then the app detects the case and shows a "download it from the website" note instead of an install button; the detection is stricter than an `APPIMAGE` check, see [In-App Updates](security.md#in-app-updates). The MSI is published for people who want it but is not the Windows update path: one platform key maps to one URL, and that is the NSIS installer.

**The macOS floor is 13.0 (Ventura)**, set via `bundle.macOS.minimumSystemVersion` in `tauri.conf.json`. The interface relies on CSS `color-mix()`, which needs WebKit 16.2; below it those declarations are dropped silently — including inside `border` shorthands, which takes the whole declaration with it. Tauri's default floor of 10.13 would have the DMG claim support it does not have.

Do not also set `MACOSX_DEPLOYMENT_TARGET` in the workflow. The Tauri CLI derives it from `minimumSystemVersion`; a second copy is a second truth that will drift.

Linux builds on 22.04 LTS on purpose — glibc compatibility is downward, so a binary built there runs on 24.04, but not the other way round.

## Per-platform Tauri configs

At build time Tauri merges a platform-specific file over `tauri.conf.json`, and the window chrome depends on exactly that.

| File | Carries |
| --- | --- |
| `tauri.windows.conf.json` | `decorations: false`, `shadow: true` — the undecorated window behind the custom title bar |
| `tauri.linux.conf.json` | `decorations: false` |
| `tauri.macos.conf.json` | `titleBarStyle: "Overlay"`, `hiddenTitle: true`, `trafficLightPosition` — native traffic lights stay |
| `tauri.dev.conf.json` | dev identifier `com.emerald.app.dev` and `productName: "Emerald App Dev"`; selected by `npm run tauri:dev`. The window *title* comes from the platform file and reads `Emerald App` in dev too |

**These files replace arrays wholesale rather than merging them** (RFC 7396 merge patch; objects merge key by key, and `app.windows` is an array). Each platform file therefore repeats the complete window object, and `tauri.dev.conf.json` must never gain an `app.windows` key, or the platform settings vanish for dev builds.

`bundle.targets` in `tauri.conf.json` is `"all"`, so macOS and Windows build more bundle formats than the release uploads (the workflow uploads only `.dmg` and `.exe`/`.msi`); only Linux narrows the build itself with `--bundles deb,appimage`.

## Product name vs. identifier

`productName` (`"Emerald App"`, dev `"Emerald App Dev"`) and `identifier` (`com.emerald.app`, dev `com.emerald.app.dev`) name two different things; changing one does not imply the other:

- **`productName`** names the built artifact — the executable, the installation folder, the bundle. Renaming it moves none of a user's data.
- **`identifier`** keys `app_data_dir()` / `app_config_dir()` (and, on Windows, the WebView2 profile). Renaming it moves where the app looks for its data.

Both differ from the previous release ("Emerald", `com.emerald.magical-journal`). Installers decide "is this an upgrade of the same app?" by `productName`: on Windows the NSIS uninstall registry key is named after it, so a prior "Emerald" install is not recognised and both can end up listed side by side; on macOS, `Emerald App.app` installs next to `Emerald.app`. With the identifier changed too, the two are separate applications to the system, data directory included. This was accepted knowingly: a user upgrading has to remove the old installation by hand.

The *data* is carried over in the app rather than by an installer: `adopt_previous_identifier_dirs` (`src-tauri/src/vault.rs`, see [Adopting a previous identifier's data](architecture/storage.md#adopting-a-previous-identifiers-data)) copies the previous identifier's data across on first start, over both `app_data_dir` and `app_config_dir` (different directories on Linux). Why it hangs off a plugin's `setup` and adopts only a named list — both forced by Linux, where the old data directory is also the webview profile — is in that section.

An installer hook is the wrong tool: NSIS is Windows-only, so the `.dmg` and `.deb`/`.AppImage` would need their own answer anyway. What adoption cannot carry is `localStorage` — the appearance boot mirror, sidebar widths, open tabs. On Windows and Linux it lives in the webview profile keyed by the identifier; on macOS WKWebView keeps it under `~/Library/WebKit/{identifier}`. Copying a browser profile across identifiers is platform-specific and brittle, for state that is cheap to lose: appearance comes back from the vault's `settings.json` on open, and the rest is re-set in seconds.

**Naming convention:** the product is "Emerald App" — window title, macOS menu, About card, PDF-export window titles. The user's data and the file format stay plain "Emerald" — vault folder names (`Documents/Emerald Vaults/{name}`), the `.emeralddb` file-picker filter ("Emerald Backup"), and the `.emerald` export format and its menu entries ("Export as Emerald…" / "From Emerald…"). Those name what the data *is*, not what the program is called, and stay untouched by a future product rename.

## App icons

`npm run icons` (`scripts/make-icons.mjs`) regenerates every binary icon under `src-tauri/icons/` plus `public/favicon.svg`, from two hand-maintained SVG templates in `src-tauri/icons/source/`:

- `emerald.svg` — cut out, no background; what Windows and Linux use.
- `emerald-macos.svg` — the same mark on the rounded plate macOS expects (824 of 1024px, corner radius 185, the OS's own ~22.5% proportion).

`tauri icon` writes *all* targets on every run, so the two templates are rasterised into separate temp directories and only `icon.icns` — the one file macOS reads — is taken from the plate run; a single `tauri icon <file>` would silently overwrite one platform's icon with the other's shape. Not run in CI: the generated files are committed, since the Rust build needs them and regenerating them is a design decision, not a build step.

## Bundled fonts

The eight selectable typefaces are `@fontsource/*` packages in `dependencies`, not a request to Google. `npm run fonts` (`scripts/make-fonts-css.mjs`) writes `src/fonts.css` from them — `@font-face` rules for the `latin` and `latin-ext` subsets, `woff2` only, taken from each package's complete stylesheet because the per-subset ones lack `unicode-range`. Like the icons, the result is committed and not run in CI; the fonts add about 1.7 MB to the bundle.

A new typeface or weight: add it to `FONTS` in the script, install the package, run `npm run fonts`, and add the font to `src/themes/theme.ts`. The CSP allows no remote origin for any of it (see [`security.md`](security.md#content-security-policy)).

## Native build requirements

The database is SQLCipher, built from source together with OpenSSL (`libsqlite3-sys` with `bundled-sqlcipher-vendored-openssl`), so no system SQLite or OpenSSL is used. That adds requirements beyond Tauri's own, and a few minutes to the first build:

- **Perl and `make`** on every platform. macOS and Debian/Ubuntu ship both; Fedora/RHEL need `perl-core` and `make`. On Windows the Perl that comes with Git does not work — install Strawberry Perl (`CONTRIBUTING.md` has the command).
- **NASM** on Windows release builds. Without it OpenSSL builds without its assembler code: no AES-NI, slower, and not constant-time. `release.yml` and `manual-desktop-builds.yml` install it (`ilammy/setup-nasm`); `ci.yml` only compiles, so it does not.
- **`libdbus-1-dev` and `pkg-config`** on Linux, for the Secret Service keychain (`keyring`'s D-Bus client). They are in the apt list of every Linux job.
- **Argon2 in dev builds.** `Cargo.toml` compiles `argon2` and `blake2` with `opt-level = 3` under `[profile.dev]`: unoptimised, Argon2id would take many seconds per unlock.
- **Release profile.** `[profile.release]` sets `lto = true`, `codegen-units = 1` and `strip = true`: a smaller, faster binary at the price of a slower release compile (CI only; dev builds are unaffected).

## Signing

macOS signing and notarisation are wired up but optional. The release step reads `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD` and `APPLE_TEAM_ID` from repository secrets and skips itself when `APPLE_CERTIFICATE` is unset — the current state, and why `README.md` tells macOS users how to get past Gatekeeper.

Windows builds are unsigned; SmartScreen warns on first run — including when the updater runs the downloaded NSIS installer, the same warning as a manual install.

**Update signing is separate from both, and not optional.** The updater uses its own minisign key pair, generated once with `npx tauri signer generate --write-keys <path>`:

| Half | Where it lives |
| --- | --- |
| public | `plugins.updater.pubkey` in `tauri.conf.json`, compiled into every build |
| private | repository secret `TAURI_SIGNING_PRIVATE_KEY`, with its passphrase in `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` |

`bundle.createUpdaterArtifacts` makes Tauri emit the updater bundle and its `.sig` alongside the normal ones. A build without the secrets does **not** quietly skip signing — it aborts (see [Manual builds](#manual-builds--the-dress-rehearsal)).

**`@tauri-apps/cli` must stay at 2.11.5 or newer.** From that release on, the app version is written into each signature's trusted comment, which `requireSignedVersion: true` in `tauri.conf.json` enforces. An older CLI with the flag on produces signatures without that field, and every update fails with `MissingSignedVersion`. See [In-App Updates](security.md#in-app-updates) for what the flag buys.

**The private key is unrecoverable and, once a release has shipped, unreplaceable.** Installed apps trust exactly the compiled-in public key. Losing the private half means no installed app can ever be updated again — every user would have to reinstall by hand. It belongs in a password manager, not only on one machine.

## Cutting a release

1. Set the version in `package.json`, `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml` — character-identical in all three — and rename `## [Unreleased]` in `CHANGELOG.md` to `## [<version>] - <date>`.
2. Run `manual-desktop-builds.yml` from the branch and confirm all three platforms produce bundles.
3. Commit, push, then tag and push the tag. `prepare-release` re-checks the versions; if step 1 was skipped it fails there rather than later.

### Once, for the first release that carries the new identifier

That release is the one where `adopt_previous_identifier_dirs` runs for real, on machines that are not the author's (see [Product name vs. identifier](#product-name-vs-identifier)). It is verified on Windows only — the other two were reasoned about, not run. Before tagging, take a bundle from `manual-desktop-builds.yml` per platform and check it there:

| Platform | Put this in place first | Then confirm after the first start |
| --- | --- | --- |
| Windows | `%APPDATA%\com.emerald.magical-journal` with a `vaults.json`, `%APPDATA%\com.emerald.app` absent | the vaults are listed, and no `*.adopting` is left beside them |
| macOS | the same pair under `~/Library/Application Support/` | as above |
| Linux | the same pair under **both** `~/.local/share/` and `~/.config/` — they are separate directories there | as above, and specifically that adoption happened *despite* `~/.local/share/com.emerald.app` already existing: Tauri creates it as the webview profile before any of our code runs, and getting that wrong would skip the adoption for good |

The Linux row is the one worth the trouble: it is the case no test here can reach.

Delete this section once that release is out.

## Known gaps

- CI proves compilation, not bundling. Only a manual or release build does that.
- Nothing proves the update path automatically. Checking it means publishing a prerelease and driving it from an installed build (see [Testing the updater](#testing-the-updater)).
- The changelog extraction cannot fail — an empty section yields an empty release body silently.
- Nothing runs clippy, and warnings do not fail a build. (`src-tauri/Cargo.toml` declares an empty `cargo-clippy` feature so that a manual clippy run compiles; CI does not use it.)
- Little is covered by automated tests. The Rust tests in `vault.rs` cover the adoption of a previous identifier's data, the vault's own JSON files (`settings.json`, `drafts.json`) and pruning of migration backups; those in `lib.rs` cover the watchdog behind closing the window; those in `db.rs` cover the SQL authorizer and the value round trip, in `crypto.rs` the sealed format and its context binding, in `keys.rs` the key file, recovery key and unlock paths, in `reencrypt.rs` the re-encryption and its crash recovery, and in `backup.rs` the backup container. `rust-tests.yml` runs them on all three platforms. The frontend has only the `check:*` scripts in CI. Everything else is verified by running the app by hand.
- **What `rust-tests.yml` does not prove:** `vault.rs` has no `cfg(target_os)` at all, so its tests are the same everywhere. The matrix buys the three path parsers and `rename` semantics against each other — plus the Rust side being *linked* on a push, not only checked. It does **not** cover the Linux case that shaped the adoption, because that lives in Tauri's startup order rather than in our code. Only a real start on Linux shows it, which is why the [release checklist](#once-for-the-first-release-that-carries-the-new-identifier) still asks for one.
- The apt package list for Linux exists in four workflow files. Adding a system dependency in `ci.yml` alone leaves the others red on Linux only. The keychain needs a running Secret Service on the user's machine, not in CI: nothing there exercises "remember on this device".
