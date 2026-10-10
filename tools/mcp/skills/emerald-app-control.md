---
name: emerald-app-control
description: Drives the Emerald Tauri/journal app through the emerald-devtools MCP server (CDP/WebView2). Covers Journal, Wiki, Operations, Altar, Tasks, Tags, Trash, Settings, export, theme and language switching.
version: 1.0.0
platforms: [windows]
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
   checkout, port, identifier. Port 9222 is the separate, manually started
   regular dev instance; address it only deliberately.

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
3. To check the port by hand, take it from `status` (9223 unless overridden):
   `curl -s http://127.0.0.1:<port>/json/version`
   should return JSON containing `"Browser": "Edg/..."`.

---

## How to use this skill

This skill is read by **Hermes** (or another MCP client) when the user phrases a task
involving Emerald. The code examples below use `mcp.call_tool(name, args)` as a
placeholder — in practice the MCP client replaces that with direct tool calls.

**Example conversation:**

> User: "Create a wiki article about sage for me"
>
> Hermes (following this skill):
> 1. Looks up the wiki create pattern
> 2. Clicks sidebar → New Article
> 3. Types the title "Sage"
> 4. Fills the body via ProseMirror
> 5. Commits via `entry-view-title.blur()`
> 6. Optionally: opens Properties, sets the category to "herb"

**Hermes-specific notes:**
- Plan for a 300–500ms pause between consecutive MCP calls (React needs time to re-render)
- If the LLM goes quiet: just `await mcp.call_tool("wait_for", { selector, timeout_ms: 3000 })` to wait for an element
- If the app stops responding: `navigate` to `http://localhost:1420/` as a reset button

---

## MCP tools — overview

The MCP server exposes 15 tools. The most-used ones:

| Tool | When |
|---|---|
| `status` | **Always first** in a new session — confirms the connection is up |
| `eval` | Run JS, return the value or await a promise |
| `snapshot` | The page as a compact outline; what can be acted on carries a ref (`@e7`) every `selector` accepts. `interactive: true` for just those, `selector` for a subtree |
| `click` | Real mouse click; `button: "right"` for context menus, `clicks: 2` for a double click. Fails on a hidden, disabled or covered element |
| `type_text` | Type into an input, textarea or the Tiptap editor; reports what the field reads afterwards |
| `press_key` | `Enter`, `Escape`, `Control+K`, … |
| `hover` | Mouse over an element (tooltips, hover-only controls) |
| `dialog` | Native file pickers and message boxes - not visible to `snapshot` or `screenshot` |
| `screenshot` | PNG of the app — for "show me what you see" |
| `console_logs` | Read React/JS errors when something does not work; `clear: true` empties the buffer, `level: "error"` filters |
| `wait_for` | Wait for a selector to be `visible` (default), `attached`, `hidden` or `detached` |
| `connect` / `attach` | Pick another WebView than the main window (rarely needed) |
| `navigate` | Change URL, or reload when called without one |

A `selector` is a CSS selector, a ref from `snapshot` (`@e7`), or `text=Visible text`.
The `eval` recipes below predate real mouse and keyboard input and still work;
where one only clicks, right-clicks or types, the tool is now the shorter way.

## Architecture in brief

- **Stack:** Tauri 2 + React 19 + Vite + Zustand + SQLite (local, via `tauri-plugin-sql`)
- **Editor:** Tiptap (ProseMirror). Body = `<div class="tiptap ProseMirror" contenteditable="true">`
- **Title:** `<input class="entry-view-title" placeholder="Untitled Entry">`
- **i18n:** react-i18next, 4 languages (EN/DE/ES/FR), switchable live in Settings
- **Themes:** "Emerald Noctis" (dark, default), "Emerald Parchment" (light)
- **Persistence:** SQLite + optional GitHub sync via `.env` (note: that is only an ENV token, not a UI sync — the `git push` flow is not implemented in `lib.rs`)
- **Hot reload:** Vite reloads automatically on code changes in `src/`

## Main UI anatomy

