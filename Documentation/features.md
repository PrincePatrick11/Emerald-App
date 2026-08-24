# Features

## Journal

The journal is the primary day-to-day writing space. Each entry has a title and a rich-text body edited with TipTap.

**Moon phase.** When you create an entry, the current lunar phase is calculated automatically and stored. You can change it in the Properties sidebar. The phase appears as an icon and label below the title in read mode, and is included in exports.

**Paradigm, Banishing, Meditation.** These three fixed properties in the Properties sidebar let you link an entry to wiki articles of the corresponding category:

- *Paradigm* — the magical framework or system you were working within.
- *Banishing* — the banishing technique used. Setting this marks the entry as a banishing (`is_bannung = true`).
- *Meditation* — the meditation type used. Setting this marks the entry as a meditation (`is_meditation = true`). A duration field (in minutes) becomes available when a meditation type is selected.

**Linked Operations and Wiki Articles.** Any journal entry can reference one or more operations and wiki articles. These appear as clickable chips below the title in read mode and are included in Markdown and Emerald exports.

**Tags.** Free-form labels shared across the app. Tag names are stored directly on entries (not as IDs). The Tags view lets you see all entries carrying a particular tag.

**List views.** The journal list supports three layouts (List, Cards, Timeline) and four sort orders (newest first, oldest first, A→Z, Z→A). A filter panel lets you filter by moon phase. Search filters by title.

**Context menu.** Right-click any entry in the list or sidebar to Duplicate, Rename, or Delete it. The menu always draws above everything else and stays inside the window — near an edge it flips back towards the cursor rather than being cut off.

## Wiki

The wiki stores reference articles about anything relevant to your practice: rituals, deities, herbs, symbols, concepts, spells, tools, and more.

**Categories.** Each article belongs to one category. Twelve built-in categories cover the most common types. You can add custom categories from the list view. Category sort groups articles by category with inline category management. Deleting a custom category moves its articles to the built-in **Other** category rather than losing the association; built-in categories, including Other, cannot be deleted.

**Icons.** Articles can have a custom icon: either an emoji character or an image. Image icons render only when the icon value is a local-safe source (`/` path), a `data:image/...` URL, or a `blob:` URL. Remote `http://` and `https://` icon URLs are not rendered as images.

**Cover Images.** A banner image displayed at the top of the article in read mode. Stored as an inline data-URL directly on the entry row, not as a file in the vault's image folder.

**Backlinks.** `fetchBacklinks` and the `BacklinksPanel` component that lists every journal entry, wiki article, or operation linking to the current article still exist, but the panel is not currently surfaced anywhere in the UI — it was removed from the right sidebar along with the old tab bar and has not yet been reintroduced elsewhere.

**Special categories.** `paradigm`, `bannung`, and `meditation` articles are used as the target for the matching journal entry properties. These categories are not shown as generic filter chips in the wiki list.

## Operations

Operations track magical workings: rituals in progress, ongoing practices, servitors, and sigils.

**Categories.** Three built-in categories (Sigils, Servitors and Other) and any number of custom categories you define. Categories have a name and an emoji. Deleting a custom category moves its operations to the built-in **Other** category rather than losing the association; built-in categories, including Other, cannot be deleted.

**Active / Inactive.** Each operation can be marked active or inactive. The status badge in the operation's read view is clickable and saves immediately. The filter panel lets you filter the list to active or inactive operations.

**End Date and Version.** Optional fields available for all operations. End date is a calendar date; version is a free-form string (e.g. `1.0`, `draft`).

**Icon and Cover Image.** Operations support the same icon and cover image model as wiki articles. The operation icon is used in Operations list views and in the Home dashboard operation section. Custom operation icons now take precedence; when no custom icon is set, Emerald falls back to the operation category emoji.

### Sigil Workflow

Sigils are operations in the `sigils` category. Their detail view (`OperationSigilView`) replaces the generic operations editor.

1. Write the magical intention in the intention field.
2. Use "Reduce automatically" to extract unique letters into the letter bank, or add them manually.
3. Mark letters as implemented as you incorporate them into the design.
4. Draw the sigil on the canvas.
5. Set a target reveal date if you want the sigil to stay hidden until a specific date.
6. Link a charging technique (a wiki article from the `sigil_charging` category) to document how the sigil was charged.
7. Mark the sigil as loaded once it has been activated.

The sidebar visibility toggles (show/hide intention, letter bank, sigil image) are persisted and respected exactly as set — they are not reset when you reopen the entry.

### Servitors

Servitors use the `servitors` built-in category and use the standard operations editor. No special fields beyond the common operation fields.

## Altar

The altar is a virtual arrangement of symbolic objects on a canvas.

