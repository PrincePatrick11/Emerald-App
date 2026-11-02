# MCP Server

`tools/mcp/` holds an MCP server, `emerald-devtools`, that lets a coding assistant drive a running Emerald instance: read the page, click, type, answer native dialogs, read the console, take screenshots. It is how an assistant checks that a change works in the app itself, and what the `qacheck` and `designcheck` [agents](agents.md) use.

This file covers using it. Setup for other clients, every environment variable and the internals are in [`tools/mcp/README.md`](../tools/mcp/README.md).

## Requirements

It needs Python 3.10 or newer, [uv](https://github.com/astral-sh/uv), and everything a dev build of Emerald needs, see [Native build requirements](build.md#native-build-requirements). Claude Code starts the server when a session starts, so a session that began without uv on its path only gets the server after a restart.

The server speaks the Chrome DevTools Protocol. On Windows, WebView2 has a debug port for it. WKWebView on macOS and WebKitGTK on Linux have none, so there the instance is built with a [dev bridge](security.md#the-dev-bridge) that answers the part of the protocol the server uses. The tools are the same everywhere; what each platform leaves out:

| | Windows | macOS | Linux |
| --- | --- | --- | --- |
| Reading the page, `eval`, console | yes | yes | yes |
| `click` | real mouse events | real mouse events for the left button | events dispatched in the page |
| `type_text`, `press_key`, `hover` | real input events | events dispatched in the page | events dispatched in the page |
| `screenshot` | yes | yes | no |
| `dialog` | the native dialogs | dialogs held back by the bridge | dialogs held back by the bridge |
| Window out of sight | yes, off-screen | yes, invisible | no, it opens on screen |

On macOS the bridge turns a mouse move with the left button held into a real drag, so text can be selected by dragging.

Events dispatched in the page reach the app's handlers, the editor included, but they are not trusted events, and a `:hover` style follows the pointer only on Windows; `hover` says so when it did not follow. They have no default action either: the bridge itself lets Enter and Space press a focused button, link or checkbox and does the editing in fields, but Enter does not submit a form from a field. A statement list given to `eval` returns no value through the bridge, and the answer says so — wrap it in a function to get one.

A native file dialog cannot be answered from outside on macOS, so the bridge holds back the dialogs the page asks for — file pickers, message boxes, questions — before a window opens. The app waits for the answer as it would for the dialog, and `dialog` lists and answers them the same way as on Windows; the native window itself is what does not get exercised. The folder picker for automatic backups, which the Rust side opens, goes the same way in a build with the bridge, as long as a client is connected and the instance is out of sight; otherwise, and once the window has been shown, it is the native picker. One that nobody answers is cancelled after five minutes, and when the last client goes. Any other dialog opened from Rust would be native: on macOS it can be listed, cancelled or accepted where it stands, but not sent to another path.

The Linux column is built to the same code as macOS and compiles in CI, but has not been run.

## Registration

`npm run mcp:register` registers the server for Claude Code: it writes the entry from `tools/mcp/mcp.example.json` into `.mcp.json` at the root of the checkout, which is not part of the repository, and leaves other servers in that file alone. Claude Code then starts the server through uv from that checkout's own `tools/mcp/`. `node scripts/register-mcp.mjs --remove` takes the entry out again. A git worktree is a checkout of its own and is registered separately.

Other clients register `tools/mcp/server.py` themselves; [`tools/mcp/README.md`](../tools/mcp/README.md) has the entries.

## The Instance

The server never touches the regular dev build. It builds and starts the checkout the session runs in as an instance of its own, on port 9223, with its own app identifier and build directory, so both can run at once. A session in a worktree drives that worktree, also when its client started the server in the main checkout; on Windows that case needs `EMERALD_APP_DIR`. The server's own code still comes from the directory the client started it in. `status` reports checkout, port and identifier.

The first tool call that needs the app starts the instance. A first build takes several minutes, and a call during that time answers that Emerald is still starting; later starts take seconds.

There is one instance. Two checkouts cannot be driven at the same time, and two sessions on the same checkout drive the same window.

## What to Know Before Reporting a Fault

- **There is no window to look at on Windows and macOS.** On Windows the instance's window is off-screen and out of the taskbar. On macOS it is fully transparent, lets clicks through to what is behind it, has no Dock icon and hands the keyboard back to the app that was in front when it started. So a run does not sit in the way. Read the UI with `snapshot`, and use `screenshot` when the look is the question. `EMERALD_MCP_SHOW_WINDOW=1` leaves the macOS window visible, for watching a run. A running instance can also be asked to show itself and to go away again, through the bridge's own `Emerald.window` call; a shown window comes to the front even though the app may not activate itself.
- **A native dialog is not in the page.** A file picker or message box stops the app until it is answered, and neither `snapshot` nor `screenshot` shows it. `dialog` lists and answers it. Emerald only writes below the user's own folders; a path outside them comes back as a second dialog saying so.
- **The instance has a vault of its own, with test data in it.** Its app identifier keeps it apart from the dev build and from an installed Emerald. A new instance is given generated fixtures: entries across every module and a few trashed items. They can be changed and deleted freely. The vault is built once, from the checkout's own schema, and never reset, so it also holds what earlier runs left in it.
- **A password dialog is a fault of the setup.** The test vault is encrypted like every vault, and a dev build unlocks it by itself with a test password that release builds do not read.

## Tools

| Tool | What it does |
| --- | --- |
| `status` | Which instance this session drives, whether it is running, and how a launch in progress is doing. On macOS and Linux it also names the checkout the running instance came from and warns when that is another one; so does the first answer after attaching |
| `snapshot` | The page as a compact outline, one line per element; elements that can be acted on carry a ref such as `@e7` |
| `click`, `hover` | Mouse input, real or dispatched in the page as in [the table above](#requirements). `click` refuses an element that is disabled, hidden or covered, and names what covers it |
| `type_text`, `press_key` | Keyboard input, real or dispatched in the page as in [the table above](#requirements), into inputs and the editor alike |
| `wait_for` | Waits until an element is visible, attached, hidden or detached |
| `dialog` | Lists and answers native file pickers and message boxes |
| `eval` | Runs JavaScript as in a DevTools console |
| `console_logs` | Console output and uncaught exceptions |
| `screenshot` | A PNG of the window or of one element |
| `navigate` | Loads a URL or reloads the page |
| `connect`, `attach` | Lists the WebView targets and attaches to another than the main window |

## Selectors

Every `selector` takes a CSS selector, a ref from `snapshot`, or `text=Visible text`. A ref stays valid for as long as its element is in the page, so a snapshot followed by a few actions needs no selector guessing.

A selector that has to outlive the run, such as a repro step in a report, uses the lucide icon classes (`.left-sidebar-rail button:has(.lucide-book-open)`), not `title`, `innerText` or `text=…`: those are translated and break with the language. `snapshot` shows the icon as `icon=book-open`.

Known selectors, how each area commits an edit, and pitfalls are collected in [`tools/mcp/skills/emerald-app-control.md`](../tools/mcp/skills/emerald-app-control.md).