```
┌─ header.titlebar ───────────────────────────────────────────────────────────┐
│ Logo │ .titlebar-menu-trigger ×4 (Edit View Export Import) │ ← → │          │
│                    button.titlebar-search                                   │
│                                        .window-control ×3 (Min/Max/Close)   │
├─ aside.app-sidebar-left ──┬─ main.app-main ─────────┬─ aside.app-sidebar-right ┤
│ .left-sidebar-rail        │ .tabbar (+ .tab-add)    │ Properties / Tags        │
│   icon buttons btn-ghost  │ view content            │ Linked ops / wiki        │
│ entry-list panel          │                         │ Routines / backlinks     │
│   rows = .sidebar-item    │                         │                          │
└───────────────────────────┴─────────────────────────┴──────────────────────────┘
```

**Tabs:** `.tabbar` inside `main.app-main`, a new tab via `button.tab-add`.

### Selectors — the important part

**Navigation runs through the rail, and its buttons are pure icon buttons.**
They have no `innerText`, they all carry the same `btn-ghost` class, and they
differ only by `title` — which is **translated**. The only reliable handle is
the lucide icon class, which is language-independent:

```js
document.querySelector('.left-sidebar-rail button:has(.lucide-book-open)').click()
```

| Target | Icon class | Selector |
| --- | --- | --- |
| Journal | `lucide-book-open` | `.left-sidebar-rail button:has(.lucide-book-open)` |
| Tasks | `lucide-square-check-big` | `.left-sidebar-rail button:has(.lucide-square-check-big)` |
| Operations | `lucide-wand-sparkles` | `.left-sidebar-rail button:has(.lucide-wand-sparkles)` |
| Wiki | `lucide-library` | `.left-sidebar-rail button:has(.lucide-library)` |
| Altar | `lucide-flame` | `.left-sidebar-rail button:has(.lucide-flame)` |
| Tags | `lucide-tag` | `.left-sidebar-rail button:has(.lucide-tag)` |
| Trash | `lucide-trash2` | `.left-sidebar-rail button:has(.lucide-trash2)` |
| Settings | `lucide-settings` | `.left-sidebar-rail button:has(.lucide-settings)` |

`:has()` is supported by WebView2 — verified against the running build.

**`.sidebar-item` is not navigation.** Today the class denotes list rows:
entries in the list panel, backlinks, routines, tags. Trying to navigate with it
hits nothing, and `?.click()` fails silently.

**Creating an entry:** `button[title="New Entry"]` in the head of the list panel
(`.sidebar-search`, icon `lucide-plus`) is the most stable route. `button.btn-primary`
only exists in list views with no detail open.

## Core flows

### Create an entry (Journal)
```js
// 1. Sidebar
const sb = document.querySelector('.left-sidebar-rail button:has(.lucide-book-open)');
if (sb) sb.click();

// 2. btn-primary
const b = [...document.querySelectorAll('button.btn-primary')]
  .find(b => b.offsetParent !== null);
if (b) b.click();

// 3. Wait for tab + activate
const tabs = [...document.querySelectorAll('[class*="tab-"]')]
  .filter(el => el.offsetParent !== null);
if (tabs.length) tabs[tabs.length - 1].click();

// 4. Type title
await mcp.call_tool("type_text", {
  selector: 'input[placeholder="Untitled Entry" i]',
  text: "🌙 Full Moon Ritual"
});

// 5. Click ProseMirror to mount Tiptap, then fill
await mcp.call_tool("click", { selector: ".ProseMirror" });
await mcp.call_tool("eval", {
  expression: "(() => { const pm = document.querySelector('.ProseMirror'); pm.focus(); pm.innerHTML = '<p>My text</p>'; pm.dispatchEvent(new InputEvent('input', { bubbles: true })); return true; })()"
});

// 6. Click Done
await mcp.call_tool("eval", {
  expression: "[...document.querySelectorAll('button')].find(b => b.innerText.trim() === 'Done')?.click()"
});
```

### Open and read an entry
```js
// Clicking .panel-interactive opens the reader (NOT the editor)
const e = [...document.querySelectorAll('.panel-interactive')].find(el =>
  el.innerText.includes('Full Moon')
);
e?.click();
mcp.call_tool("eval", { expression: "document.querySelector('.ProseMirror')?.innerText" });
```

