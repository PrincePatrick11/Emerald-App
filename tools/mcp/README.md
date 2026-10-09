# Emerald DevTools MCP

An **MCP (Model Context Protocol)** server that lets an LLM drive a running
[Emerald](https://github.com/PrincePatrick11/Emerald-App) Tauri app via the
**Chrome DevTools Protocol**. The LLM can run JavaScript in the app, inspect
the DOM, click buttons, fill fields, capture console output, and take
screenshots — as an outside process, with nothing of it built into the app.

## What this is for

Emerald is a local-first Tauri desktop journal. When you're developing Emerald,
you often want an AI assistant to **validate that code changes actually work**:
"Create a journal entry titled 'Test', confirm the title was saved, take a
screenshot, check the console for errors." This MCP makes that loop possible
without the assistant having to drive the app via fragile screen coordinates
or guessed shortcuts.

The MCP works by talking to WebView2's built-in debugging port — no
modifications to the Emerald codebase are required.

The MCP never drives the regular Dev or Prod build. It runs Emerald in
instances of its own, each with its own app identifier, database and debug
port: the main checkout on 9223, and each git worktree on one of four more, so
several branches can be driven at once. See "Environments and slots" below.

## What this is **not**

- Not a Tauri test runner. It drives the rendered WebView, not the Rust side.
- Not tied to a specific LLM. It speaks MCP, so any MCP client works.
- Not a CI tool. It launches a local dev instance of Emerald for interactive use, not a headless/reproducible CI build.
- Not headless either, despite the missing window. The app runs normally, just off-screen — which is what keeps screenshots showing the truth.

## Architecture

```
┌─────────────────────┐     ┌──────────────────────┐     ┌─────────────────┐
│   LLM / MCP client  │────▶│  This MCP server     │────▶│  Edge WebView2   │
│  (Hermes, Claude)   │     │  (Python, stdio)    │     │  port 9223 + slot│
└─────────────────────┘     └──────────────────────┘     └─────────────────┘
```

- **MCP server** (`server.py`): a Python stdio MCP server exposing 15 tools
  (snapshot, click, type_text, dialog, eval, screenshot, etc.).
- **CDP client** (`cdp.py`): a thin aiohttp wrapper around the Chrome DevTools
  Protocol WebSocket API. What it runs inside the page - the outline behind
  `snapshot`, locating elements, checking that input arrived - is `pagelib.js`.
- **Native dialogs** (`dialogs.py`): file pickers and message boxes are windows
  of the app's process rather than part of the WebView, and are found and
  answered through the window system.
- **Instance resolution** (`instance.py`): works out which checkout this
  session belongs to and derives every port, path and identifier from it, so
  one worktree per instance costs nothing to set up.
- **Window handling** (`tauri_config.py`, `window.py`): generates the Tauri
  overlay and moves the window off-screen, so a run does not put a window in
  front of whoever is using the machine.
- **Seed vault** (`seed/`): fills a new instance's database with test data.
- **Hermes skill** (`skills/emerald-app-control.md`): a ready-to-use skill for
  the [Hermes](https://hermes-agent.nousresearch.com) desktop app that tells
  the assistant exactly which selectors and patterns work for Emerald.

## Environments and slots

Emerald splits Dev and Prod purely via a Tauri config overlay: a second
`identifier` (e.g. `com.emerald.magical-journal.dev`) makes Tauri resolve a
separate OS app-data directory, which is where `emerald.db` lives — so each
identifier automatically gets its own database, with no environment code in
the app itself.

This MCP repo adds overlays the same way, so MCP-driven runs never touch the
database you're using interactively in the regular dev build. There is not one
MCP environment but one **per checkout**: the server works out which Emerald
checkout the session is running in and derives a *slot* from it, and every
value that could collide is derived from that slot.

| Environment | Identifier | Debug port | Vite port | Launched by |
| --- | --- | --- | --- | --- |
| Prod | `com.emerald.magical-journal` | — | — | `tauri build` |
| Dev | `com.emerald.app.dev` | 9222 | 1420 | `npm run tauri:dev` / `start_emerald_dev.bat` |
| MCP slot 0 (main checkout) | `com.emerald.magical-journal.mcp` | 9223 | 1430 | `start_emerald_mcp.bat` |
| MCP slot N (each worktree) | `com.emerald.magical-journal.mcp.N` | 9223+N | 1430+N | `start_emerald_mcp.bat` |

Everything derived from the slot (`instance.py`), with `HOME` =
`%LOCALAPPDATA%\emerald-mcp`:

| Value | Formula |
| --- | --- |
| CDP port | `9223 + slot` |
| Vite port | `1430 + slot` |
| Identifier | base, plus `.N` for slots above 0 |
| App data (and so `vaults.json`, and so the database) | `%APPDATA%\<identifier>` |
| Seed vault | `%APPDATA%\<identifier>\vaults\seed` |
| `CARGO_TARGET_DIR` | `HOME\targets\<slot>` — except slot 0 on a default install, which keeps `%LOCALAPPDATA%\emerald-mcp-target` so an existing warm build is not orphaned |
| State dir (generated config, launch logs) | `HOME\slots\<slot>` |

Slot 0 keeps the exact values the MCP environment had before slots existed, so
an existing setup is unaffected — same port, same identifier, same warm build
directory, same database.

Two sessions opened on the *same* checkout share a slot, and therefore drive
the same running app. That is intended: one app per checkout.

See **Per-worktree instances** and **Seed vault** below for the registry and
the test data.

The MCP overlay lives **in this repo**, not in Emerald-App. `tauri dev
--config` accepts a path to a config file anywhere on disk, so
`start_emerald_mcp.bat`/`.sh` loads one from here:

```
npx tauri dev --config "<generated per-instance config>"
```

The generated config is written to the instance's state dir at launch. It is
built by reading the checkout's *own* `src-tauri/tauri.windows.conf.json` and
layering the per-slot values and the off-screen window settings on top, rather
than spelling the window out — Tauri replaces the `app.windows` array wholesale
instead of merging it, so a hand-written overlay would silently drop whatever
Emerald-App set there. `tauri.mcp.conf.json` is still checked in, but only as
the fallback for running the script by hand with no environment set.

That is deliberate: the devtools setup must leave **no trace** in the official
app repo — no extra config file, no extra npm script, and no build artifacts
(see the target-directory note below). Emerald-App only ships the Dev overlay
it uses itself.

Besides the identifier, the overlay also overrides the Vite port (1430 instead
of 1420) via `beforeDevCommand`/`devUrl`. That part is not optional: Emerald's
`vite.config.ts` sets `strictPort: true` on 1420, so a second instance would
abort instead of picking a free port.

`EMERALD_AUTO_LAUNCH` (default on) spawns `start_emerald_mcp.bat` by default,
so the MCP server always drives the isolated MCP environment unless you
override it. Because it uses a different debug port *and* a different Vite
frontend port than the regular dev build, you can keep a manual
`npm run tauri:dev` session open at the same time without port conflicts.

Dev and MCP also use **separate Cargo target directories**, set via
`CARGO_TARGET_DIR` in `start_emerald_mcp.bat`/`.sh`:

| | Dev | MCP |
| --- | --- | --- |
| Windows | `src-tauri/target` | `%LOCALAPPDATA%\emerald-mcp-target` |
| macOS/Linux | `src-tauri/target` | `${XDG_CACHE_HOME:-~/.cache}/emerald-mcp-target` |

Both builds would otherwise produce the same `target/debug/emerald.exe`, and
Windows refuses to overwrite an `.exe` that's currently running — so without
this, building one while the other is running fails outright rather than just
queuing.

The MCP target dir lives outside both repos, for two reasons: nested inside
`src-tauri/` it would break the build (`tauri dev` watches that whole folder
for rebuild triggers, so every build-artifact write looks like a source change
— infinite rebuild loop), and anywhere else under Emerald-App it would leave
several GB of devtools artifacts sitting in the official repo as untracked
files.

Cost: one extra full compile the first time (~2–3 min) plus several GB of disk.
After that the cache is warm and an unchanged MCP start takes ~15 s. This only
applies when launching via `start_emerald_mcp.bat`/`.sh` (or the MCP server's
auto-launch, which uses that script) — invoking `npx tauri dev` by hand does
not set `CARGO_TARGET_DIR` and can still collide with a running Dev build.

To point the MCP server at a manually-started **regular dev** instance
instead (e.g. to inspect data you're editing by hand), set:
```bash
EMERALD_CDP_PORT=9222
EMERALD_AUTO_LAUNCH=0
```
and start Emerald yourself with `start_emerald_dev.bat` / `npm run tauri:dev`.
Note that `EMERALD_CDP_PORT` overrides the slot's own port, so set it per
session and never in the server registration — see **Registering the server**.

## Quick start

### 1. Install dependencies

```bash
cd tools/mcp
python -m pip install -r requirements.txt
```

Or with [uv](https://github.com/astral-sh/uv):

```bash
uv venv
.venv\Scripts\activate
uv pip install -r requirements.txt
```

**The `mcp` pin matters.** `requirements.txt` says `mcp>=1.2.0,<2` — `server.py`
is written against the 1.x low-level API (`@app.list_tools()`,
`@app.call_tool()`, `mcp.server.stdio.stdio_server()`), which mcp 2.0 removed.
An unpinned install pulls 2.x and the server dies on import, before it can
answer a single MCP message:

```
AttributeError: 'Server' object has no attribute 'list_tools'
```

The client just shows the server as unavailable with no tools — the traceback
only appears on the server's stderr. If that happens after rebuilding the venv,
check the installed version first:

```bash
uv pip install --python .venv/Scripts/python.exe "mcp>=1.10,<2"
```

### 2. Launch Emerald with remote debugging enabled

**You normally don't need to do this manually.** With `EMERALD_AUTO_LAUNCH=1`
(the default), the MCP server spawns the launcher itself the first time a tool
needs the app — see "Auto-launch" below. Manual start is still there as a
fallback, and then uses the checked-in `tauri.mcp.conf.json`: slot 0, on
screen, so you can watch it.

```bash
# Windows (from this folder)
start_emerald_mcp.bat

# macOS / Linux
./start_emerald_mcp.sh
```

**Prerequisites** (one-time, on the Emerald side):
- Rust toolchain (https://rustup.rs)
- Visual Studio Build Tools with the C++ workload (Windows)
- Node.js ≥ 18
- The Emerald repo cloned and `npm install`ed once

**Which checkout the launchers build.** By default the one they live in,
two levels up from `tools/mcp/`. To build another one, override it instead of
editing the scripts —
`EMERALD_APP_DIR` on Windows, `EMERALD_DIR` on macOS/Linux:

```bash
# Windows
set "EMERALD_APP_DIR=C:\path\to\Emerald-App"
start_emerald_mcp.bat

# macOS / Linux
EMERALD_DIR=/path/to/Emerald-App ./start_emerald_mcp.sh
```

The launcher checks for `package.json` at that location and fails with the
resolved path in the message, so a wrong layout is obvious immediately.

The first build takes 5-15 minutes (297 crates to compile); subsequent runs
are seconds. Started by hand as above a window appears; started by the MCP it
does not — it is moved off-screen as soon as the app is up, so use `screenshot`
rather than looking for it.

### Auto-launch

When a tool call needs the app (e.g. `eval`, `snapshot`, `click`) and no CDP
target is reachable, `_ensure_target()` (in `server.py`) spawns
`start_emerald_mcp.bat` itself (see `launcher.py`) and waits up to
`EMERALD_LAUNCH_POLL_WAIT` seconds (default 25s) per call for the debug port
to come up. If the app is still building/starting when that wait expires,
the tool call returns an `ERROR: Emerald is still starting...` message with
elapsed/remaining time and a log path — just retry the same tool call; the
launch itself keeps running in the background (up to `EMERALD_LAUNCH_TIMEOUT`,
default 900s / 15 min total) and later calls only need to wait out however
much of the cold build is left. Concurrent tool calls never spawn more than
one Emerald instance. Once launched, Emerald keeps running independently of
the MCP server process — closing/restarting the MCP server does not close
the app.

Set `EMERALD_AUTO_LAUNCH=0` to disable this and go back to requiring a
manual start (useful if you want full control over when/how Emerald starts).

### 3. Verify the debug port is reachable

The port is 9223 plus the slot number, so take it from `status` rather than
assuming. For the main checkout:

```bash
curl http://127.0.0.1:9223/json/version
```

You should see a JSON response like:
```json
{
  "Browser": "Edg/150.0.4078.83",
  "Protocol-Version": "1.3",
  ...
}
```

### 4. Wire the MCP into your LLM client

**Hermes** (`~/.hermes/config.yaml`):
```yaml
mcp:
  servers:
    emerald-devtools:
      command: python
      args:
        - C:/Users/.../Emerald-App/tools/mcp/server.py
      env:
        EMERALD_CDP_HOST: 127.0.0.1
        EMERALD_AUTO_ATTACH: 1
        EMERALD_AUTO_LAUNCH: 1
```

**Claude Desktop** (`%APPDATA%\Claude\claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "emerald-devtools": {
      "command": "python",
      "args": ["C:/Users/.../Emerald-App/tools/mcp/server.py"],
      "env": {
        "EMERALD_CDP_HOST": "127.0.0.1",
        "EMERALD_AUTO_ATTACH": "1",
        "EMERALD_AUTO_LAUNCH": "1"
      }
    }
  }
}
```

**Claude Code** needs nothing: the `.mcp.json` at the repository root registers
the server for every session in a checkout, started through
[uv](https://github.com/astral-sh/uv) from that checkout's own `tools/mcp/`.
To register it user-wide instead, so it is available in any project folder:
```bash
claude mcp add emerald-devtools -s user \
  -e EMERALD_CDP_HOST=127.0.0.1 \
  -e EMERALD_AUTO_ATTACH=1 \
  -e EMERALD_AUTO_LAUNCH=1 \
  -e EMERALD_LAUNCH_TIMEOUT=900 \
  -e EMERALD_LAUNCH_POLL_WAIT=25 \
  -- "C:/Users/.../Emerald-App/tools/mcp/.venv/Scripts/python.exe" "C:/Users/.../Emerald-App/tools/mcp/server.py"
```

**Do not set `EMERALD_CDP_PORT` here.** It pins every session to one port, so a
worktree would resolve its own slot and then talk to slot 0's app anyway -
per-worktree instances would silently do nothing. `status` warns when it is set
and disagrees with the slot. `EMERALD_LAUNCHER_PATH` is unnecessary too; it
already defaults to `start_emerald_mcp.bat` in this repo.

If you registered the server before slots existed, remove both keys from
`mcpServers.emerald-devtools.env` in `~/.claude.json` and restart the client.


### 5. Use it

Ask the assistant:

> "Use the emerald-devtools MCP to create a new journal entry titled
> 'Vollmond-Ritual', then take a screenshot and show me the console logs."

The assistant will call the MCP tools, drive the UI, and report back.

## Tools exposed by the MCP

| Tool | What it does |
| --- | --- |
| `status` | Which instance this session drives, whether it is running and attached, and how a launch in progress is doing |
| `connect` | List the CDP targets (WebView pages) of the instance |
| `attach` | Attach to a specific target instead of the main window |
| `snapshot` | The page as a compact outline: one line per element that is structure or can be acted on, with role, name, value and state. Actionable elements carry a ref (`@e7`). Options: `selector` (a subtree), `interactive` (flat list of what can be acted on), `classes` |
| `click` | Click with real mouse events - left, right, double. Refuses an element that is disabled, hidden or covered, and names what covers it; `force` clicks anyway |
| `hover` | Move the mouse over an element |
| `type_text` | Type into an input, textarea or contenteditable editor (Tiptap) through the keyboard path; reports what the field reads afterwards |
| `press_key` | Press a key or shortcut (`Enter`, `Escape`, `Control+K`) |
| `wait_for` | Wait until an element is `visible` (default), `attached`, `hidden` or `detached` |
| `eval` | Run JavaScript as in a DevTools console - top-level `await` works, DOM nodes come back as outerHTML, the result is capped at `max_chars` |
| `console_logs` | Console output and uncaught exceptions; `level`, `limit`, `clear` |
| `screenshot` | Capture a PNG of the window or of one element (`selector`), optionally scaled. Returns a viewable image plus the path it was saved to under the instance's state dir |
| `navigate` | Load a URL, or reload when none is given, and wait for the page to finish loading |
| `dialog` | List and answer the app's native dialogs - file pickers and message boxes, which are not part of the page |
| `reset_database` | Throw this instance's database away and start again on freshly seeded test data. Needs `allow_main` for slot 0 |

Every `selector` accepts three forms: a CSS selector, a ref from `snapshot`
(`@e7`), or `text=Visible text`. A ref stays valid for as long as its element
is in the page, so a snapshot followed by a few actions needs no selector
guessing at all. A failed tool call is returned with `isError` set.

## Configuration (environment variables)

| Var | Default | Description |
| --- | --- | --- |
| `EMERALD_APP_DIR` | discovered | Force the app checkout instead of deriving it from the session's directory |
| `EMERALD_CDP_HOST` | `127.0.0.1` | WebView2 debug host |
| `EMERALD_CDP_PORT` | *slot-derived* | **Override**, not a default. Pins the port regardless of slot; set it per session (e.g. `9222` to drive a manually-started regular dev instance), never in the server registration |
| `EMERALD_AUTO_ATTACH` | `1` | If 1, auto-attach to the app's main `page` target on first use |
| `EMERALD_AUTO_LAUNCH` | `1` | If 1, spawn `start_emerald_mcp.bat` automatically when no target is found |
| `EMERALD_LAUNCHER_PATH` | `<repo>/start_emerald_mcp.bat` | Path to the launcher script |
| `EMERALD_LAUNCH_TIMEOUT` | `900` | Overall seconds to keep waiting for a cold start before giving up |
| `EMERALD_LAUNCH_POLL_WAIT` | `25` | Seconds `_ensure_target()` blocks per tool call while waiting for the port |
| `EMERALD_LAUNCH_POLL_INTERVAL` | `1.5` | Seconds between port checks while polling |
| `EMERALD_LAUNCH_LOG_DIR` | `<state dir>/logs` | Where per-launch-attempt logs are written |

Per-instance knobs (`instance.py`, `tauri_config.py`, `seed/`):

| Var | Default | Description |
| --- | --- | --- |
| `EMERALD_MCP_HOME` | `%LOCALAPPDATA%/emerald-mcp` | Registry, per-slot state and **all** build directories. Setting it moves slot 0's build directory too, so pointing it at a roomier drive actually empties the old one |
| `EMERALD_MCP_SLOT` | *allocated* | Force a slot number and skip the registry |
| `EMERALD_MCP_MAX_SLOTS` | `4` | Size of the worktree slot pool. Each slot costs a build directory of roughly 8 GB |
| `EMERALD_MCP_IDLE_HOURS` | `2` | Unused this long and the instance is stopped; its slot can then be taken over. `0` disables both. Normally set in the tray app, which stores it in `<HOME>/config.json`; this variable overrides that file when present |
| `EMERALD_MCP_TARGET_TTL_DAYS` | `14` | Unused this long and the build directory is deleted (the slot keeps its number) |
| `EMERALD_MCP_IDENTIFIER_BASE` | `com.emerald.magical-journal.mcp` | Identifier the per-slot suffix is appended to |
| `EMERALD_MCP_OFFSCREEN_XY` | *computed* | e.g. `40,40` to bring the window back on screen and watch a run |
| `EMERALD_MCP_MIN_FREE_BYTES` | `12 GiB` | Below this, a new slot builds cold instead of copying a warm target dir |
| `EMERALD_MCP_SEED` | unset | `force` re-provisions the seed vault even when `vaults.json` already exists |

## The Hermes skill

`skills/emerald-app-control.md` is a **ready-to-import skill** for
[Hermes](https://hermes-agent.nousresearch.com), a desktop AI assistant that
speaks MCP. It contains the selectors, patterns, and pitfalls learned from
hours of live testing — including the non-obvious commit mechanics for
Operations, the right-click Delete pattern that replaces the broken
drag-and-drop, and the per-area body-editor structure.

What's inside the skill:
- Exact CSS selectors for each editor (Journal title, Wiki title, Tasks input,
  Operations intent textarea, etc.)
- The right-click context-menu pattern for delete/rename (drag-and-drop is
  broken in WebView2)
- The "rename" workflow that Operations need to commit a title (Operations
  do **not** respond to `entry-view-title.blur()` like Wiki does)
- Per-area body editor structure (ProseMirror for most, plain textareas for
  Operations, no body for Tasks)
- Navigation by lucide icon class on the sidebar rail — the rail buttons are
  icon-only, share one class, and differ only by a translated `title`, so
  icon classes are the one language-independent handle
- Pitfalls: selectors built on `title`/`innerText` breaking in other
  languages, `.sidebar-item` being list rows rather than navigation,
  btn-primary existing only in list views, Settings being a modal that leaves
  the rail visible, race conditions between `blur()` and React re-render

**What is a Hermes skill?** A structured Markdown document with YAML
frontmatter (name, description, version) and a body of instructions. The
assistant reads the skill at conversation start and uses it as a playbook
when the user asks for tasks in the skill's domain. A good skill contains
trigger conditions, step-by-step workflows, verified selectors, pitfalls,
and verification steps.

### Customizing the skill for your machine

The skill in this repo is a **template with placeholder paths** (`<REPO>`,
`<APP>`, `<CONFIG>`, etc.) so it can be safely shared. Before loading it
into Hermes, **personalize it**:

1. Copy `skills/emerald-app-control.md` to your local Hermes skills directory:
   ```bash
   # Windows
   copy skills\emerald-app-control.md %APPDATA%\Hermes\skills\
   ```
2. Open the copied file and ask the assistant (in Hermes) to fill in the
   placeholders for your machine, e.g.:
   > "Lies die Datei `emerald-app-control.md` und ersetze die Platzhalter
   > `<REPO>`, `<APP>` etc. durch meine echten Pfade. Der MCP
   > liegt unter `C:\Users\myname\Projects\Emerald-App\tools\mcp`, Emerald-App
   > unter `C:\Users\myname\Projects\Emerald-App`. Speichere die Änderung."
3. Save the file. The skill is reloaded at next Hermes startup.

**Do not commit your personalized version back to this repo** — the template
exists specifically so the repo can be shared with paths replaced.

**Linking for live updates:** if you want your personalized version to stay
in sync with the template, use a symlink:
```bash
# Windows (run as admin)
mklink %APPDATA%\Hermes\skills\emerald-app-control.md skills\emerald-app-control.md
```

After loading (or symlinking) and starting Hermes, the skill is available.

## Per-worktree instances

Which app the MCP drives is derived from where the session is running, not
configured. On startup the server resolves the checkout, first match wins:

1. `EMERALD_APP_DIR`, if set. A value that is not an Emerald checkout is an
   error rather than a silent fallback — setting it is always deliberate.
2. `git rev-parse --show-toplevel`. Inside a worktree this returns the
   *worktree* root, which is exactly the distinction that is needed.
3. A walk up the directory tree, for a session started in a subdirectory or a
   checkout that is not a git repository.
4. The sibling `Emerald-App`, so a session in this repo still drives something
   sensible.

The checkout is then mapped to a slot in `%LOCALAPPDATA%/emerald-mcp/registry.json`:

```json
{
  "version": 1,
  "slots": {
    "1": {
      "checkout": "C:/Users/you/Documents/Emerald-App/.claude/worktrees/some-branch",
      "name": "some-branch",
      "created_at": "2026-09-09T07:51:59Z",
      "last_seen_at": "2026-09-09T07:51:59Z"
    }
  }
}
```

Slot 0 is reserved for the main checkout and never appears in the registry.
Everything else draws from a **fixed pool** of `EMERALD_MCP_MAX_SLOTS` slots
(default 4). Allocation happens under a lock file, so two sessions starting at
the same moment cannot be handed the same slot.

A pool rather than a slot per worktree ever seen, because each slot costs a
Cargo build directory of roughly 8 GB. Four worktree slots plus slot 0 is about
40 GB, and it does not grow from there.

A slot is taken over when its checkout is **gone**, or when nobody has used it
for `EMERALD_MCP_IDLE_HOURS`. Taking over stops the instance and **wipes its
vault**, so the new occupant starts on freshly seeded fixtures instead of
another branch's test data. The build directory is deliberately kept: the new
occupant reuses it, and Cargo recompiles only what actually differs, which is
why a takeover costs a minute rather than a cold build.

If all four are held and none is idle, the tool call **fails** with the four
holders and their idle times rather than evicting a session someone is working
in. Close one, wait for it to go idle, or raise the limit.

The idle clock measures *use*, not uptime: every tool call refreshes the slot.
A session that sits open all afternoon without driving the app will be stopped
after two hours and simply restarts, warm, on its next call.

Cleanup runs by itself at launch, in the launcher script rather than the server
so that deleting several GB never stalls a tool call. To do it by hand:

```bash
python instance.py --list                 # every slot, what it holds, what it costs
python instance.py --reap                 # stop instances nobody is using
python instance.py --prune --dry-run      # what cleanup would delete
python instance.py --prune                # delete it
```

`status` reports the resolved instance — slot, checkout, how it was found,
ports, identifier, vault, target dir — so a run in the wrong worktree is
visible in the output rather than something to deduce.

**Cost per slot:** one Cargo target directory, around 8 GB, and the pool caps
how many there can be. A new slot is
seeded by copying an existing warm one (`robocopy /E`, timestamps preserved
because Cargo compares mtimes), which turns a 5-15 minute cold build into a
couple of minutes. Below `EMERALD_MCP_MIN_FREE_BYTES` free disk the copy is
skipped and the slot builds cold instead.

A copied or moved build directory needs one repair before it builds. Cargo
itself copes with a relocated target dir, but tauri's build scripts write
absolute paths into their outputs (the permission file lists under `out/`, the
`DEP_*` metadata), and Cargo has no reason to re-run them - so the build reads
permission files at the old location and fails once that is gone. The launcher
therefore runs `instance.py --relocate-target` before every build: it reads the
old root from each build script's `root-output`, rewrites it (raw and
JSON-escaped, modification times preserved) and does nothing when the directory
has not moved. To reclaim space by hand, delete
`<HOME>/targets/<slot>` — it is rebuilt on next use.

A fresh worktree also has no usable `node_modules` (`git worktree add` does not
copy it), so the launcher runs `npm install` the first time. That is a one-off
minute or two, and it has to happen before the seed can be built.

## Seed vault

A brand-new instance starts with a database containing nothing but the built-in
categories — an empty screen, with nothing to test a view against. So the
launcher provisions a vault of test data first.

Emerald is vault-based: the database is not in the app-data directory, it is in
a directory named by `<app-data>/vaults.json`. Seeding therefore means writing
an `emerald.db` somewhere and registering it as the active vault. It goes to
`%APPDATA%/<identifier>/vaults/seed`, which is where the app itself puts vaults
it creates.

`seed/build_seed.mjs` builds the database by bundling the **checkout's own**
`src/lib/schema.ts` (esbuild, Tauri modules stubbed, `node:sqlite` behind the
app's database interface — the technique comes from Emerald-App's
`scripts/schema-check.mjs`) and calling the real `createSchema` and
`seedBuiltins`. A worktree whose branch changed the schema gets a seed for
*its* schema, which a golden `.db` committed here never could.

The finished file is stamped at `BASELINE_VERSION`, so the app treats it as
current and the migration chain never runs against it — worth being strict
about, since only migrations up to v32 tolerate pre-existing schema and v33+
fail loudly. `--verify` proves it by running the real `runMigrations` and
asserting that nothing was applied.

`seed/fixture.json` holds the data: entries across every module, categories,
tags, internal link chips (expanded through the app's own
`internalLinkChipHtml`, so the markup cannot drift from the editor), a subtask,
a task link, an altar with placements — and one soft-deleted row in each
module, so the trash is testable without deleting something first. Columns are
filtered against `PRAGMA table_info`, so a column the app drops later is
ignored instead of breaking the build.

The fixture is written in the shape Emerald had up to v48, with journal
entries, wiki articles and operations in three tables. Checkouts since v49
keep them in one `entries` table, and since v53 list an entry's tags by id;
`build_seed.mjs` translates the fixture when it meets such a checkout
(`fitFixture`), so one file serves old branches and new ones. The fixture
brings its own categories and relies on none of the app's built-in ones apart
from `sigils` — a built-in that disappears would otherwise fail the build on a
foreign key, which is what `other` did.

**Encrypted vaults.** A checkout with vault encryption opens no plain vault:
its dev build encrypts the seed on the first start, with the test password
`emerald-seed` (`SEED_PASSWORD` in `launcher.py`), and unlocks it with that
password from then on. The launcher passes folder and password as
`EMERALD_DEV_SEED_VAULT` and `EMERALD_DEV_SEED_PASSWORD`; release builds do not
read them, and any other vault still asks for its own password. Older
checkouts ignore both and open the seed as before.

**Existing instances are never touched.** `provision.mjs` stops as soon as it
finds a `vaults.json`, which is what keeps a long-lived instance with real work
in it out of this entirely. `EMERALD_MCP_SEED=force` overrides that.

To check a built seed by hand — before the app has encrypted it; after that
`check_seed.mjs` says so and stops:

```bash
node seed/check_seed.mjs "%APPDATA%/com.emerald.magical-journal.mcp.1/vaults/seed/emerald.db"
```

## The tray app


Without something running continuously, the idle timeout is not actually
enforced: the reaper only runs from the launcher script, so an instance nobody
is using stays up until some *other* instance happens to start. `tray.py` is
that missing clock, and while it is there it may as well show what the
registry only records.

```bash
python tray.py                      # tray icon, window on click
python tray.py --show               # open the window straight away
python tray.py --install-autostart  # start it at every logon, silently
python tray.py --remove-autostart
```

It shows one row per slot - which worktree holds it, whether it is running,
how long it has been idle, its port, and on request the size of its build
directory. Any slot can be stopped by hand from here, including slot 0, which
the automatic reaper always leaves alone. The idle timeout is edited here
rather than through an environment variable, and lands in `<HOME>/config.json`
so it also reaches MCP servers that started before the change.

**Watching a slot.** "Auf Hauptbildschirm holen" (or a double-click on the
row) centres that slot's window on the primary monitor and puts it back in the
taskbar; "Wieder ausblenden" sends it out again. Fetching it is remembered, not
a one-off move — every MCP server re-places the window on each attach and each
`status` call, and would otherwise push it straight back out. A window you then
drag to another monitor stays there, and after an app restart it comes back on
screen by itself. The automatic path never takes focus, so an agent calling
`status` cannot pull a window in front of what you are typing into; only the
button does. The preference is dropped when a slot changes hands.

**Releasing a slot.** "Zuweisung aufheben" takes a stopped slot away from its
worktree, for one you are done with but have not deleted (a deleted worktree
frees its slot by itself). The slot's test vault is deleted; its build
directory stays for the next occupant. A running slot has to be stopped first.
If a Claude session is still open in that worktree, its server notices on the
next tool call - it checks the registry every time - and claims a slot afresh
rather than carrying on on a port someone else may now hold.

**Starting an instance.** The Checkout list holds the main checkout and every
git worktree of it, including ones no session has claimed yet. "MCP-Instanz
starten" takes the same route a server would: the worktree gets its slot (and a
freshly seeded vault if the slot is new to it), and the launcher runs without a
console. Once the app is up, the tray moves its window out of sight, because no
server is attached to do it. A server that later wants the same slot finds the
launcher in the registry and waits for it rather than starting a second one,
which would lose to the first on the Vite port. With no console, build output
and errors go to the launch log - "Log öffnen" shows the selected slot's latest.

**The dev session.** The top section starts and stops the regular dev build:
`start_emerald_dev.bat`, i.e. `npm run tauri:dev` in the main checkout
(identifier `com.emerald.app.dev`, debug port 9222). Its window is on screen as
usual; only the console is gone, and its output goes to `<HOME>/dev/logs/`. A
dev session is recognised however it was started - by a running `emerald.exe`
under `Emerald-App/src-tauri/target`, or by Vite on 1420 while it builds - so
one started by hand shows as "nicht hier gestartet" and is never started twice.
Stopping one of those ends the app by its executable and Vite by its port.

The dev window also gets a thin coloured frame (amber by default), so it
cannot be mistaken for the installed app. It is set from outside through DWM's
border colour, not in the app, and only while the tray runs; the tray re-applies
it every two seconds because a Rust rebuild replaces the window. Switch it off
or pick another colour in the dev section - stored as `dev_border` in
`<HOME>/config.json`. Windows 11 only; older versions ignore it.

Every minute it reaps idle instances; every hour it prunes build directories.
Both also still run at launch, so cleanup does not depend on the app being up -
it just becomes timely when it is.

Needs `pystray` and `Pillow` (`uv pip install pystray Pillow`); `tkinter` ships
with Python.

**Autostart writes the state directory into the generated `.vbs`**, not only
into a user environment variable. A variable set now only reaches processes
started later, so an app launched at logon from an older environment would
read the default state directory and report, confidently, on the wrong set of
slots. Under `pythonw` there is no stderr either, so it logs to
`<HOME>/tray.log` - including a line at every start, so an empty log cannot be
mistaken for a quiet one.

## Repository layout

```
tools/mcp/
├── server.py              # MCP server (stdio): the tool catalog and its handlers
├── cdp.py                 # Chrome DevTools Protocol WebSocket client
├── pagelib.js             # What cdp.py runs inside the page: outline, locating, input checks
├── dialogs.py             # Native file pickers and message boxes, through the window system
├── instance.py            # Checkout -> slot -> every port, path and identifier
├── tauri_config.py        # Generates the per-instance Tauri config overlay
├── window.py              # Moves the instance's window off-screen and out of the taskbar
├── procs.py               # Ends a slot's process tree when it is reclaimed
├── tray.py                # System tray app: the control panel for the slots
├── devsession.py          # The regular dev session, started without a console
├── launcher.py            # Auto-launch logic (spawns/tracks/polls the Emerald process)
├── seed/
│   ├── build_seed.mjs     # Builds an emerald.db from the checkout's own schema
│   ├── provision.mjs      # Creates the seed vault and registers it in vaults.json
│   ├── check_seed.mjs     # Asserts a built seed is one the app will actually open
│   └── fixture.json       # The test data
├── tests/
│   ├── page.html          # The fixture page the CDP tests drive
│   ├── test_cdp.py        # cdp.py and pagelib.js against a headless Edge
│   ├── test_server.py     # server.py over stdio, as a client sees it
│   └── test_dialogs.py    # dialogs.py against real dialogs (EMCP_TEST_DIALOGS=1)
├── requirements.txt       # Python dependencies (mcp<2, aiohttp)
├── requirements-dev.txt   # ... plus pytest
├── pytest.ini
├── tauri.mcp.conf.json    # Fallback overlay for running the launcher by hand (slot 0, on screen)
├── pyproject.toml         # Setuptools project metadata
├── start_emerald_dev.bat  # Windows launcher — regular dev environment, port 9222
├── start_emerald_dev.sh   # macOS/Linux launcher — regular dev environment, port 9222
├── start_emerald_mcp.bat  # Windows launcher — MCP instance (default auto-launch target)
├── start_emerald_mcp.sh   # macOS/Linux launcher — MCP instance
├── skills/
│   └── emerald-app-control.md   # Hermes skill (import in ~/AppData/Local/hermes/skills/)
├── .gitignore
└── README.md
```

Per-instance state lives outside the repo, under `%LOCALAPPDATA%/emerald-mcp/`:

```
emerald-mcp/
├── registry.json          # checkout -> slot, plus each slot's launcher pid
├── dev/
│   ├── dev.json           # launcher pid of a dev session started from the tray
│   └── logs/
├── slots/<slot>/
│   ├── tauri.mcp.generated.conf.json
│   └── logs/              # one file per auto-launch attempt
└── targets/<slot>/        # Cargo build dir (slot 0 keeps %LOCALAPPDATA%/emerald-mcp-target)
```

## Development

Run the MCP in dev mode to see logs (it logs to stderr by default):

```bash
python server.py
```

Inspect what the instance machinery decides, without starting anything:

```bash
python instance.py            # this directory's slot, ports, paths
python instance.py --list     # every slot and what it costs on disk
python tauri_config.py        # the Tauri overlay that would be generated
```

Check a built seed database:

```bash
node seed/check_seed.mjs "<vault>/emerald.db"
```

Run the tests. They drive a headless Edge showing `tests/page.html` - the same
engine as WebView2 - so they need neither an Emerald build nor a slot, and
touch no registry:

```bash
pip install -r requirements-dev.txt
python -m pytest
```

The dialog tests open real Windows dialogs for a moment and are skipped unless
`EMCP_TEST_DIALOGS=1` is set.

Everything that looks at the DOM is in `pagelib.js`, which `cdp.py` sends
along with each call; `tests/test_cdp.py` is where a change to it is checked.

For a smoke test through the MCP itself, see the "Smoke-Test" section of
`skills/emerald-app-control.md`.

## Known limitations

- **WebView2 / Chromium only.** The MCP speaks the Chrome DevTools Protocol,
  which means macOS (WKWebView) and Linux (WebKitGTK) are not directly
  supported. The same code would work with adaptations for those engines.
- **First Emerald build takes 5-15 minutes.** Pre-compiled `target/`
  artifacts are not included in this repo; you build locally. Only the first
  build into an empty MCP target dir is expensive — once warm, an unchanged
  MCP start is ~15 s.
- **The window flashes for an instant at startup.** Windows refuses to create
  a window whose rectangle is entirely off-screen and quietly substitutes its
  default position — in the middle of the screen. So the window is born one
  pixel inside the bottom-right corner and moved out of sight as soon as the
  app is up. What you see is a sliver, in the corner, once per app start.
- **Off-screen, not hidden — on purpose.** `visible: false` would be simpler
  and is wrong: WebView2 stops producing frames for a window it treats as
  hidden, so `screenshot` would return a stale or empty image while everything
  else appeared to work. If screenshots ever do come back stale, check that
  `CalculateNativeWinOcclusion` is still in the `--disable-features` list
  (`instance.browser_args`) — Windows classifies a fully off-screen window as
  occluded, and an occluded window stops compositing.
- **`backgroundThrottling` is not the answer.** It exists as a Tauri window
  config key and reads like exactly what this needs, but its own schema says
  *Linux / Windows / Android: Unsupported*. The browser flags are the only
  lever on Windows.
- **A seed vault is only ever created, never updated.** It is built once when
  an instance is first provisioned. If the schema moves on, delete
  `%APPDATA%\<identifier>\vaults\seed\` and restart the instance, or set
  `EMERALD_MCP_SEED=force`. Resetting a *running* instance's data is not
  possible from outside: sqlx holds `emerald.db` open for the app's lifetime
  and Windows will not let go of the file.
- **A slot is per checkout, not per session.** Two sessions opened on the same
  checkout share an instance and drive the same window. That is intended.
- **Native dialogs are driven through the window system, not CDP.** File
  pickers and message boxes belong to the app's process, not to the WebView,
  so `snapshot` and `screenshot` do not show them; `dialog` does: it reads
  them, presses their buttons and fills in a file or folder path. The message
  of a task dialog (the modern message box) is drawn rather than made of
  controls and is read through UI Automation via PowerShell, which takes about
  half a second. Windows only. A path the app then refuses - Emerald only
  writes below the user's own folders - comes back as a follow-up dialog with
  the reason in it.
- **"Ready" means the app's page, not the debug port.** The port answers while
  the window is still on `about:blank`; a tool call in that moment waits for
  the real page and otherwise says to retry.
- **Real input first, synthetic as fallback.** `click` and `type_text` send
  input events through CDP and check that they arrived; if the page never saw
  them, the click is dispatched at the element instead and the result says
  so. Seeing that on every click means the real path is not getting through
  to this WebView.
- **Tauri menu items are not exposed via CDP.** You cannot trigger the
  File → Export as Markdown… menu from MCP. (Adding a Tauri command for
  this would require modifying the Emerald source, which is out of scope.)
- **No undo/redo exposed.** Tauri WebView doesn't give CDP control over
  these. The skill works around this by being explicit about state.

## License

Private repository. All rights reserved by the author.