**Dashboard.** Opening the Altar section shows a dashboard listing all your altars with search, sort, and view-mode options. Click any altar to open it; use the breadcrumb back button or the Altar entry in the left sidebar to return to the dashboard.

Dashboard cards and list rows show a **thumbnail preview** of each altar. The thumbnail is captured automatically whenever you leave edit mode — whether via the Done button, Cancel, the back-arrow breadcrumb, or switching to a different module — using a native Canvas 2D renderer and stored in the database. Altars that have not yet been saved after this feature was introduced show a live `AltarCardPreview` fallback instead. Changing the canvas aspect ratio clears the stored thumbnail so the card always shows the correct proportions. Card thumbnails are capped at a maximum height of 176 px and scale proportionally without cropping.

**Altar library.** You manage a personal library of items. Each item has a name, an emoji, a category, an optional note, and an optional uploaded image.

**Item categories** are fully dynamic. The library ships with eight default categories — Candle, Crystal, Herb, Deity, Symbol, Tool, Table, Other — but you can create, rename, and delete categories at any time:

- Hover a category tab in the library strip to reveal a pencil icon that opens the inline rename/delete editor.
- Drag a category tab left or right to change its position in the tab row. Tabs animate smoothly into their new slots and the order is saved immediately to the database.
- Click the "+ Category" button — always visible to the right of the scrollable tab row — to add a new category; choose a name and pick an emoji from the palette.
- Deleting a category moves its items to the built-in **Other** category rather than leaving them unassigned. The default categories (Other among them) cannot themselves be deleted, since deleting one would leave its own items with nowhere to go. An **Uncategorized** tab can still appear in the library strip as a fallback for items whose category doesn't resolve to any existing one, but it is no longer how deleting a category behaves.
- Renaming a category updates all items already assigned to it.
- When there are more categories than can fit on screen, the tab row scrolls horizontally. The scrollbar is hidden; gradient fade overlays on the left and right edges indicate that more tabs are available in that direction.

Library editing uses a modal flow for **add / edit / delete** actions on individual items. In edit mode, the library strip is docked under the canvas, supports resize, and persists height in `localStorage` (`altar-library-height`). When uploading an image for a new item, if the name field is empty the filename (without extension) is pre-filled and selected so you can confirm or edit it immediately.

Library tiles use a compact fixed footprint (**70×85 px**) to keep more items visible.

**Placing items.** In edit mode, drag items from the library panel onto the altar canvas. Items can be repositioned by dragging, scaled with a handle, rotated, layered (`z-index`), adjusted for opacity, hidden, and locked.

Locked placements are click-through on the canvas (pointer events disabled), so interactions pass to items behind them.

**Inspector and placement controls.** The right sidebar includes a placed-elements list and an inline inspector rendered directly under the selected row. The inspector shows a compact 4-column grid of `x (%)`, `y (%)`, `rot (°)`, `scale (%)`, plus a jade-styled opacity slider. Layer order is controlled by dragging rows in the list (see below); Z-order buttons are not shown in the inspector. The delete button is in the placed-element row, not the inspector.

**Duplicate.** In edit mode, each placed-element row has a Duplicate button (copy icon). Duplicating a placement creates a copy with identical size, rotation, and opacity, offset +2% in both axes, placed on top of all other elements, unlocked, visible, and immediately selected. The same action is available via right-click on any row.

**Row actions (edit mode).** Each placed-element row shows, from left to right: a grip handle for drag-to-reorder, then the item visual and name, then Duplicate, Lock/Unlock, Eye/Hide, and Trash icon buttons. Right-clicking a row opens the app's shared context menu with "Duplicate" and "Remove" entries — the same one every entry list uses, so it looks the same, flips away from the window edges, and closes on Escape as well as on the next click.

**Drag-to-reorder Z-order.** In edit mode, rows in the placed-elements list can be dragged up or down via the grip icon on the left edge. Dropping a row at a new position immediately reassigns Z-index values for all placements so that the visual stacking order matches the list order (top of list = highest Z-index). This replaces the previous layer-order buttons.

**Selecting elements.** Clicking a row in the placed-elements sidebar highlights the corresponding element on the canvas with a jade border in both view and edit mode. Clicking the same row again deselects it (the inspector closes). Clicking an empty area of the canvas or the sidebar also deselects.

**Favicon.** Each altar can have a custom favicon displayed in its tab in the tab bar and as the first row in the view-mode summary panel. To set one, open the altar in edit mode and expand the collapsible "Favicon" section at the top of the sidebar. You can pick an emoji from the shared emoji picker (a curated default grid, searchable by name/keyword across the full standard emoji set) or upload an image (stored directly as base64). When a favicon is set, the tab shows it instead of the default flame icon; when none is set, the flame icon is used as a fallback.