### Edit an entry
```js
await mcp.call_tool("click", { selector: 'input[placeholder="Untitled Entry" i]' });
await mcp.call_tool("type_text", { selector: 'input[placeholder="Untitled Entry" i]', text: "New title" });
await mcp.call_tool("click", { selector: ".ProseMirror" });
await mcp.call_tool("eval", {
  expression: "(() => { const pm = document.querySelector('.ProseMirror'); pm.focus(); const p = document.createElement('p'); p.textContent = 'New paragraph.'; pm.appendChild(p); pm.dispatchEvent(new InputEvent('input', { bubbles: true })); return true; })()"
});
await mcp.call_tool("eval", { expression: "[...document.querySelectorAll('button')].find(b => b.innerText.trim() === 'Done')?.click()" });
```

### Switch language
```js
await mcp.call_tool("eval", { expression: "document.querySelector('.left-sidebar-rail button:has(.lucide-settings)')?.click()" });
// language names are shown natively, so the German option reads "Deutsch" in every language
await mcp.call_tool("eval", { expression: "[...document.querySelectorAll('button')].find(b => b.innerText.trim() === 'Deutsch')?.click()" });
// close
await mcp.call_tool("eval", { expression: "(() => { document.querySelectorAll('[class*=\"close\"]').forEach(el => el.click()); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return true; })()" });
```

### Switch theme
```js
await mcp.call_tool("eval", { expression: "document.querySelector('.left-sidebar-rail button:has(.lucide-settings)')?.click()" });
await mcp.call_tool("eval", { expression: "[...document.querySelectorAll('button')].find(b => b.innerText.trim() === 'Emerald Parchment')?.click()" });
```

### Delete an entry (via right-click, NOT Trash)
```js
// 1. Right-click the item
await mcp.call_tool("eval", {
  expression: "(() => { const item = [...document.querySelectorAll('.panel-interactive')].find(el => el.offsetParent !== null && (el.innerText || '').includes('Full Moon Ritual')); if (item) { const r = item.getBoundingClientRect(); item.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, view: window, clientX: r.left + 20, clientY: r.top + 20, button: 2, buttons: 2 })); } return true; })()"
});
// 2. "Delete" in the context menu
await mcp.call_tool("eval", {
  expression: "[...document.querySelectorAll('.context-menu-item, [role=\"menuitem\"], button')].filter(el => el.offsetParent !== null).find(el => /^delete$/i.test((el.innerText || '').trim()))?.click()"
});
// 3. Confirm dialog
await mcp.call_tool("eval", {
  expression: "(() => { const d = document.querySelector('[role=\"dialog\"]'); if (d) { const del = [...d.querySelectorAll('button')].find(b => /^delete$/i.test((b.innerText || '').trim())); if (del) { del.click(); return true; } } return false; })()"
});
// CAUTION: this REALLY deletes, it does not go to Trash!
```

### Trash → Restore
```js
await mcp.call_tool("eval", { expression: "document.querySelector('.left-sidebar-rail button:has(.lucide-trash2)')?.click()" });
await mcp.call_tool("eval", { expression: "[...document.querySelectorAll('button')].find(b => b.innerText.trim() === 'Restore')?.click()" });
// Trash auto-deletes after 30 days
```

### Creating Wiki / Operations / Altar / Tasks entries

**These views open the editor inline**: clicking "New..." opens the editor immediately.

**IMPORTANT: the title commit mechanism differs per area!**

| Area | Title input selector | Commit method | Body editor |
|---|---|---|---|
| **Journal** | `input[placeholder="Untitled Entry" i]` | click the "Done" button | `.ProseMirror` |
| **Wiki** | `input[placeholder="Untitled Article" i]` | `input.entry-view-title.blur()` | `.ProseMirror` |
| **Operations** | `input[placeholder="Untitled Operation" i]` | **right-click → "Rename"** (NOT blur!) | `.ProseMirror` + 2 textareas |
| **Altar** | not verified yet | presumably like Journal | not verified |
| **Tasks** | `input.bg-stone-800[type="text"]` (NO placeholder) | Enter + blur | tasks have no body |

**Category options per area:**

| Area | Categories |
|---|---|
| **Wiki** | 12 options (Paradigm, Banishing, Meditation, Sigil Charging, Ritual, Deity, Herb, Symbol, Tool, Concept, Spell, Other) |
| **Operations** | **ONLY 2 options**: `sigils` and `servitors` — Operations is for sigil work only! |

**Creating a journal entry (Done button):** see above.

