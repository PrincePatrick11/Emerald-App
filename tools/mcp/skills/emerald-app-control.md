---
name: emerald-app-control
description: Drives the Emerald Tauri/journal app through the emerald-devtools MCP server. Covers the rail with its dashboards (All entries, Journal, Practice, Knowledge, own ones), the collections (Templates, Blocks, Symbols, Images, Categories, Tags), Tasks, Lexicon, Trash, Settings, the Start page, the one entry page, theme and language switching, and what to do when a native message stops the page.
version: 1.0.0
platforms: [windows, macos, linux]
metadata:
  hermes:
    tags: [tauri, cdp, webview2, emerald, journal]
    category: productivity
    related: [emerald-devtools-mcp, hermes-desktop-plugins]
---

# Emerald App Control — driving the app through MCP

> **Template skill — neutral.** Before loading this skill into Hermes, **adapt the
> placeholder paths to your machine** (see the "Local paths" section below).
> On the original author's machine there is an **adapted version** carrying the
> real paths, which is not in this repo.

Drives a running **Emerald** Tauri app (https://github.com/PrincePatrick11/Emerald-App)
through the `emerald-devtools-mcp` server, which talks to the webview via the
Chrome DevTools Protocol - WebView2's own debug port on Windows, the app's dev
bridge on macOS and Linux.

Prerequisites:
1. The MCP server is configured in your LLM client. It launches Emerald itself,
   so there is nothing to start by hand.
2. Call `status` first. It reports the instance this session drives -
   checkout, port, identifier.

Two things about that instance are intentional:
- **You will not see a window.** On Windows it is moved off-screen and out of
  the taskbar, on macOS it is invisible and has no Dock icon, so it does not
  sit in the user's way. Use `screenshot` to see the app. To watch a run, set
  `EMERALD_MCP_OFFSCREEN_XY=40,40` (Windows) or `EMERALD_MCP_SHOW_WINDOW=1`
  (macOS) and restart the instance.
- **It already contains data.** A new instance is given a vault of test
  data - entries in every module, a few trashed items. Those are fixtures;
  change and delete them freely. The vault is created once and not reset, so
  it also holds what earlier runs left in it.

---

## Local paths (ADAPT before using this skill!)

**Replace these placeholders** with your real paths before loading the skill into Hermes:

| What | Placeholder | Your path |
|---|---|---|
| The MCP inside the Emerald-App repo | `<REPO>` | e.g. `C:\Users\YOU\Projects\Emerald-App\tools\mcp` |
| Emerald-App repo | `<APP>` | e.g. `C:\Users\YOU\Projects\Emerald-App` |
| Hermes skill directory | `<SKILLS>` | e.g. `C:\Users\YOU\AppData\Local\hermes\skills\emerald-app-control` |
| Hermes config | `<CONFIG>` | e.g. `C:\Users\YOU\AppData\Local\hermes\config.yaml` |
| Emerald launcher | `<LAUNCHER>` | `<REPO>\start_emerald_mcp.bat` |

How to adapt:
1. In Hermes, ask the assistant: *"Adapt the placeholders in
   skills/emerald-app-control.md to my local paths"*
2. Or: load the skill into Hermes, let it read the file once, then ask for the
   adaptation
3. Save the changed version back to `skills/emerald-app-control.md`
   (locally — do **not** commit it back into the git repo!)

Hermes MCP config template:
```yaml
mcp:
  servers:
    emerald-devtools:
      command: python
      args:
        - <REPO>/server.py
      env:
        EMERALD_CDP_HOST: 127.0.0.1
        EMERALD_AUTO_ATTACH: 1
```

## Cold-start checklist

1. Call `mcp.call_tool("status", {})`. It reports the instance, whether its
   port is alive, and the launch state. Do not look for a window — there is
   none to see.
2. If nothing is running yet, the first tool call starts Emerald by itself. A
   reply of *"Emerald is still starting"* is that cold start, not a failure:
   retry in 15-30s. The first start in a new checkout also runs `npm install`
   and builds the test vault, so allow a few minutes.
3. To check the port by hand, take it from `status`:
   `curl -s http://127.0.0.1:<port>/json/version`
   should return JSON containing `"Browser": "Edg/..."`.

---

## How to use this skill

This skill is read by **Hermes** (or another MCP client) when the user phrases a task
involving Emerald. The code examples below use `mcp.call_tool(name, args)` as a
placeholder — in practice the MCP client replaces that with direct tool calls.

**Example conversation:**

> User: "Create an article about amethyst for me"
>
> Hermes (following this skill):
> 1. Looks up the entry create pattern
> 2. Opens the Knowledge dashboard in the rail and presses "New entry"
> 3. Types the title "Amethyst"
> 4. Fills the body via ProseMirror
> 5. Presses "Done"
> 6. Optionally: opens Properties, sets the category to "Crystals"

**Hermes-specific notes:**
- Wait for the next state with `wait_for` (React needs time to re-render): `await mcp.call_tool("wait_for", { selector, timeout_ms: 3000 })`
- If the app stops responding: call `dialog` first (see "A silent page"); reload with `navigate` only when nothing is open there

---

## MCP tools — overview

The MCP server exposes 14 tools. The most-used ones:

| Tool | When |
|---|---|
| `status` | **Always first** in a new session — confirms the connection is up |
| `eval` | Run JS, return the value or await a promise |
| `snapshot` | The page as a compact outline; what can be acted on carries a ref (`@e7`) every `selector` accepts. `interactive: true` for just those, `selector` for a subtree |
| `click` | Real mouse click; `button: "right"` for context menus, `clicks: 2` for a double click. Fails on a hidden, disabled or covered element |
| `type_text` | Type into an input, textarea or the Tiptap editor; reports what the field reads afterwards |
| `press_key` | `Enter`, `Escape`, `Control+K`, … |
| `hover` | Mouse over an element (tooltips, hover-only controls) |
| `dialog` | Native file pickers and message boxes - not visible to `snapshot` or `screenshot`. **First call when the page stops answering** (see "A silent page") |
| `screenshot` | PNG of the app — for "show me what you see" |
| `console_logs` | Read React/JS errors when something does not work; `clear: true` empties the buffer, `level: "error"` filters |
| `wait_for` | Wait for a selector to be `visible` (default), `attached`, `hidden` or `detached` |
| `connect` / `attach` | Pick another WebView than the main window (rarely needed) |
| `navigate` | Change URL, or reload when called without one |

A `selector` is a CSS selector, a ref from `snapshot` (`@e7`), or `text=Visible text`.
The `eval` recipes below predate real mouse and keyboard input and still work;
where one only clicks, right-clicks or types, the tool is now the shorter way.

## Architecture in brief

- **Stack:** Tauri 2 + React 19 + Vite + Zustand + SQLite (local, SQLCipher through the app's own SQL layer in `db.rs`)
- **Editor:** Tiptap (ProseMirror). Body = `<div class="tiptap ProseMirror" contenteditable="true">`
- **Title:** `<input class="entry-view-title">` (placeholder "Untitled Entry" in English)
- **i18n:** react-i18next, 4 languages (EN/DE/ES/FR), switchable live in Settings
- **Themes:** "Emerald Noctis" (dark, default), "Emerald Parchment" (light)
- **Persistence:** SQLite encrypted with SQLCipher, one `emerald.db` per vault; no sync (Settings → Sync and the start page's Server and Store cards are placeholders)
- **Content model:** one kind of entry; the category decides what it is. Dashboards are filtered views (by category and tag); collections (Tags, Categories, Images, Templates, Blocks, Lexicon, Symbols) have their own pages. Tasks are separate.
- **Hot reload:** Vite reloads automatically on code changes in `src/`

## Main UI anatomy

```
┌─ title bar ─────────────────────────────────────────────────────────────────┐
│ logo │ Menu · Search · Back · Forward · Export · Import (icon buttons) │ tabs │
│                                          .window-control ×3 (Min/Max/Close) │
├─ rail + list ─────────────┬─ main.app-main (sheet) ──┬─ right sidebar ───────┤
│ .left-sidebar-rail        │ dashboard / collection / │ the dashboard's list  │
│   button.rail-button ×16  │ entry page               │ controls (New …, view,│
│ recent entries (left list)│                          │ sort, filter) — or the│
│   rows = .sidebar-item    │                          │ entry's Properties,   │
│                           │                          │ Linked entries, Tags  │
└───────────────────────────┴──────────────────────────┴───────────────────────┘
```

**Tabs:** `.tab-button` per open view, `button.tab-add` for a new one, `button.tab-close`.
**The Start page has no rail** — it is the vault picker (open/new vault, automatic backup, appearance, language, updates). Its only way back is the vault's own "open" button.
**Title bar:** Menu (Switch Vault…, Check for Updates…, About, Edit, View), Search (global search modal), Back/Forward, Export (opens the export menu: this entry, a collective export or the whole database), Import (opens the import window; a file can also be dragged into the app window) — all `.rail-button` icon buttons, no longer four text menus.

### Selectors — the important part

**Navigation runs through the rail, and its buttons are pure icon buttons.**
They share the classes `btn-ghost rail-button` and differ only by `title` — which is
**translated**. The only reliable handle is the lucide icon class, which is
language-independent (`snapshot` shows it as `icon=book-open`):

```js
document.querySelector('.left-sidebar-rail button:has(.lucide-book-open)').click()
```

Top to bottom the rail holds:

| Target | Icon class | Kind |
| --- | --- | --- |
| Create new | `lucide-plus` | opens the "Create new" modal: a search field (focused; typing filters, Enter takes the first tile left), then one group per dashboard in rail order with a tile per category ("All entries": "Uncategorized"), "More categories", and "Collections" (Task, Category, Tag, Template, Block, Language, Image, Dashboard). Tiles are `.create-item-tile`, headings `.create-item-group`; pick a tile by its icon (`.create-item-tile:has(.lucide-tag)`) or its emoji, not by text |
| All entries | `lucide-layout-list` | dashboard, `[data-dashboard-id="all"]` |
| Journal / Practice / Knowledge | `lucide-book-open` / `lucide-wand-sparkles` / `lucide-library` | dashboards, `[data-dashboard-id="journal"]` etc. |
| own dashboards | any (default `lucide-layout-dashboard`) | dashboards, placed after Knowledge |
| Tasks | `lucide-square-check-big` | list of tasks |
| Lexicon | `lucide-languages` | collection |
| Templates | `lucide-copy-plus` | collection |
| Blocks | `lucide-box` | collection |
| Symbols | `lucide-shapes` | collection |
| Images | `lucide-images` | collection |
| Categories | `lucide-folder-open` | collection |
| Tags | `lucide-tag` | collection |
| Trash | `lucide-trash2` | list |
| Settings | `lucide-settings` | modal |
| Start page | `lucide-layout-grid` | leaves the vault view |

`:has()` is supported by WebView2 — verified against the running build.

Every dashboard button also carries `data-dashboard-id` — the only stable handle for a user-made dashboard, whose icon can be anything. A built-in given its own icon loses its lucide class (renaming keeps it); the attribute stays. The active rail button has the class `active` (and `[active]` in `snapshot`).

**`.sidebar-item` is not navigation.** It denotes the rows of the *left* list (the recent entries and tasks of the whole vault, newest first). Dashboard and collection items in the main area are `.panel-interactive`.

**Collections** (Templates, Blocks, Symbols, Images, Categories, Tags, Lexicon) share one layout: heading `h1.entry-view-title`, search `input.list-toolbar-input`, items as `.panel-interactive` (Images: `.image-tile`), and in the right sidebar a primary button (`button.btn-primary`: "New template", "New block", "Add images", "New category", "New language"), the view toggle (List / Cards / Timeline), a sort button (`.op-prop-select`) and `.filter-row` chips (tag filters, categories).

**Creating an entry:** `button.btn-primary` ("New entry") in the right sidebar of a dashboard, or the rail's "Create new" plus. There is no `button[title="New Entry"]` any more, and the left list has no plus.

## Core flows

### Create an entry
```js
// 1. Open a dashboard, press "New entry"
await mcp.call_tool("click", { selector: '.left-sidebar-rail [data-dashboard-id="journal"]' });
await mcp.call_tool("click", { selector: "button.btn-primary" });   // the one in the right sidebar
// The entry exists at once (it is already in the left list as "Untitled Entry") and is open in
// edit mode: title input, editor toolbar, .ProseMirror, a "+ Add block" button.
// It starts in the first category of the dashboard (the category's start template applies).

// 2. Title and body
await mcp.call_tool("type_text", { selector: "input.entry-view-title", text: "🌙 Full Moon Ritual" });
await mcp.call_tool("type_text", { selector: ".ProseMirror", text: "My text" });

// 3. Leave edit mode
await mcp.call_tool("click", { selector: "text=Done" });   // language-dependent; it is the one filled button of the edit bar
```
Category, icon, cover image, linked entries and tags are set in the right sidebar while editing
(`PROPERTIES`, `LINKED ENTRIES`, `TAGS` sections; the category row is `button.prop-value-btn`).

### Open, read and edit an entry
A click on a row (`.panel-interactive` in a dashboard, `.sidebar-item` in the left list) opens the entry page **in reading mode**: breadcrumb `button.entry-back-link`, the title, the content, an **Edit** button. After Edit it is the same page as above; "Done" returns.

```js
await mcp.call_tool("eval", { expression: "document.querySelector('.ProseMirror')?.innerText" });
```

### Blocks of an entry
The content is a stack of blocks (`.block-stack-item`, each a `.block-frame` with `.block-frame-header` — grip, label, "…" `.block-frame-menu` — and `.block-frame-body`). What a block can do comes from its type alone (see `Documentation/architecture/blocks.md`): "Add block" lists every type's offer; the "…" menu holds its actions and settings while editing, the properties panel's "Actions" section the read-mode ones. Block-given values — info line in lists, rows in the properties panel marked with the small "Blocks" icon, block tags — appear only where a type delivers them.

A block this version cannot read (`.block-unreadable`) shows only a notice instead of its content — a newer data version or unknown type ("from a newer version"), or damaged data ("cannot be read"). To see it, write a block with a data version above its type's into an entry's content through the store, e.g. `data-block-v="99"` on an existing section, and reopen the entry: the notice must show, nothing of the block's content, and the search must not find its words. Undo it by removing the attribute again. Report it as a fault if any content of such a block shows, in the app or in an export.

### Right-click menus
`click` with `button: "right"`, then `snapshot` with `selector: ".context-menu"`:

| On | Items |
| --- | --- |
| an entry (list row) | Open in New Tab, Duplicate, Save as template, Rename, Delete |
| a rail dashboard | Dashboard settings, Move up, Move down, Delete |
| a tag | Rename, Delete |

**Delete does not ask.** An entry or tag goes to the trash at once, and an "Undo" toast (`button.btn-primary` in the corner) stays for a while. A deleted dashboard is gone; its entries stay. Only the Trash's "Empty trash" and "Delete selected" ask (the button turns into "Yes, …").

### Create new modal and dashboards
The rail's plus opens "Create new" (`.modal-card`, tiles `.create-item-tile`). The Dashboard tile opens **Dashboard settings**: name, icon/emoji, a category filter (`.filter-row`, "All" or ticked categories, an inline "New category" field) and a tag filter (`TagInput`, placeholder "Add tag …"; Enter or a comma adds a chip, `Remove tag: …` removes it). Buttons: Delete, Cancel, Save. The same dialog opens from "Dashboard settings" (a `sliders-horizontal` icon button beside "New entry") and from the rail's context menu. Save puts the dashboard in the rail and opens it.

Note: a tag typed into the filter that does not exist yet is created at that moment — it shows in Tags as "unused", even if the dashboard is cancelled or deleted afterwards. Delete such a tag when you are done.

### Categories, tags, templates
- **Categories** — the collection lists them as `.panel-interactive` with the entry/task counts; a click opens **Edit category** (`.modal-card`): name and icon, START TEMPLATE (the "Default template" or one of the templates), SHOWN IN (read only: the dashboards that include it). Delete / Cancel / Save.
- **Tags** — rows expand (chevron) to the entries carrying the tag; the colour dot is a `button` titled "Change color" (translated); right-click: Rename, Delete.
- **Templates** — "New template" in the right sidebar; the right sidebar also has the DEFAULT TEMPLATE chip.

### Tasks
Tasks are grouped by category. "New task" (`button.sidebar-action-btn` in a group header; there are several, the first visible one is taken) opens an inline input — `input.bg-well-solid`, no placeholder, focused — and Enter commits it. Each row has Add subtask, Category, Link entry and a priority button.

### Switch language
```js
await mcp.call_tool("click", { selector: ".left-sidebar-rail button:has(.lucide-settings)" });
// language names are shown natively, so the German option reads "Deutsch" in every language
await mcp.call_tool("click", { selector: "text=Deutsch" });
await mcp.call_tool("press_key", { key: "Escape" });
```
Settings (`.modal-card`) has the tabs General, Sidebar, Entries, Security, Sync, Storage — no Backup tab: the database export is in the export menu, restoring in Import, the automatic backup on the Start page. The Start page also has a language and a theme (Noctis / Parchment) button.

### Switch theme
Settings → General has the theme choice; the Start page lists Noctis and Parchment (`Import theme…` beside them).

### Trash → Restore
```js
await mcp.call_tool("click", { selector: ".left-sidebar-rail button:has(.lucide-trash2)" });
await mcp.call_tool("click", { selector: "text=Restore" });  // one Restore button per row
// Trash auto-deletes after 30 days
```

### A silent page: look for a native message first
If `snapshot`, `eval`, `click` or `status` stops answering, a native dialog (a message box, a file picker) has stopped the app — it is not in the DOM, so `snapshot` and `screenshot` cannot show it. 

1. Give every call a short deadline: `timeout` (seconds) on `eval`, `timeout_ms` on `wait_for`. The server itself answers any call with an error after about a minute (`EMERALD_CALL_DEADLINE`; a call with its own timeout gets that plus 15 s) that names `dialog`.
2. When the page does not answer, call `dialog` (default action `list`) at once. Read the message, then answer it (`action: "click"` with `button`, or `accept` / `cancel`).
3. If a message appears where none belongs, **report it as a finding** with the step that raised it — do not just dismiss it.
4. Never wait out a timeout of minutes. `navigate` (reload) only after `dialog` shows nothing open.

## Pitfalls

### Selectors based on `title` or `innerText` are language-dependent
The app runs in four languages, and rail buttons as well as toolbar icons take
their `title` from i18n. A selector like `b.title === 'Settings'` only works in
English and breaks silently as soon as the app is set to German. For navigation,
always use the lucide icon class (see the selector table above).
If you do have to select by text, check the active language first:

```js
document.documentElement.lang || localStorage.getItem('i18nextLng')
```

### `eval` with an async function returns `{}` on Windows
`(async () => {...})()` comes back as `{}`. Use top-level `await` and end with the value
(`await sleep(); ({a: 1})`), or return `JSON.stringify(...)` from a synchronous expression.

### Settings and every dialog are modals
Settings is a `.modal-card` above the app, like Create new, Dashboard settings and Edit category. The rail
stays in the DOM and visible, but `click` fails with "covered by div" — close the modal first:
`press_key` `Escape` (reliable). Escape closes a dialog without saving.

### The Start page replaces the whole vault view
No rail, no tabs. Go back through the vault's "open" button there.

### Reload = the reset button
`navigate` to `http://localhost:<vite_port>/` (the port `status` names) remounts the app (React state gone, SQLite DB stays).

## Diagnostic helpers

### Dump the current state

```js
JSON.stringify({
  lang: document.documentElement.lang,
  platform: document.documentElement.dataset.platform,
  heading: document.querySelector('.app-main h1')?.innerText,
  activeRail: document.querySelector('.left-sidebar-rail .rail-button.active')?.getAttribute('title'),
  selectedListRow: document.querySelector('.sidebar-item.active')?.innerText.trim(),
  tabs: [...document.querySelectorAll('.tab-button')].map(t => t.innerText.trim()),
  modalOpen: !!document.querySelector('.modal-card'),
  editorOpen: !!document.querySelector('.ProseMirror'),
  titleValue: document.querySelector('input.entry-view-title')?.value,
  bodyText: document.querySelector('.ProseMirror')?.innerText?.slice(0, 200)
}, null, 2)
```

The active rail button carries the class `active` and `snapshot` marks it `[active]`;
`aria-current` is not set. `.sidebar-item.active` is the highlighted row of the *left list*,
not the navigation.

### Console logs
```js
mcp.call_tool("console_logs", {})
```

### Screenshot
```js
const result = await mcp.call_tool("screenshot", {});
// returns the image itself, plus {"saved_to": "...png"} — cite that path, do not re-encode
```

## Verification — smoke test

Call `status`, then check the UI with `eval`:

```js
const icons = ['plus','layout-list','book-open','wand-sparkles','library','square-check-big','languages',
               'copy-plus','box','shapes','images','folder-open','tag','trash2','settings','layout-grid'];
const missing = icons.filter(i => !document.querySelector(`.left-sidebar-rail button:has(.lucide-${i})`));
document.querySelector('.left-sidebar-rail button:has(.lucide-wand-sparkles)').click();
await new Promise(s => setTimeout(s, 700));
const heading = document.querySelector('.app-main h1')?.innerText;
JSON.stringify({ railSelectorsMissing: missing, heading,
                 newEntryBtn: !!document.querySelector('button.btn-primary'),
                 pass: missing.length === 0 && !!heading })
```

Expected: `railSelectorsMissing: []`, `heading: "Practice"` (in English), `pass: true`.
If `railSelectorsMissing` is not empty, the rail has changed — update this skill
before running tests.

## When something does not work

| Symptom | Cause | Fix |
|---|---|---|
| `attach` fails | Emerald is not running | the first tool call starts it; see the cold-start checklist |
| No window anywhere | Intended — it is off-screen | Use `screenshot`; `EMERALD_MCP_OFFSCREEN_XY=40,40` brings it back |
| Unexpected entries in the app | Intended — the test vault's fixtures, plus what earlier runs left | it is not reset between runs |
| Driving the wrong checkout | `status` names the checkout and how it was found | `EMERALD_APP_DIR` forces one |
| A call hangs or times out | A native dialog is open | `dialog`, read and answer it — see "A silent page" |
| `click` says "covered by div" | A modal is open | Escape, or answer the modal |
| Rail buttons do nothing | the Start page is showing (no rail) or a modal is open | open the vault; Escape |
| The entry looks unsaved | The page is still in edit mode | click Done |
| `Suchen...` instead of `Search...` | the language is set to German | intended, or switch back in Settings |
| `.ProseMirror` is null | no entry page is open, or it is still loading | `wait_for` it |