**Sidebar in view mode.** When viewing an altar outside edit mode, the right sidebar's action bar shows Edit and a Fullscreen toggle, and the Properties area below it shows a compact **summary panel** instead of the full editor. It displays:

- **Favicon** — shown as the first row when a favicon is set (emoji or image thumbnail).
- **Ratio** — the current aspect ratio (e.g. `16:9`).
- **Background** — the active background name with a small swatch preview (image, gradient, or preset).
- **Overlay** — opacity percentage and color (dark/light).
- **Grid** — active/inactive status and grid size.
- **Elements** — count of placed items.

A note at the bottom reminds you to switch to edit mode to change these settings. The header fullscreen button (in the altar's own topbar) only appears when the sidebar is closed, since the sidebar's action bar already provides one while it's open.

Exporting the altar as an image (JPEG / PNG / WebP) is done from the application menu, not the sidebar — see [Export and Import](#export-and-import) below. The export renders the current altar at full native resolution via the native OS save dialog. JPEG uses quality 0.97, WebP uses 0.92, PNG is lossless. The suggested filename and the OS save dialog filter adapt to the selected format (e.g. `AltarTitle_YYYY-MM-DD.png`).

**Sidebar in edit mode.** The full editor panel — Canvas Options, Change Background, Overlay Options, Grid Options, and Placed Elements — is visible only when the altar is in edit mode. Each section is collapsible with a chevron toggle. The open/closed state of all six sections (Background, Overlay, Grid, Favicon, Canvas Options, Placements) is saved per altar in `localStorage` and restored when you switch back to that altar. Sections default to open the first time an altar is opened.

**Canvas resolution.** Each altar stores a canvas resolution in its database row. In edit mode the sidebar shows a collapsible "Canvas Options" section with six aspect-ratio buttons (16:9, 4:3, 3:2, 1:1, 2:3, 9:16). Selecting a ratio stores it directly as a string (e.g. `"16:9"`); the canvas then fills the available viewport at that proportion with `scale: 1` and a dynamic native size. Legacy pixel-format resolutions (e.g. `"1920x1080"`) continue to work as before — the canvas renders at that fixed native size and is scaled to fit the viewport via CSS transform. Dashboard preview cards reflect the altar's aspect ratio.

**Grid and snapping.** Each altar stores its own grid configuration: overlay toggle, size (8–128 px), opacity (1–25%), color, snap-to-grid, rotation snap, and scale to grid. Settings are saved immediately to the database and persist per altar, so switching between altars always restores that altar's own grid state. Grid controls are visible only in edit mode.

The grid is rendered as an SVG overlay directly in the canvas, with lines placed at exact percentage positions derived from a stable reference resolution. This means the grid renders without edge artefacts on Retina displays and does not change its cell count when the window is resized.

- *Snap to grid* — snaps item positions precisely to the nearest grid intersection. Step sizes match the visual grid lines exactly.
- *Snap rotation angle* — when enabled, dragging the rotation handle snaps to a configurable angle step (1–180°, default 15°). When disabled, rotation is free; holding Shift still snaps to 15° steps.
- *Scale to grid* — when enabled, resizing a placement snaps to the nearest whole number of grid cells on both axes, so items always align to the grid as a box.

The grid is also visible in exported images and captured thumbnails — the same grid settings (`grid_enabled`, `grid_size`, `grid_color`, `grid_opacity`) are applied by the Canvas 2D renderer that produces thumbnails and the altar image export (Export → Export as Image).

**Multiple altars.** You can create several named altars and switch between them. Each altar has its own title, intention text, background, and set of placements.

**Backgrounds.** A **Gradient** background type — pick one of 7 preset swatch colours or any custom colour via a colour wheel, opened from a small modal — plus 16 photographic image presets, and the option to upload a custom background image. The four original named presets (Midnight, Ember, Forest, Moon) are no longer offered as a picker in the sidebar; they are kept only so altars saved before the gradient picker was introduced keep rendering their original colour.

The image presets are organised thematically — Forest & Nature, Mountains, Caves & Grottos, Magic & Portals, Temples & Halls — and displayed as a 4-column thumbnail grid below the colour presets in the sidebar. Thumbnails (160×90 px) are served from `public/backgrounds/thumbs/`; the full-resolution image is only loaded by the canvas when that preset is active. Each preset has a localised display name in all four supported languages.

Custom backgrounds are persisted as file-backed image paths (legacy inline data URLs are migrated). Background previews use a cached preview map for reliable rendering.

**Overlay Options.** In edit mode, the sidebar exposes a collapsible "Overlay Options" section (between Background and Grid Options) containing two controls grouped in a bordered box:

- *Opacity slider* — adjusts the overlay intensity from 0–100%. The value is stored per altar as a `0.0–1.0` real number and defaults to `0.2`.
- *Dark / Light toggle* — switches the overlay color between a dark gradient (`rgba(10,10,15,…)`, the default) and a light gradient (`rgba(255,255,255,…)`). Stored per altar in `background_overlay_color` (values: `'dark'` or `'light'`).

The overlay is applied on top of all background types — colour presets, gradient presets, photographic image presets, and custom background images.

**Intention.** A text field on each altar records your intention or purpose for that setup.

**View mode and full-window mode.** Full-window altar mode is only available in view mode. Entering edit mode exits full-window mode automatically. Pressing **Escape** while in full-window mode also exits it. Grid controls and all edit panels are hidden in read/view mode. The fullscreen toggle is accessible both in the altar header and in the sidebar summary. In the header: the Exit Fullscreen (Minimize2) button is always visible while fullscreen is active — regardless of whether the sidebar is open — and the Enter Fullscreen (Maximize2) button appears only when not in fullscreen and the sidebar is closed.

## Navigation

**Window title bar.** The app draws its own title bar across the top of the window: the Emerald logo, the application menu, back/forward navigation through the view history, a search field, and — on Windows and Linux — the minimise / maximise / close buttons. The logo is decoration, not a button: clicking it used to be the only way to the dashboard, which now has its own Home button at the top of the left rail. macOS keeps its native window buttons and its native menu bar instead, so its title bar shows only the logo, navigation and search. The search field currently opens the left entry list; a cross-module search is not implemented yet. The search field fills whatever space is left between the menu and the window controls and is always visible; if the window gets narrow enough to squeeze it too far, the four menus (Edit/View/Export/Import) fold into a single menu button instead, so the search field never has to hide. The app's minimum window width is 720px.

**Left sidebar structure.** The left sidebar has two parts side by side:

1. A narrow icon **rail** — a toggle to collapse/expand the entry list next to it, a second toggle to collapse/expand the right sidebar (so both sidebars are controlled from the same rail; both toggles animate the sidebar's width in and out rather than snapping it), then six navigation icons — Home (opens the dashboard) above Journal/Tasks/Operations/Wiki/Altar — and, at the bottom, Tags and Trash grouped together, then Vault and Settings below a divider. Clicking a navigation icon switches the main view; only Home overwrites the active tab rather than opening a new one, since it has no content of its own to keep open. The other icons do not highlight, since they're independent of whichever list tab is open. The Vault button opens vault management — see [Vaults](#vaults) below. Both sidebar toggles are mirrored in the *View* menu as **Entry List** and **Properties**, each showing a checkmark for its current state so either route stays in sync with the other.
2. A resizable, collapsible **entry list** panel next to the rail, with six tabs (**All** / Journal/Tasks/Operations/Wiki/Altar) that switch which items are listed. The All tab lists every module's items together in one list, sorted by last-updated. Each tab has its own search field, a "+" button to quick-create a new item, inline rename (double-click or via the context menu), and a right-click context menu (Duplicate/Rename/Delete where applicable — Altar only offers Rename, since it has no duplicate action; Tasks offers Rename/Delete and shows a completion checkbox on each row instead of an icon, except in the All tab, where a Task row shows a static checkbox icon instead). Journal, Operations, and Wiki rows can also be dragged into the editor to insert an internal link — in the All tab this still only applies to those three; Tasks and Altar rows there don't show a grab cursor. The panel can be collapsed entirely via the toggle in the rail, and its width is remembered independently of the main window.

**Breadcrumb back links.** When an entry is open in JournalView, WikiView, or OperationsView, the topbar shows a clickable breadcrumb that navigates back to the corresponding list view (e.g. clicking "Journal" returns to the journal entry list without closing the tab).

**Right sidebar action bar.** Entering/leaving edit mode, saving, cancelling, and deleting an open Journal entry, Wiki article, Operation, or Altar all happen from a single action bar pinned above the Properties panel in the right sidebar — not from buttons in the entry's own header. In view mode it shows an Edit button (plus a Fullscreen toggle for Altar); once you're editing, it shows Done, Delete (where applicable), and Cancel. A loaded Sigil operation shows no actions there, since loaded sigils can't be edited.

**Internal link chips.** Links inserted with `[[` are rendered as styled chips in both edit mode and view mode. There is no raw `[[Label(id)]]` text representation in edit mode.

## Tabs & Workspace

Emerald supports browser-like tabs so you can keep several pieces of content open at the same time.

Tabs can contain journal entries, wiki articles, operations, sigils, and altars. This makes it easier to work across related material without losing your current place — for example, writing a journal entry while referencing a wiki article and an active operation.

You can:

- Open supported items in tabs.
- Switch between tabs without navigating away from your current workspace.
- Close tabs individually.
- Drag tabs left/right to reorder them.
- Scroll the mouse wheel over the tab bar to scroll it horizontally once there are more open tabs than fit.
- Open entries, wiki articles, and operations in a new tab with middle-click.
- Close a tab with middle-click on the tab itself.
- Create a new empty tab from the tab bar.
- Reopen the app and continue with the previously open tabs in the same order.

Tab reordering uses Framer Motion's `Reorder.Group` / `Reorder.Item` for drag interactions and animated layout transitions. The resulting order is persisted in `localStorage` as part of the `open-tabs` payload.

If an item is already open, Emerald reuses the existing workspace context instead of forcing you to rebuild your working set from scratch.


## Routines

Routines are reusable content blocks that you can drop into any journal entry.

Each routine has a name, an emoji, plain-text content (Markdown is supported), and optional lists of operations and wiki articles to link.

Dropping a routine into an open entry appends its content as formatted paragraphs and merges its tags, linked operations, and linked wiki articles into the current entry. The drag-and-drop mechanism (`routine-drop` event, handled by JournalView/WikiView/OperationsView) is intact, but its source — a `RoutinesPanel` in the right sidebar — was removed along with the old sidebar tab bar and is not currently rendered anywhere, so there is presently no UI path to start the drag.

## Tasks

The Tasks module provides a hierarchical task manager with categories, priorities, and cross-references to Journal entries, Wiki articles, and Operations.

**Categories.** A default "Allgemein" category is seeded on first launch and cannot be deleted. You can create, rename, and delete custom categories from the list view via the pencil button on each category header. Deleting a category moves its tasks to "Allgemein" — they are not lost. Categories show an emoji icon, a name, and a task count badge.

**Subtasks.** Every task can have nested subtasks to any depth. Subtasks are indented under their parent and can be expanded or collapsed. Marking a parent task as completed recursively marks all subtasks as completed (and vice versa). Deleting a parent task also deletes all its descendants.

**Priorities.** Each task has a priority: Low, Medium, or High. The priority is displayed as a colored flag icon (green, yellow, red) and can be changed via a dropdown on each task row.

**Links.** A task can link to Journal entries, Wiki articles, and Operations. Linked entries appear as clickable chips on the task row — clicking navigates to the linked entry.

**Toolbar.** The list supports a search bar, five sort orders (Category, Newest, Oldest, A–Z, Z–A), and a Show/Hide Completed toggle. Only the List view is available.

**Filter panel.** Filters by category (multi-select chips) and priority (multi-select pill buttons). Active filters show a count badge on the filter toggle button. When a category filter is active, only the selected categories are shown in the grouped view.

**Grouped view.** When sorted by Category, tasks are grouped under collapsible category headers. An always-visible "Uncategorized" section collects tasks without a category — it cannot be deleted.

**Inline editing.** Double-click a task title to rename it inline. Press Enter to save, Escape to cancel.

**Context menu.** Right-click any task to Mark as Completed/Active, Add Subtask, Link Entry, or Delete.

**Trash integration.** Deleting a task (or category) soft-deletes it and sends it to the Trash view where it can be restored or permanently removed.

## Trash

Deleting a journal entry, wiki article, or operation moves it to the Trash rather than removing it permanently. Trashed items are retained for 30 days and then automatically purged at startup.

From the Trash view you can:

- **Restore** an item to return it to its original section.
- **Delete permanently** to remove it immediately.
- Select multiple items and delete the selection.
- Empty the entire trash at once (requires confirmation).

Tags and categories also support soft-delete and restoration.

## Vaults

A vault is a **folder** you choose, holding its own database and its own images — see [Multi-Vault System in `database.md`](database.md#multi-vault-system) for the on-disk representation. Because nothing inside it refers to a location, a vault folder can be copied to another machine and opened there. A vault can also carry its own icon: any emoji, shown on its card and on the Vault rail button whenever it's the active one; without one, both show the plain vault glyph.

**First start.** A brand-new installation has no vault yet. Instead of one being created for you, Emerald opens straight into the vault modal below — with no way to close it — until you create or open at least one. An installation carried over from before multi-vault support is unaffected: its existing database is adopted automatically as a vault named "Emerald".

Vault management lives in its own modal, opened via the Vault icon in the left rail (directly above Settings):

- Each vault is shown as a card with its name and its folder. Clicking a card switches to that vault; the currently active vault's card is disabled and shown with a jade-tinted border/background and icon badge instead.
- **New Vault** creates a new, empty one. Give it a name and, optionally, an icon; the row shows exactly where it will land, updating live as you type — by default `Documents/Emerald/{name}`, with a folder-picker button to choose somewhere else and a reset button to go back to the default. The target folder has to be empty: sharing it with unrelated files would make deleting them ambiguous later.
- **Open vault** adds a vault that already exists on disk: pick its `emerald.db` file (not its folder — a folder dialog can't show you whether one is even there), and it joins the list under its folder's own name. This is how you take a vault over from another machine, or re-add one you removed from the list.
- **Edit** and **Delete** are inline states on the same card. Edit changes the name and the icon together, in one step. Delete asks for confirmation and offers a **"Delete the files as well"** checkbox — off by default, showing the folder it would erase. It removes the vault's own files rather than the folder wholesale: if anything else is in there, Emerald notices before deleting anything and leaves the folder untouched. Any vault can be deleted, including the active one and the last one remaining — deleting the active vault switches you to another one automatically, and deleting the last one returns you to vault setup.
- A vault whose folder has moved or is on a disconnected drive is marked **Folder not found** and cannot be switched to. A folder button next to it lets you point it at the file's new location (again via its `emerald.db`). Emerald deliberately does not recreate a missing folder — SQLite would put a fresh, empty database in it, and the vault would come back looking empty rather than telling you something is wrong.
- A vault Emerald is not *allowed* to read is marked **No access** instead, and gets no relocate button — the folder is exactly where you left it. On macOS this is what `~/Documents`, `~/Desktop` and iCloud folders look like until you grant access in System Settings › Privacy & Security; picking the vault's `.db` file in the open dialog does not by itself grant that access.
- A vault folder inside iCloud Drive, Dropbox or OneDrive works, but SQLite on a synchronised folder can be damaged if the sync client touches the file mid-write.

New vaults are not switched to automatically — except during first-start setup, where the first one you create or open becomes the active vault, since there is nothing else to show. This is separate from importing a vault from a `.emeralddb` backup file (Settings → Backup → Import → Add Vault mode), which also creates a new vault but populates it from the backup's contents — see [Vault Backup](#vault-backup-emeralddb) below.

## Export and Import

All export and import actions are in the application menu. Where that menu lives depends on the platform: on macOS it is the native menu in the system menu bar at the top of the screen; on Windows and Linux it is rendered in the app's own title bar. Both offer the same items with the same enabled/disabled rules. The menu bar stays available in the altar's distraction-free full-window mode, since that is where image export is most often wanted.

> **Sigil-category Operations export is temporarily disabled.** Export (Markdown, PDF, Emerald) works for Journal and Wiki entries, for altars, and for Operations in any category *except* Sigils. Opening a Sigil (an Operations entry in the `sigils` category) leaves all three "Export as …" menu items greyed out — export for that category isn't wired up correctly yet, so the items are disabled rather than left to produce a broken result. This is a temporary state, not a permanent design decision; the menu items will re-enable for Sigils once that export path is implemented. Import (Markdown and Emerald) is unaffected and still supports Operations, including Sigils, as a destination.

### PDF Export

Prompts a native save dialog for the destination and writes the PDF directly to disk — there is no preview window and no system print dialog. The PDF is rendered by the app's own webview (WebView2 on Windows, WKWebView on macOS, WebKitGTK on Linux), so emoji render as proper colored glyphs (Segoe UI Emoji / Apple Color Emoji / Noto Color Emoji) without any frontend rasterisation. The suggested filename is `<Title>_YYYY-MM-DD.pdf`; the user picks the actual location in the OS save dialog. Images in the entry are embedded as base64 before the PDF is generated; internal link chips are rendered as styled spans inside the content.

The **Export → Export as PDF…** menu item is available while a Journal / Wiki / non-Sigil Operations entry is open, or while an Altar is open in **reading view** (not while editing it) — it is disabled on the home view, the tag manager, the trash, and (for now, see note above) while a Sigil-category Operations entry is open. For Journal/Wiki/Operations it exports the entry text as described above; for an open Altar it instead exports the rendered altar image as a single-page PDF (see Altar PDF Export below).

### Altar PDF Export

When an Altar is open in reading view, **Export → Export as PDF…** renders the altar the same way the image export does (full native resolution) and embeds that image as a single page in a PDF instead of exporting text content. The PDF page size is derived from the altar's own pixel aspect ratio rather than a fixed portrait page: the long edge is 11", and the short edge follows the aspect ratio, so a portrait altar (e.g. 9:16) produces a portrait page and a landscape altar (e.g. 16:9) produces a landscape page. On Windows this custom page size is applied natively in the print pipeline; on macOS and Linux the export itself is implemented and hardware-verified, but the custom-page-size logic isn't — both currently ignore the altar's aspect ratio and fall back to the platform's default page size. There is no separate "Export Altar as PDF" menu item — the existing Export as PDF item is reused and switches behavior based on what's currently open. A confirmation dialog shows the saved file path once the PDF is written, matching Journal/Wiki/Operations PDF export.

### Altar Image Export

A nested **Export as Image** submenu (Export → Export as Image → JPEG… / PNG… / WebP…) renders the currently open altar at full native resolution and prompts a native save dialog for the destination. This submenu is enabled only while an Altar is open in **reading view** — it is disabled while editing an altar, while any non-altar content is open, and when no altar is open. A confirmation dialog shows the saved file path once the image is written.

### Markdown Export

Saves a `.md` file with a frontmatter block followed by the entry body. Frontmatter includes date, moon phase, paradigm, banishing, meditation, linked operations, linked wiki articles, category, status, end date, version, and tags. Images are stripped (not included). Internal link chips become `[[Title]]` wiki-link syntax. Linked operations and wiki articles include their UUID: `Operations: Title [uuid]`.

### Emerald Format

The Emerald format (`.emerald` file extension) is a JSON file that captures the full entry — or, for altars, the full altar — including all metadata and embedded images. It is designed for lossless transfer between Emerald installations.

The single **Export → Export as Emerald…** menu item is shared between Journal/Wiki/Operations entries and altars: it is enabled whenever a Journal / Wiki / non-Sigil Operations entry is open, or an Altar is open in reading view, and exports whichever is currently active. (Sigil-category Operations entries are temporarily excluded — see the note at the top of this section.)

The file structure:

```json
{
  "version": "1",
  "type": "journal | wiki | operations | altar",
  "title": "…",
  "createdAt": "ISO 8601",
  "content": "HTML string (intention text for altars)",
  "images": { "/absolute/path/to/image.png": "data:image/png;base64,…" },
  "meta": { … }
}
```

For `journal` / `wiki` / `operations`, on import image data-URLs are re-saved into the local image directory (with SHA-256 deduplication), HTML is sanitised with DOMPurify, and linked entries are resolved by ID first and then by title as a fallback. Tags are synced into the local tags table.

For `altar`, `meta` carries the background preset/image/overlay, grid and snapping settings, resolution, the categories used by the placed items (name + emoji), and the full list of placed items (each with name, emoji, category, note, optional image, and placement geometry — position, size, rotation, opacity, z-index, locked/hidden). Only the background image is a local file path in the database, so it alone is round-tripped through `images` like content images; the icon, thumbnail, and every item image are already inline `data:` URLs in the database and are embedded directly.

On import a new altar is created and populated:
- Any exported category not already present locally (matched case-insensitively by name) is created first, so items land in the right category instead of "Uncategorized".
- Altar items are matched against the existing library by name + category + image content (compared as the literal `data:` URL, not a resolved file), reusing an existing item where possible and creating a new one otherwise — the item's id is not used for matching, since it proves nothing about content when importing from an unrelated vault. This means re-importing the same file repeatedly, or importing into a different vault that already has the same items, does not pile up duplicate library items, while items that merely share a name/category but have different artwork are correctly kept separate.
- If the import fails partway through, the newly created altar and any newly created (not reused) library items are rolled back, so a failed import doesn't leave orphaned items behind in the shared item library.

Import for all types goes through the same **Import → From Emerald…** menu item — the target type is read from the file itself, so no separate altar import entry point is needed.

### Import from Markdown

Parses a Markdown file exported by Emerald (or following the same structure). The `# Title` line becomes the entry title. Key-value lines before the `---` separator are parsed as metadata; unrecognised keys are ignored. The body below `---` is parsed from Markdown to HTML using `marked`.

Note: this path is parser-based (Markdown -> HTML) and is not identical to Emerald JSON import sanitisation. Metadata rendered into PDF export is escaped before interpolation.

**Destination confirmation.** The frontmatter's `type` key determines where the entry is imported. If `type` is present and is one of `journal`, `wiki`, or `operations`, the import proceeds directly into that module. If `type` is missing or set to anything else (Altar is not a valid Markdown-import destination), a modal appears showing the detected title and asking you to choose Journal, Wiki, or Operations; cancelling the modal aborts the import entirely — no entry is created. This only applies to Markdown import: `.emerald` files always carry a definite `type`, so importing from that format never prompts.

### Vault Backup (`.emeralddb`)

The full vault can be backed up and restored as a single self-contained JSON file (`.emeralddb`), separate from per-entry Emerald-format exports. The Backup section in **Settings** exposes two flows:

- **Export.** A "What to include" checkbox list lets you pick which modules go into the backup: Journal, Wiki, Operations, Routines, Altars, Tasks, and Tags. Optional `dateFrom` / `dateTo` fields restrict the export to entries created in that window (Altars, Routines, and Tasks are date-filtered; soft-deleted tasks and task categories are excluded). Embedded image files referenced from any exported entry are inlined as data-URLs.
- **Import.** Before importing, the modal shows a preview line summarising the counts per type (e.g. `12 J, 5 W, 3 O, 2 R, 1 A, 4 T`). The same checkbox list is then used to choose which types to actually apply; categories can also be filtered. Three import modes are available: **Replace** (overwrite selected tables in the current vault), **Merge** (imported entries are prefixed with a timestamp so existing IDs never collide), and **Add Vault** (import into a brand new vault and switch to it).

For the on-disk JSON structure and per-mode semantics, see [DB Backup / Restore (`.emeralddb`) in `database.md`](database.md#db-backup--restore-emeralddb).

## Image Storage and Cleanup

Images are written into the active vault's own `images/` folder, named after a hash of their content, so the same picture added twice is stored once. Entries reference them by that filename alone, which is what makes a vault folder portable.

Nothing deletes an image automatically. **Settings → Storage → Unused images** scans on demand: *Scan* reports how many images nothing points at any more and how much space they take, and *Remove* deletes exactly those. It is a manual action on purpose — an image you have just inserted but not yet saved would otherwise look unused.

Images added before vaults became folders live in a shared pool and keep rendering from there. The cleanup never proposes deleting from that pool, since a vault you have not opened since the update may still be reading from it.

## Image Upload Validation

All image upload inputs across the app accept only these MIME types: **PNG**, **JPEG**, **GIF**, **WebP**, and **SVG**. Files with any other MIME type are rejected before being processed. This applies to:

- Altar background and icon uploads (`AltarSidebarPanel`)
- Altar library item images (`AltarLibraryStrip`)
- Operation and wiki article icons and cover images (`Favicon`/`Banner`, used by `OperationPropertiesPanel`/`WikiPropertiesPanel`)
- Editor image insert via the toolbar (`EditorToolbar`)
- Paste events in the rich-text editor (`RichEditor`)
- Finder drag-and-drop into the rich-text editor (`RichEditor`)

When a rejected file is selected via a file picker, an inline error message appears near the upload control and clears automatically after 2.5 seconds. When all files dragged from Finder into the rich editor have unsupported formats, a modal popup appears (backdrop-blur overlay, alert icon, list of allowed formats, OK button) instead of silently ignoring the drop.

## Context Menus

Right-click any entry in the left sidebar or in any list view (List, Cards, Timeline layouts) to get a context menu with three actions:

**Duplicate.** Creates a copy of the entry with all fields, appending " (Copy)" to the title. Navigates to the new entry automatically.

**Rename.** Activates an inline text input directly in the list item. Press Enter or click away to save; press Escape to cancel.

**Delete.** Soft-deletes the entry and shows a 5-second undo toast in the bottom-right corner. If the deleted entry is currently open, the view navigates away.

## Typography

Emerald provides two independent font controls in Settings > Appearance:

- **UI font** — Controls the typeface used across the application shell, sidebars, settings, lists, and all non-editor UI. Default: **Inter**.
- **Editor body font** — Controls the typeface used in the TipTap rich-text editor body, entry titles, and the read-mode body of journal entries, wiki articles, operations, sigils, and the altar view. Default: **Lora**.

Both dropdowns offer the same eight typefaces: Inter, Source Sans 3, Nunito, IBM Plex Sans, Alegreya, Cormorant Garamond, Lora, and Merriweather. Serif fonts (Alegreya, Cormorant Garamond, Lora, Merriweather) fall back to Georgia; sans-serif fonts fall back to Segoe UI / system-ui.

There is no separate heading font setting. Headings inside the editor inherit the editor body font and are sized by TipTap's heading levels (h1, h2, h3). Entry view titles also use the editor body font via the `.entry-view-title` CSS class.

Font preferences are stored in `localStorage` under the keys `ui-font-id` and `editor-font-id` and persist across sessions and vault switches.

## Theming

Emerald ships with two named themes, selectable in Settings > Appearance:

- **Emerald Noctis** — Dark theme with warm stone tones and jade green accents. This is the default.
- **Emerald Parchment** — Light theme with parchment-like warm beige backgrounds, structured panel shadows, and adapted accent colours.

The theme preference is stored in `localStorage` under the key `theme-id` and persists across sessions and vault switches. Legacy `theme=light` preferences are automatically migrated to `emerald-parchment`.

Each theme defines a complete set of CSS custom properties (backgrounds, text colours, borders, accents, scrollbar colours, menu styles, danger states, etc.) in separate files under `src/themes/`. Components reference these variables so the entire UI switches consistently. A Tailwind utility bridge in `src/index.css` overrides hardcoded Tailwind colour classes for both themes. The Parchment theme includes full Altar module coverage: sidebar control buttons, danger buttons, jade CTA and fullscreen buttons, slider tracks, the format-picker, item-preview backgrounds, and category scroll-fade overlays all adapt to the warm parchment palette.

For the token naming strategy, normalization pipeline, and instructions for adding new themes, see [Architecture → Theming System](architecture.md#theming-system).