**Creating a wiki article (blur() commit):** like Journal, but instead of Done:
```js
await mcp.call_tool("eval", {
  expression: "(() => { const t = document.querySelector('input.entry-view-title'); if (t) t.blur(); return true; })()"
});
// view-switch refresh (Journal -> Wiki) so the article becomes visible
await mcp.call_tool("eval", { expression: "document.querySelector('.left-sidebar-rail button:has(.lucide-book-open)')?.click()" });
await mcp.call_tool("wait_for", { timeout_ms: 500 });
await mcp.call_tool("eval", { expression: "document.querySelector('.left-sidebar-rail button:has(.lucide-library)')?.click()" });
await mcp.call_tool("wait_for", { timeout_ms: 1500 });
```

**Creating an operation (rename workflow):**
```js
// 1. Sidebar + New Operation
const sb = document.querySelector('.left-sidebar-rail button:has(.lucide-wand-sparkles)');
if (sb) sb.click();
const b = [...document.querySelectorAll('button')].find(b => /New Operation/i.test((b.innerText || '').trim()) && b.offsetParent !== null);
if (b) b.click();
// 2. Fill title
await mcp.call_tool("eval", { expression: "(() => { const i = document.querySelector('input.entry-view-title'); if (i) { const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value'); s.set.call(i, 'My title'); i.dispatchEvent(new Event('input', { bubbles: true })); } return true; })()" });
// 3. Fill body textareas
await mcp.call_tool("eval", { expression: "(() => { const tas = [...document.querySelectorAll('textarea')]; const intent = tas.find(t => t.placeholder?.includes('sigil')); if (intent) { const s = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value'); s.set.call(intent, 'I AM PROTECTED'); intent.dispatchEvent(new Event('input', { bubbles: true })); } return true; })()" });
// 4. Set category
await mcp.call_tool("eval", { expression: "(() => { const sels = [...document.querySelectorAll('select')].filter(s => s.offsetParent !== null); const s = sels[0]; if (s) { const set = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value'); set.call(s, 'sigils'); s.dispatchEvent(new Event('change', { bubbles: true })); } return true; })()" });
// 5. Commit via right-click + Rename
await mcp.call_tool("eval", { expression: "(() => { const item = [...document.querySelectorAll('.panel-interactive')].find(el => el.offsetParent !== null && (el.innerText || '').includes('Untitled Operation')); if (item) { const r = item.getBoundingClientRect(); item.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, view: window, clientX: r.left + 20, clientY: r.top + 20, button: 2, buttons: 2 })); } return true; })()" });
await mcp.call_tool("wait_for", { timeout_ms: 500 });
await mcp.call_tool("eval", { expression: "[...document.querySelectorAll('.context-menu-item')].find(el => /^rename$/i.test((el.innerText || '').trim()))?.click()" });
await mcp.call_tool("wait_for", { timeout_ms: 500 });
await mcp.call_tool("eval", { expression: "(() => { const input = [...document.querySelectorAll('input')].find(el => el.offsetParent !== null && (el.className || '').includes('flex-1 bg-transparent text-sm')); if (input) { const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value'); s.set.call(input, 'My title'); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); input.blur(); } return true; })()" });
```

**Creating a task:**
```js
await mcp.call_tool("eval", { expression: "(() => { const i = [...document.querySelectorAll('input[type=\"text\"]')].find(el => el.offsetParent !== null && !el.placeholder && (el.className || '').includes('bg-stone-800')); if (i) { const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value'); s.set.call(i, 'Buy sage'); i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); i.blur(); } return true; })()" });
```

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


### Wiki needs a view-switch refresh after create
**Wiki articles are in the list immediately after `entry-view-title.blur()`, but React needs ~500ms to re-render.**

```js
await mcp.call_tool("eval", { expression: "document.querySelector('.left-sidebar-rail button:has(.lucide-book-open)')?.click()" });
await mcp.call_tool("wait_for", { timeout_ms: 500 });
await mcp.call_tool("eval", { expression: "document.querySelector('.left-sidebar-rail button:has(.lucide-library)')?.click()" });
await mcp.call_tool("wait_for", { timeout_ms: 1500 });
```

### Operations need the rename workflow
**Operations do NOT react to `entry-view-title.blur()`** the way Wiki does. Commit via right-click → Rename in the context menu. See the table above.

