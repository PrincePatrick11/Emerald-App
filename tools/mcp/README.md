# Emerald DevTools MCP

An **MCP (Model Context Protocol)** server that lets an LLM drive a running Emerald app through the **Chrome DevTools Protocol**: read the page as an outline, click and type with real input events, answer native dialogs, read the console, take screenshots. It works from outside, as its own process, with nothing of it built into the app.

How to use it from a coding assistant is in [`Documentation/mcp.md`](../../Documentation/mcp.md). This file covers setup by hand, configuration and how it works.

## What this is not

- Not a Tauri test runner. It drives the rendered WebView, not the Rust side.
- Not tied to a specific LLM. It speaks MCP, so any MCP client works.
- Not a CI tool. It launches a local dev instance of Emerald for interactive use.
- Not headless, despite the missing window. The app runs normally, just off-screen, which is what keeps screenshots showing the truth.

## How it works

```
┌─────────────────────┐     ┌─────────────────────┐     ┌──────────────────┐
│   LLM / MCP client  │────▶│  This MCP server    │────▶│  Edge WebView2   │
│                     │ MCP │  (Python, stdio)    │ CDP │  port 9223       │
└─────────────────────┘     └─────────────────────┘     └──────────────────┘
```

- **`server.py`** — the tools and their handlers.
- **`cdp.py`** — a thin aiohttp client for the DevTools WebSocket. What it runs inside the page (the outline behind `snapshot`, locating elements, checking that input arrived) is `pagelib.js`.
- **`dialogs.py`** — file pickers and message boxes are windows of the app's process, not part of the WebView, and are found and answered through the window system.
- **`instance.py`** — works out which checkout the session belongs to and derives port, identifier and paths from it.
- **`launcher.py`**, **`start_emerald_mcp.bat`** — start the app when a tool needs it and nothing answers on the port.
- **`tauri_config.py`**, **`window.py`** — generate the Tauri overlay and move the window off-screen, so a run does not put a window in front of whoever is using the machine.

## The instance

The server drives the app checkout the session runs in: the git toplevel of the working directory, so a session in a worktree drives that worktree. `EMERALD_APP_DIR` forces another one.

It builds and starts that checkout as an instance of its own, apart from the regular dev build, so both can run at once:

| | Regular dev build | MCP instance |
| --- | --- | --- |
| Debug port | none | 9223 |
| Vite port | 1420 | 1430 |
| App identifier | `com.emerald.app.dev` | `com.emerald.magical-journal.mcp` |
| Cargo target dir | `src-tauri/target` | `%LOCALAPPDATA%\emerald-mcp-target` |

The identifier of its own gives the instance its own app data and therefore its own vaults. The build directory of its own is needed because Windows refuses to overwrite an `.exe` that is running.

`status` reports the instance; `python instance.py` prints the same without starting anything.

## Setup

**Prerequisites:** Python 3.10 or newer, and everything a dev build of Emerald needs (see [`CONTRIBUTING.md`](../../CONTRIBUTING.md)). `start_emerald_mcp.bat` expects the Visual Studio Build Tools under `C:\BuildTools`; set `EMERALD_BUILD_TOOLS` if yours are elsewhere.