### `btn-primary` only exists in list views
`button.btn-primary` is there as long as a list view without an open detail is
active; with a tab open it disappears. Use the stable route instead:
`button[title="New Entry"]` in the head of the list panel — that one is always
present. (Verified: in the wiki list view `btn-primary` is present, with a detail
tab open it is not.)

### Settings is a modal, no longer a panel
Since the modal consolidation, Settings is a `.modal-card` above the app.
The rail stays fully in the DOM and visible — the old rule
"all sidebar items are `offsetParent === null`" **no longer holds**
(verified: 10 out of 10 rail buttons stay visible). A synthetic `.click()`
therefore still reaches the rail, but the modal stays open and covers everything
that follows. Close it explicitly before testing further:

```js
document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true}))
```

Escape closes it reliably (verified).

### Reload = the reset button
`mcp.call_tool("navigate", {url: "http://localhost:1420/"})` remounts the app (React state gone, SQLite DB stays).

## Diagnostic helpers

### Dump the current state

```js
JSON.stringify({
  lang: document.documentElement.lang,
  platform: document.documentElement.dataset.platform,
  viewHeading: document.querySelector('.app-main')?.innerText.trim().split('\n')[1],
  selectedListRow: document.querySelector('.sidebar-item.active')?.innerText.trim(),
  tabs: [...document.querySelectorAll('.tabbar button')]
          .map(t => t.innerText.trim()).filter(Boolean),
  modalOpen: !!document.querySelector('.modal-card'),
  editorOpen: !!document.querySelector('.ProseMirror'),
  titleValue: document.querySelector('input[placeholder*="ntitled" i]')?.value,
  bodyText: document.querySelector('.ProseMirror')?.innerText?.slice(0, 200)
}, null, 2)
```

**Careful — there is no reliable signal for the active view.**
The rail buttons carry no active state whatsoever: no `active`, no
`aria-current`, no `data-*` — all eight are simply `btn-ghost`
(verified against the running build). `viewHeading` is therefore only an
approximation via the text of the main area, and language-dependent with it.
`.sidebar-item.active` is **not** the active navigation but the highlighted row
in the entry list — hence `selectedListRow` here.

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

Checks the connection **and** the selectors that have failed most recently.
Connect and attach first:

```
connect  ->  pick the target with "type": "page"
attach   ->  { "target_id": "<id from connect>" }
status   ->  confirms the connection
```

Then check the UI via `eval`:

```js
(async () => {
  const icons = ['book-open','square-check-big','wand-sparkles','library',
                 'flame','tag','trash2','settings'];
  const missing = icons.filter(i =>
    !document.querySelector(`.left-sidebar-rail button:has(.lucide-${i})`));
  const view = () => document.querySelector('.app-main')?.innerText.trim().split('\n')[1] || '';
  document.querySelector('.left-sidebar-rail button:has(.lucide-flame)').click();
  await new Promise(s => setTimeout(s, 700));
  const altar = view();
  document.querySelector('.left-sidebar-rail button:has(.lucide-book-open)').click();
  await new Promise(s => setTimeout(s, 700));
  return { railSelectorsMissing: missing, navigatedTo: altar, backTo: view(),
           newEntryBtn: !!document.querySelector('button[title="New Entry"]'),
           pass: missing.length === 0 && altar.length > 0 };
})()
```

Expected: `railSelectorsMissing: []`, `navigatedTo: "Altar"`, `pass: true`.
If `railSelectorsMissing` is not empty, the rail has changed — update this skill
before running tests.

## When something does not work

| Symptom | Cause | Fix |
|---|---|---|
| `attach` fails | Emerald is not running, or `start_emerald_mcp.bat` did not source vcvars | use cmd instead of bash |
| No window anywhere | Intended — it is off-screen. Use `screenshot`; `EMERALD_MCP_OFFSCREEN_XY=40,40` brings it back |
| Unexpected entries in the app | Intended — the test vault's fixtures, plus what earlier runs left: it is not reset between runs |
| Driving the wrong checkout | Check `status`: it names the checkout and how it was found; `EMERALD_APP_DIR` forces one |
| Sidebar buttons do not react | the Settings modal is open | press Escape + click the X buttons |
| The entry is not saved | no "Done" button → the editor is still in reader mode | click/type first, then Done |
| `Suchen...` instead of `Search...` | the language is set to German | intended, or switch back in Settings |
| `.ProseMirror` is null | the editor is not mounted yet | click into the body area first |