**Claude Code** needs nothing further: the `.mcp.json` at the repository root registers the server and starts it through [uv](https://github.com/astral-sh/uv), which installs the dependencies on the fly.

**Other clients** register `server.py` themselves. Install the dependencies first:

```bash
cd tools/mcp
uv venv
uv pip install -r requirements.txt
```

Then point the client at the venv's Python and `server.py`, for example in Claude Desktop (`%APPDATA%\Claude\claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "emerald-devtools": {
      "command": "C:/path/to/Emerald-App/tools/mcp/.venv/Scripts/python.exe",
      "args": ["C:/path/to/Emerald-App/tools/mcp/server.py"]
    }
  }
}
```

**The `mcp` pin matters.** `server.py` is written against the 1.x low-level API (`@app.list_tools()`, `@app.call_tool()`), which mcp 2.0 removed. An unpinned install pulls 2.x and the server dies on import; the client then shows a server with no tools, and the traceback only appears on the server's stderr.

## Starting the app

Nothing to do by hand. When a tool call needs the app and nothing answers on the port, the server spawns `start_emerald_mcp.bat` detached and waits for the debug port. The first build takes 5 to 15 minutes; a tool call during that time comes back with "Emerald is still starting" and is simply repeated. Once launched, the app keeps running after the MCP server exits.

Set `EMERALD_AUTO_LAUNCH=0` to start it yourself. Run by hand, `start_emerald_mcp.bat` uses the checked-in `tauri.mcp.conf.json`, which leaves the window on screen.

To check the debug port:

```bash
curl http://127.0.0.1:9223/json/version
```

## Tools

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

Every `selector` accepts three forms: a CSS selector, a ref from `snapshot`
(`@e7`), or `text=Visible text`. A ref stays valid for as long as its element
is in the page, so a snapshot followed by a few actions needs no selector
guessing at all. A failed tool call is returned with `isError` set.

## Configuration

| Var | Default | Description |
| --- | --- | --- |
| `EMERALD_APP_DIR` | discovered | Force the app checkout instead of deriving it from the session's directory |
| `EMERALD_CDP_HOST` | `127.0.0.1` | Debug host |
| `EMERALD_CDP_PORT` | `9223` | Debug port |
| `EMERALD_MCP_VITE_PORT` | `1430` | Port of the instance's Vite dev server |
| `EMERALD_MCP_IDENTIFIER` | `com.emerald.magical-journal.mcp` | App identifier, which decides where the instance keeps its data |
| `EMERALD_MCP_HOME` | `%LOCALAPPDATA%\emerald-mcp` | Generated Tauri config, launch logs, screenshots |
| `CARGO_TARGET_DIR` | `%LOCALAPPDATA%\emerald-mcp-target` | The instance's build directory |
| `EMERALD_MCP_OFFSCREEN_XY` | off-screen | `40,40` keeps the window on screen, for watching a run |
| `EMERALD_AUTO_ATTACH` | `1` | Attach to the app's main page on first use |
| `EMERALD_AUTO_LAUNCH` | `1` | Start the app when no target is found |
| `EMERALD_LAUNCHER_PATH` | `start_emerald_mcp.bat` | Launcher script |
| `EMERALD_LAUNCH_TIMEOUT` | `900` | Seconds to keep waiting for a cold start before giving up |
| `EMERALD_LAUNCH_POLL_WAIT` | `25` | Seconds one tool call waits for the port |
| `EMERALD_LAUNCH_POLL_INTERVAL` | `1.5` | Seconds between port checks |
| `EMERALD_LAUNCH_LOG_DIR` | `<home>/logs` | Where launch logs are written |
| `EMERALD_BUILD_TOOLS` | `C:\BuildTools` | Visual Studio Build Tools, for the launcher script |

## The skill file

`skills/emerald-app-control.md` collects what works when driving Emerald: selectors per area, how each area commits an edit, and pitfalls. The `qacheck` agent reads it. It is also written as a skill for the [Hermes](https://hermes-agent.nousresearch.com) desktop app and has placeholders for local paths at its top; fill those in a copy of your own, not in the repository.

## Development

Run the server by hand to see its log on stderr:

```bash
python server.py
```

Inspect what would be decided, without starting anything:

```bash
python instance.py            # checkout, ports, paths
python tauri_config.py        # the Tauri overlay that would be generated
```

Run the tests. They drive a headless Edge showing `tests/page.html`, the same engine as WebView2, so they need no Emerald build:

```bash
pip install -r requirements-dev.txt
python -m pytest
```

The dialog tests open real Windows dialogs for a moment and are skipped unless `EMCP_TEST_DIALOGS=1` is set.

Everything that looks at the DOM is in `pagelib.js`, which `cdp.py` sends along with each call; `tests/test_cdp.py` is where a change to it is checked.

## Known limitations

- **Windows only.** The MCP speaks the Chrome DevTools Protocol, which only
  WebView2 offers; WKWebView on macOS and WebKitGTK on Linux have no such
  port. Window handling and native dialogs use the Windows API as well.
- **One instance.** Port, identifier and build directory are fixed, so two
  checkouts cannot be driven at the same time without overriding them by hand,
  and two sessions on one checkout drive the same window.
- **The database is not managed.** The instance starts on the app's own vault
  setup the first time and keeps what is put into it. Nothing seeds it and
  nothing resets it.
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
  File → Export as Markdown… menu from MCP. 
- **No undo/redo exposed.** Tauri WebView doesn't give CDP control over
  these. The skill works around this by being explicit about state.
