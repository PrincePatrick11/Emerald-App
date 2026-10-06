# Features

## Home Dashboard

The Home view (the rail's top button, also the default view of a fresh tab) is a dashboard over three sections — Journal, Operations, and Wiki. Each section has its own view mode (list or cards), sort, and item count (3, 5, 10, 25 or all; 5 by default), remembered per section.

The header shows today's date with the current **moon phase** and a **New Entry** button; like the module lists' headers, it moves into the right sidebar while that is open. Rows and cards carry the same context menu as the module lists (Duplicate/Rename/Delete), and clicking an item opens it in its module. Rename edits the title in place, starting from the stored title (empty for an untitled entry); Enter saves, Escape cancels, an empty name changes nothing.

## Journal

The journal is the primary day-to-day writing space. Each entry has a title and a rich-text body. Besides the usual formatting (headings, lists, quotes, code, images, links), the toolbar inserts a horizontal rule and aligns paragraphs, headings and images left, center or right — an image aligns on its own, since it is a block with its own width. Wiki and Operations use the same editor.

**Blocks.** An entry's body is a stack of blocks — text blocks, each with the full editor, and field blocks (below). In edit mode every block shows a subtle frame: a grip to drag it up or down, its type, and a "…" menu to duplicate or remove it. Hovering between two blocks reveals a "+" that inserts a new one there; "+ Add block" below the last block is always visible. Read mode shows none of this — the blocks flow like one document.

There is one formatting toolbar, pinned to the top while scrolling, acting on the text block you are typing in. A link added from "Linked entries", an image dropped from the file explorer, or an entry dragged in from the left list lands in the text block you last worked in (a drag: the one under the pointer). Cancel reverts block changes along with the text. All of this applies to Wiki articles and Operations too, sigils included.

**Field blocks.** "Add block" offers ten kinds of field besides text: short text, number, date, choice, yes/no, checklist, link (to any entry), image, moon phase, and altar — a link restricted to altars, shown full width with the altar's picture; clicking it opens the altar.

- **Read mode** shows a field as a small label with its value, in the same typeface as the text around it; an empty field is left out.
- **Editing**, each field has its own input — a date picker, a dropdown for a choice or a moon phase, a switch for yes/no, a list with "Add item" for a checklist, a search for a link, "Choose image" for an image.
- **Settings** sit in the block's section in the sidebar: the label, a choice's options (added, renamed, removed there), whether the field is hidden in read mode while empty, and "Fully read-only".
- Checklist items and yes/no switches can be toggled straight from read mode, unless the block is fully read-only.
- A field's value is part of the entry: search finds it, links in a link field count as the entry's links (and show in "Linked entries"), and images in an image field are kept by the unused-image cleanup.

**Managing blocks in the sidebar.** While editing, a collapsible "Blocks" section below the Properties panel lists the entry's blocks: drag a row by its grip to reorder (no animation — the row jumps into place), the eye hides a block, and the "…" menu renames, shows the title as a small read-mode heading, duplicates or removes it; "+ Add block" appends one. Clicking a row selects the block and jumps to it; its own settings, if any, open in a box right under the row, like the Altar's placed elements.

- A **hidden** block keeps everything in it — greyed out and marked while editing, absent in read mode.
- A text block with no real content (only empty paragraphs or line breaks) is also absent from read mode, without being marked hidden; while editing it keeps its blank space so it can still be written into.
- **Renaming** changes only what the block is called (frame, list, and the optional heading); an empty name goes back to the type's name.
- In read mode, an entry with more than one visible block keeps the list as an outline: clicking a row scrolls to that block and briefly highlights it.

All of this is part of the entry's text, so Cancel reverts it too.

**Your own blocks.** The **Blocks** view (rail, between Templates and Categories) lists the blocks you've built on the same dashboard every module uses — icon, name, field and entry count, an "outdated" dot, and "Unsaved" for a draft left open elsewhere. The right sidebar holds the header: title, count, "New block", search, view (list, cards, wide cards, or a timeline by month of last change) and sort (last changed, name, most used).

The list opens with a collapsible "Your blocks" section; below it, laid out like the Altar library, a collapsible "Built-in blocks" section lists what "Add block" offers out of the box — text, every field kind and the three sigil blocks — as a plain, non-clickable list (text and the sigil blocks have a description tooltip). Search filters both sections. With none of your own yet, a hint invites you to build the first; the built-in section stays regardless.

*Building one.* Clicking a block opens its page: a breadcrumb back to the list, icon and name as the title, and its fields below — add by kind (including **Text**, the same rich text editor as the Text block), label, reorder by the grip, remove. No code is needed — a "Ritual log" with date, choice and checklist, for example. The right sidebar holds the icon (emoji or image), the display rules (hide empty fields in read mode, show the block's title, fully read-only), its usage, and Done/Delete/Cancel; with the sidebar closed, Done and Cancel sit in the page's own top bar.

*Drafts.* Edits are a draft until Done; leaving the page with changes asks whether to save or discard (see "Leaving an edit" under [Navigation](#navigation)). A block left unfinished in another tab shows "Unsaved" in the list until you return. Drafts are written into the vault folder (`drafts.json`), so they survive a crash or restart. In a vault inside a sync service that file is re-uploaded after every pause in typing, and two devices editing the same vault can leave conflict copies of it, which Emerald ignores.

*Copies and updates.* After Done the block appears under "Add block" in every entry, after the built-in ones. What lands in an entry is a **copy**: changing the block later leaves existing entries as they are.

- The copy's labels, options and display rules are read-only in the entry — the sidebar shows them dimmed with a note to change them in the block itself, since "Update block" would overwrite a local edit without a word. Once the block itself is gone, the copy's settings become editable.
- When the block has changed, the copy's frame shows "Newer version" while editing, and its "…" menu offers "Update block" (Cancel reverts it like any other change).
- The block's page shows how many entries use it and how many carry an older version; "Update all" brings them up to date at once — except an entry open for editing right then, or one where a loaded sigil holds the copy (see below), which are reported and left alone.
- Updating keeps every value; new fields arrive empty (or with their prefill). A field you removed keeps its data in the entries but stays hidden — the page lists removed fields and can bring them back.

*Deleting.* Deleting a block moves it to the Trash with an Undo toast and no question, leaving every copy untouched. Only when copies exist in entries or templates does a dialog offer to remove them as well: tick "Also remove it from N entries" and confirm a second time — that part can only be undone from a backup. "New block" followed by Cancel puts the new block in the Trash with Undo, like a new entry.

**Prefill.** Every field kind can be prefilled: tick "Prefill" on a field in the builder and give it a starting value — a checklist with its points, yes/no set to "Yes", a link or altar pointing at a chosen entry, an image — and every new copy starts with it. Existing copies are unaffected, and a copy created before the prefill was added keeps its own value when the block updates.

**Sigil parts.** A block can also hold the three sigil parts — calculator, drawing and charge — which work exactly like the standalone sigil blocks (see [Sigil Workflow](#sigil-workflow)). The builder lets a calculator choose how it reaches its letter bank (automatic, manual, or both — the default), a drawing preset its starting brush colour and size, and a charge preset its lock and which of the block's calculators and drawings it covers. A copy holding a loaded sigil, as a full block or as one of these parts, is never touched by "Update block" or "Update all" and never removed by "Also remove it from entries" — it is reported as skipped, so it keeps hiding what it charged. Duplicating a block that a charge hides or locks makes a copy that charge covers too, just as loaded.

**Moon phase.** A journal entry's lunar phase is never stored — it is worked out from the entry's creation date whenever it is shown. Settings → Entries decides whether journal entries show it at all, for every entry, old ones included. On, it appears as the entry's icon, as a read-only row in the Properties sidebar and in exports, and the Journal list offers the phase filter and grouping; off, all of that is gone. It is not something you choose: a duplicate gets today's phase, an imported entry the phase of the file's date.

**Linked entries.** The Properties sidebar's "Linked entries" field (above the tags) lists everything the entry links in its own text — journal entries, wiki articles, operations, tasks and altars — read directly from the content rather than kept as a separate list. The chips are grouped by category under small headings.

- In edit mode, searching (up to 50 matches, most recently updated first) and picking a result appends the link to the end of the entry as its own block — a divider, the linked item's category as a heading, then the chip; one block per link. The view jumps to it and briefly highlights it. An entry with no text yet gets its first link block without the divider.
- Clicking a listed link does the same jump-and-highlight (or navigates to the target if the link somehow isn't in the text).
- The "×" removes it — the whole block if it is one of these appended blocks, just the chip if it sits inline in running text.

The same field is available on Wiki articles and Operations. Links are included in Markdown and Emerald exports. Older vaults and backups whose journal entries still had the fixed Paradigm, Banishing and Meditation properties have them converted into ordinary links on open or import.

**Changing type.** In edit mode, a "Type" row at the top of the Properties panel shows Journal, Operations and Wiki as an icon toggle. Picking another turns the entry into that kind: it keeps its id, title, content, tags and creation date, and everything pointing at it follows — link chips elsewhere (including in templates and the Trash), its open tab and history, task links, and the prefilled link of any custom block. Wiki and Operation keep category, icon and cover image between each other; switching to Journal drops them, asking first if any are set. The content stays as it is — a default template applies only when an entry is created. Tasks and altars have a different data model and take no part in this.

**Tags.** Free-form labels shared across the app. Renaming a tag changes it on every entry at once. The Tags view lists the entries carrying a tag — journal entries, wiki articles and operations; tasks and altars carry no tags. A tag used only by templates reads "only in templates" instead of "unused". A tag in the Trash disappears from its entries until it is restored; deleting it for good removes it from them, including entries in the Trash.

**Untitled.** A new journal entry, article, operation, task or altar has no title until you type one. Wherever a title is shown — lists, cards, tabs, search, the Trash, link chips and pickers, task links, exports — an empty one reads "Untitled Entry" (Article, Operation, Task, Altar) in the app's language; renaming starts from an empty field. A duplicate of an untitled entry is called "Untitled Entry (Copy)". Older vaults and imports have the old English default titles ("Untitled Entry", "New Task" …) emptied; a title you typed yourself is never touched.

**List views.** The journal list offers four layouts (List, Cards, Cards in full width, Timeline), four sort orders (newest first, oldest first, A→Z, Z→A), and a separate Grouping toggle, which for the journal groups by **moon phase** (with the moon phase setting off, the list is simply ungrouped and has no phase filter).

- Grouped, each phase gets a collapsible group — chevron, moon emoji, name, count — in lunar-cycle order; an empty phase is left out.
- The filter panel's phase list always shows all eight phases (icon, name, count of matching entries), since the cycle is fixed, plus an "All" row on top. Deselecting every phase hides all entries.
- Search filters by title *or* tag name.
- **Timeline locks out A→Z/Z→A and the Grouping toggle** — they're greyed out with a tooltip, since the timeline orders by date and groups by month on its own (ascending if the list was sorted oldest first, otherwise newest first). The chosen sort applies again once the timeline is left. The same holds wherever Timeline is offered (Wiki, Operations, the Altar dashboard).

**Context menu.** Right-click any entry in the list or sidebar to Duplicate, Rename or Delete it — most menus also offer *Open in new tab* (the journal's own list view doesn't). The menu draws above everything and stays inside the window, flipping towards the cursor near an edge. See [Context Menus](#context-menus).

## Wiki

The wiki stores reference articles about anything relevant to your practice: rituals, deities, herbs, symbols, concepts, spells, tools, and more.

**Categories.** An article can belong to one category from the shared list — see [Categories](#categories) for how it works, including grouping and the category filter.

**Icons.** A wiki article or operation takes its icon by one rule everywhere — Home, lists, the left list, link chips, exports: its own icon (an emoji or an image), else its category's emoji, else the module's default. Image icons from remote `http(s)` addresses are not rendered; only local images and embedded image data are.

**Sort and date.** The wiki list sorts, and its timeline groups, by "last changed" — the date its rows show, as on Home and in the left list.

**Cover Images.** A banner image shown at the top of the article in read mode. It is stored with the entry itself, not as a file in the vault's image folder.

## Operations

Operations track magical workings: rituals in progress, ongoing practices, servitors, and sigils.

**Categories.** The same shared list as Wiki, Tasks and Altar items — see [Categories](#categories). Its one built-in, **Sigils**, belongs here (see [Sigil Workflow](#sigil-workflow)).

**Status, end date and version are a block.** The block **Status** (Active — yes/no, End date, Version) is a user-built block like any other: add it to an operation via "Add block", toggle "Active" straight from read mode, and rename, extend or delete it in the Blocks view. Older vaults, backups, `.emerald` and Markdown files that carry these values as fixed fields get the block added to those operations on open or import. Filtering the list by block values is planned.

**Icon and Cover Image.** Operations use the same icon rule and cover image as wiki articles (see [Wiki](#wiki)). A row shows "category · last changed"; a sigil with a target date appends "Target date: …", in rows and cards alike.

### Sigil Workflow

A sigil is an operation with three blocks — **Sigil calculator**, **Sigil drawing** and **Charge** — alongside text and any other block. A new operation in the **Sigils** category starts with all three (through the built-in default template, see [Templates](#templates)); any other operation can add them via "Add block".

1. In the calculator, write the intention and use "Reduce automatically" (or "Reduce manually") to get the letter bank — each letter once. Tick letters off as you work them into the drawing.
2. Draw the sigil in the drawing block: pen and eraser, brush size, seven colours, undo/redo, clear. It is saved as an image file.
3. In the charge block, optionally set a reveal date and link a charging technique (any wiki article), choose what charging locks — the whole entry, or only the calculators and drawings it covers — and, when the entry holds more than one calculator or drawing, which of them this charge covers (all by default).
4. In read mode, charge the sigil — optionally after a timer — and confirm.

While charged, the calculators and drawings it covers are hidden (also in search) and left out of exports until the reveal date; a charge without a reveal date hides them until you unload it. From the reveal date on they show again, still locked. "Unload sigil" (with confirmation) lifts the lock. A charge that locks the whole entry disables Edit, with a tooltip saying why.

Duplicating keeps the charge: a duplicated entry, or a duplicated block the charge hides or locks, comes out just as loaded, hidden until the same date. Saving an entry as a template, or inserting a template, brings the sigil unloaded — a template is a blueprint.

Sigils from older vaults are converted into these blocks on open (intention, letters, drawing, charge state, reveal date, technique, and notes as a text block), with a backup written next to the database first.

### Servitors

Servitors use the standard operations editor with no special fields. File them under whichever category fits — including one you name "Servitors" yourself.

## Altar

The altar is a virtual arrangement of symbolic objects on a canvas.

**Dashboard.** Opening the Altar section shows all your altars under a collapsible "Altars" heading, with search, sort and view mode (List / Cards / Cards in full width / Timeline). Click an altar to open it; the breadcrumb back button or the Altar entry in the left sidebar returns to the dashboard.

Cards and rows show a **thumbnail** of each altar, captured when you confirm an edit with Done — or leave a changed altar for another tab — and stored in the database. Cancel brings the previous thumbnail back with everything else. Without a stored thumbnail a live preview is drawn instead, leaving hidden elements out; changing a library element's picture or deleting it drops the thumbnails of the altars showing it until they are next confirmed with Done (their "last changed" date stays). Thumbnails keep the altar's proportions without cropping.

The preview can be turned off — a switch in the filter panel's "Display" group — for a lighter list that shows each altar's own icon instead (or a flame, for an altar with none).

**Altar library.** You keep a personal library of items. Each item has a name, an emoji, a category, an optional note, and an optional uploaded image.

**Item categories** come from the shared category list — see [Categories](#categories). In the altar editor, the library strip shows one tab per category that holds at least one item, plus **Uncategorized** for items without one (a new item starts there, as do items whose category was deleted for good).

- The tabs are not draggable: the strip shows only a subset of the categories, so a drag there would rearrange part of the app-wide order. Reorder in the Categories view.
- With more categories than fit, the tab row scrolls horizontally; the scrollbar is hidden and fades at the edges show there is more.
- An item with the 🕯️ emoji flickers like a candle, whatever its category.

Adding, editing and deleting items happens in a modal. Deleting moves the item to the Trash without a question: it disappears from every altar, and Undo or restoring it from the Trash puts it back in the same places. In edit mode, the library strip is docked under the canvas and can be resized; its height is remembered. When uploading an image for a new item with an empty name, the filename (without extension) is filled in and selected. Library tiles have a compact fixed size so more items fit.

**Library in the dashboard.** The Altar dashboard also shows the library below the altars, to browse and edit items without opening an altar.

- An "Altar Library" divider with a chevron collapses the whole section; that state, like the category groups under it, is remembered per vault.
- It has its own sort (A→Z, Z→A, newest first) and Grouping toggle, next to the altar list's controls in the dashboard header. Grouped, each category header shows a count and a "+" that opens the add-item dialog set to that category; only categories that hold an item are shown. Ungrouped, every matching item shows in one grid.
- Clicking a tile opens the same edit modal as in the editor; a button next to "New altar" adds an item directly.
- The dashboard's search matches item names too: if only items match, the altar list shows "No results" while the library shows its matches.
- There is no drag-and-drop here — a category is changed in the edit modal, and items are dragged onto a canvas only in the editor's own strip.

**Placing items.** In edit mode, drag items from the library onto the canvas. Placed items can be moved, scaled with a handle, rotated, layered, faded, hidden and locked. A click only selects: dragging starts after a few pixels of movement and the element keeps the spot where it was grabbed. A placement change that changes nothing is not written and does not re-date the altar. The mouse wheel does not scale — the handle and the inspector do. Locked elements are click-through, so clicks reach the items behind them.

**Inspector and placement controls.** The right sidebar has a placed-elements list with an inline inspector under the selected row: x and y (%), rotation (°), scale (%), and an opacity slider. The inspector of a locked element is locked too (dimmed, with a tooltip). The delete button sits in the row; it removes the element without a question, and the toast that follows puts it back.

**Duplicate.** In edit mode, each placed-element row has a Duplicate button (also in its right-click menu). The copy has the same size, rotation and opacity, is offset by 2% in both axes, placed on top, unlocked, visible, and selected.

**Row actions (edit mode).** Each row shows, left to right: a grip for reordering, the item's picture and name, then Duplicate, Lock/Unlock, Eye/Hide and Delete. Right-clicking a row opens the app's shared context menu with "Duplicate" and "Remove".

**Drag-to-reorder Z-order.** In edit mode, dragging a row by its grip changes the layer order: the top of the list is the front-most element, and the canvas follows immediately.

**Selecting elements.** Clicking a row highlights its element on the canvas with a jade border, in view and edit mode. Clicking the same row again, or an empty area of the canvas or sidebar, deselects (and closes the inspector).

**Favicon.** Each altar can have its own icon, shown in its tab and as the first row of the view-mode summary. Set it in edit mode in the collapsible "Favicon" section at the top of the sidebar: pick an emoji from the shared emoji picker (the vault's default grid from Settings → Entries, searchable across the full emoji set) or upload an image. Without one, the tab shows a flame.

**Sidebar in view mode.** Outside edit mode, the action bar shows Edit and a Fullscreen toggle, and below it a compact **summary panel**:

- **Icon** — the first row when a favicon is set.
- **Format** — a ratio such as `16:9`, or a pixel size such as `1920 × 1080`.
- **Background** — the background's name with a small swatch.
- **Overlay** — opacity and colour (dark/light).
- **Grid** — the grid size in pixels, or "Off".
- **Elements** — a collapsible list of the visible elements, front-most first; clicking a row marks that element on the canvas, clicking again clears the mark.

Exporting the altar as an image or PDF is done from the application menu — see [Export and Import](#export-and-import).

**Sidebar in edit mode.** The full editor — Favicon, Canvas Options, Background, Overlay Options, Grid Options and Placed Elements — shows only in edit mode. Each section collapses with a chevron; which ones are open is remembered per vault (the same for every altar) and defaults to open.

**Canvas resolution.** In edit mode, the "Canvas Options" section offers six aspect ratios (16:9, 4:3, 3:2, 1:1, 2:3, 9:16); the canvas then fills the available space at that proportion. An altar with a fixed pixel size (e.g. 1920 × 1080) renders at that size, scaled to fit. Dashboard cards reflect each altar's aspect ratio.

**Grid and snapping.** Each altar keeps its own grid: overlay on/off, size (8–128 px), opacity (1–25%), colour, snap to grid, rotation snap, and scale to grid. Changes are saved immediately, and grid controls show only in edit mode. The grid stays crisp on high-density displays and keeps its cell count when the window is resized.

- *Snap to grid* — snaps positions to the nearest grid intersection. It works with the grid hidden too; the size slider shows as soon as the grid or a snap option is on (opacity and colour only while the grid is shown).
- *Snap rotation angle* — rotation snaps to a set step (1–180°, default 15°). Off, rotation is free; holding Shift still snaps to 15°.
- *Scale to grid* — resizing snaps to an even number of grid cells (at least 2), the same on both axes.

The grid also appears in thumbnails and exported images.

**Multiple altars.** You can create several named altars, each with its own title, background and placements.

**Backgrounds.** Choose a **gradient** — one of 7 preset colours or any colour from a colour wheel, in a small modal whose Save writes it to the altar — one of 16 photographic presets, or upload your own image (up to 5 MB). The photographic presets are grouped by theme (Forest & Nature, Mountains, Caves & Grottos, Magic & Portals, Temples & Halls) in a thumbnail grid; the full image loads only when the preset is in use. Each has a translated name. Removing a custom image or a gradient falls back to the first photographic preset. Altars from older versions keep their original colour background.

**Overlay Options.** In edit mode, the "Overlay Options" section (between Background and Grid Options) has an opacity slider (0–100%, default 20%) and a Dark/Light toggle for the overlay's colour (dark by default). The overlay sits on top of every kind of background.

**View mode and full-window mode.** Full-window mode is available only in view mode: entering edit mode, leaving the altar, or pressing **Escape** ends it — the dashboard never opens in it. The fullscreen toggle sits in the sidebar's action bar while the sidebar is open; otherwise it floats over the canvas. While full-window mode is on, its exit button is always visible.

## Navigation

**Loading screen.** On startup, before the app is ready, a loading screen covers the window: a breathing emerald gem with twinkling facets, the wordmark and a progress rail, on the app's own dark background. It fades as soon as your vault's data (or, on a new install, vault setup) is ready, however fast that is. **View → Show Loading Screen** replays it; a click or Escape closes it.

**Window title bar and frame.** The app draws its own title bar: the Emerald logo (decoration, centred above the rail), on Windows and Linux one menu button holding the Edit and View menus, a magnifier for [Search](#search) (hidden while no vault is open), back/forward through the view history, on Windows and Linux an Export and an Import menu button, the open tabs, and — on Windows and Linux — the minimise / maximise / close buttons. macOS keeps its native window buttons and menu bar, so its title bar shows only the logo, search and navigation. The minimum window width is 720px.

The title bar, the rail and the left entry list share one plain background with no dividers, framing the window; the main content and the right sidebar form a rounded surface on top of it, so an entry's content and its properties read as one while the navigation stays in the background.

**Left sidebar structure.** The left sidebar has two parts side by side:

1. A narrow icon **rail**: Home, Journal, Tasks, Operations, Wiki, Lexicon and Altar at the top; at the bottom, Templates, Blocks, Categories, Tags and Trash, then Vault and Settings. Clicking a navigation icon switches the main view of the active tab — it never opens a new tab. The open view's icon is highlighted (also while an entry inside it is open). The Vault button opens [vault management](#vaults).
2. A resizable, collapsible **entry list** showing either every module's items together (**All**, by last change) or one module's own — chosen in Settings → Sidebar. It has its own search, inline rename (from the context menu, starting from the stored title) and a context menu (Open in new tab/Duplicate/Rename/Delete where they apply — Altar offers Open in new tab, Rename and Delete, duplicating an altar lives in the dashboard's card menu; Tasks offers Rename/Delete). Task rows show a completion checkbox (in the All list a static checkbox icon). Every row can be dragged into an editor to insert an internal link — Tasks and Altars included. The list caps how many entries it shows (Settings → Sidebar: 10/25/50/100 or all); a "Show more" row reveals the next batch. With "all" it fills in as you scroll, so a vault with thousands of entries opens it at once. Creating items happens in each module's own dashboard.

The rail has no toggle buttons: **View → Entry List** and **View → Properties** collapse and expand the two sidebars (with a checkmark for their state), animating their width. **View → Reset View** restores the sidebar widths and the altar library height, ends the altar's full-window mode, and brings back a hidden rail, entry list or right sidebar — without the rail, Settings and the Vault button would be out of reach. **View → Lock View** (with a checkmark while on) fixes the widths of the entry list and the right sidebar: their edges can no longer be dragged. Hiding and showing the sidebars and Reset View keep working, and the lock survives a restart.

**Back link above the title.** An open Journal entry, Wiki article or Operation shows a small row above the title: a chevron and the module's name, which goes back to its list without closing the tab, and on the right the entry's date — replaced by "Editing…" while you edit or have unsaved changes. The Altar and library pages (a block, a template, a language) show the same row.

**Right sidebar action bar.** Edit, Done, Delete and Cancel for an open Journal entry, Wiki article, Operation or Altar sit in one action bar pinned above the Properties panel — not in the entry's header, and not on double-click. In view mode it shows Edit; while editing, Done, Delete (where it applies) and Cancel. An entry whose loaded sigil locks the whole entry keeps Edit visible but disabled, with a tooltip saying the sigil has to be unloaded first.

**Cancel.** Cancel restores the entry as it was when editing began — title, body, tags, category, icon and cover image — even if autosave or the Properties panel already wrote in-between changes to disk. That includes a change of type made while editing: Cancel moves the entry back into the module it came from, with its old number (unless another entry has taken it since) and with the category, icon and cover image a move to the Journal had dropped. Looking into another tab meanwhile doesn't change that. Restarting the app keeps what you typed — and a changed type — and starts a new edit from there.

If the entry was just created and never confirmed with Done, Cancel moves it to the Trash with the same undo toast as Delete. A new template or block behaves the same ("New template"/"New block", then Cancel), and so does a task that was just created and never named (Escape in its title field).

**Leaving an edit.** An edit ends with Done or Cancel. Leaving a changed entry any other way — clicking elsewhere in the same tab, Back/Forward, closing its tab, switching vaults, restoring a backup, installing an update, closing the window — asks what to do with the changes:

- **Save** (like Done), **Discard** (like Cancel — a brand-new entry goes to the Trash), or **Keep editing**. Escape, the X and a click beside the dialog mean Keep editing.
- Switching to another tab does not ask — the edit simply continues there. Closing a background tab with changes brings it to the front first, so you see what the question is about.
- Without changes, nothing asks.
- If the question came from the Settings or Vaults window (an import, an update, a vault switch), **Keep editing** closes that window too.

The same applies to an altar and to the page of one of your own blocks or a template.

An **altar** saves every canvas action the moment it happens, so its Cancel puts it back as it was when Edit was pressed — placements, background, overlay, grid, format, icon and title, along with its preview and its place in the list. A change to a library item is not taken back, since items belong to every altar.

**List header, split between the main area and the sidebar.** While a list view is showing — Home, Journal, Wiki, Operations, Tasks, the Altar dashboard, Trash, Categories, Tags, or the Blocks, Templates and Lexicon lists — its title and search sit above the list in the main area. Everything else lives in the right sidebar while it is open: the view's actions (a labelled "+ New …" button — on the Altar with an "add item" button beside it; Trash shows select-all and bulk delete instead), then view and sort as two rows of icon toggles, then the always-visible filter panel. Closing the sidebar hides those parts and gives the list the width back.

**Internal link chips.** Links inserted with `[[` render as chips in both edit and view mode. A link can point at a Journal entry, Wiki article, Operation, Task or Altar — offered by the `[[` popup, the link picker (the toolbar's link button), and by dragging a row from the left entry list. Only Journal, Wiki and Operations can hold links; Tasks and Altars have no editor. Clicking a Task chip opens the Tasks view and highlights the task; clicking an Altar chip opens the altar. The link picker's tabs (All/Journal/Tasks/Operations/Wiki/Altar) are icons in the rail's order, each with its match count.

## Search

The magnifier in the title bar opens the search: one field, results beneath it, over everything in the current vault. Matches come from Journal, Wiki, Operations, Tasks, Altars, altar library items, tags, categories, and the Lexicon's languages and words. A title match ranks above a tag match, which ranks above a match in body text; ties go to whatever was updated more recently. Body-text matches start at two typed characters, so a single letter doesn't return most of the vault.

Each result shows its module and, for Journal/Wiki/Operations, its entry number (e.g. `#12`). A body-text match shows a snippet with the word highlighted. A category result names the module that uses it most (e.g. "Category · Wiki") — a hint, not the destination: it opens the Categories view. A word shows as "term – translation" and opens its language. An untitled entry is found by its "Untitled …" name.

50 results show at once. Results are ranked as one list across all modules before being cut into pages; a "Show more" row (or Arrow Down on the last result) reveals the next 50. Once everything shows, Arrow Down wraps back to the top.

Keyboard: Up/Down moves the highlight without leaving the field, Enter opens, Ctrl/Cmd+Enter opens in a new tab, Escape closes (the × in the field clears just the text).

Journal entries, Wiki articles, Operations and Altars open directly. Tasks and tags have no page of their own: opening one goes to the Tasks or Tags list, scrolls the row into view and marks it for as long as it is the row you navigated to. Opening a task also clears any search, filter or collapsed category that would hide it, and expands its parent tasks if it is a subtask. An altar library item opens the Altar dashboard.

There is no keyboard shortcut to open the search. Templates and your own blocks are not searched — they are libraries you insert from, not entries you open.

## Tabs & Workspace

Emerald has browser-like tabs, so you can keep several things open at once — for example writing a journal entry while referencing a wiki article and an active operation. You can:

- Open entries, altars and any other view in tabs, and switch between them.
- Close tabs individually, or with a middle-click on the tab.
- Drag tabs left/right to reorder them.
- Scroll the mouse wheel over the tab bar once more tabs are open than fit.
- Open an entry in a new tab with middle-click.
- Create a new empty tab from the tab bar.
- Reopen the app and continue with the same tabs in the same order.
- Use Back/Forward per tab — every tab has its own history.

Opening an item in a new tab (middle-click, "Open in new tab", Ctrl/Cmd+Enter in the search) always makes a new tab, even if the item is open elsewhere.

**What Emerald remembers.** Two kinds of things, with one rule each:

- **Preferences stay, per vault** — how each list looks (view, sort, grouping), the Home sections, which groups and sections are collapsed, the Altar preview and library order, Tasks' "Show completed". A vault opened for the first time starts from the defaults.
- **Working state lasts for the session** — searches, filters and the Trash selection. Switching to another module and back finds them as you left them; a restart, a vault switch or restoring a backup starts clean.

The window layout — open tabs, which sidebars are open, their widths — belongs to the app rather than to a vault; settings live in the vault (see [Settings](#settings)).

## Templates

A template is a pre-filled starting point for a Journal entry, Wiki article or Operation: an optional title, a block stack — the same content an entry has — and tags. The **Templates** button sits in the left rail next to Blocks. The dashboard lists templates under a collapsible "Templates" heading with its own view (List, Cards, Cards (full width), or Timeline by month) and sort (date or A–Z); each row or card shows the icon, name, "Unsaved" while a draft is open, and the entry count.

Clicking one opens its page — name as the title, the title new entries get, and the block stack — which works like a block's own page (see "Your own blocks" under [Journal](#journal)): edits are a draft until Done, leaving with changes asks first, and an unfinished page in another tab shows "Unsaved" in the list.

**Assignment and default** decide where a template shows up and which one a new entry starts with.

- The template's sidebar has an "Assignment" property. Its value button reads "Everywhere" (nothing assigned — offered everywhere), the one combination it holds (a type — Journal, Wiki or Operations — and for Wiki/Operations a category or "All categories", with a star if it is the default), or the number of assignments, listed in its tooltip.
- With nothing assigned the button opens the dialog straight away; otherwise a small menu offers **Assign** and **Clear**.
- The dialog is one table: Journal as its own row, then Wiki and Operations as columns against "All categories", "Uncategorized" and every category. Each cell cycles **not assigned**, **offered** (available when inserting), and **default** (what a matching new entry starts with); a "Both" column sets a category for Wiki and Operations at once.
- A cell about to become the default says "Replaces “…”", naming the current holder ("Default: …" on the others); the star changes hands only with **Apply**. Apply changes the page's draft only if something changed; the page still saves with Done.
- A collapsible, read-only "Defaults" section under the template list mirrors the table: each cell names its default (star) and what else is offered (check), links to the template, and shows the fallback where a category has no default of its own, or "—".

**Defaults apply when an entry is created.** A new entry starts with its combination's default: the exact category's first, then "All categories" for that type, or nothing. A notice above the block stack — Undo, or "Other template" — appears whenever a default just filled a new entry. The built-in template `core-sigil` (calculator, drawing, charge) is the default for Operations × Sigils; it can be edited, reassigned or deleted like any other. Changing an entry's category or type later never touches its content. Settings → Entries → **Default template** turns the automatic part off: new entries then start empty and offer the matching templates as buttons.

**Inserting one by hand.** "Insert template" in the blocks sidebar opens a searchable list. Picking one into an entry with content asks whether to append its blocks or replace everything, and whether to bring its title and tags along; an empty entry lists matching templates as buttons instead. Every entry's context menu offers **"Save as template"**, which creates one from the entry's current content (unsaved edits included) and opens it. A block a template inserts remembers where it came from, which is how the dashboard counts a template's entries.

**Duplicate** on a template makes an independent copy without the original's stars, so it doesn't compete with itself for a default.

Deleting a template moves it to the Trash with an Undo toast; nothing it already inserted is affected, since insertion always makes a copy. "New template" followed by Cancel puts it in the Trash with Undo; after Done it stays.

Routines from older vaults and `.emeralddb` backups are converted into templates on open or import (same content and tags, linked entries as link blocks, offered everywhere).

## Tasks

The Tasks module is a hierarchical task manager with categories, priorities, and links to any entry, task or altar.

**Categories.** Tasks use the shared category list — see [Categories](#categories). None is built in on the Tasks side. Category headers show the emoji, name and a task count.

**Subtasks.** Tasks nest to any depth; subtasks are indented under their parent and can be expanded or collapsed. Completing a parent completes all its subtasks (and vice versa); only the ticked task gets a new "last changed" date. Deleting a parent moves it to the Trash together with all its descendants, as one item: restoring brings the whole branch back with its links, and deleting it for good takes every subtask along. A subtask restored on its own while its parent is still in the Trash comes back as a top-level task.

**Priorities.** Low, Medium or High, shown as a coloured flag (green, yellow, red) and changed from a dropdown on each row.

**Links.** A task can link to journal entries, wiki articles, operations, other tasks and altars — the same link picker the editor uses. Linked entries show as clickable chips on the row. A link whose target was deleted for good reads "Deleted".

**Toolbar.** Search, a sort ("Created · newest/oldest", "Name · A → Z/Z → A") and a separate Grouping switch (by category, or ungrouped). Only the List view is available.

**Filter panel.** A "Display" group holds "Show completed" — a display preference, not a filter: off, it hides completed tasks and subtasks, it doesn't count toward the active-filter badge, and resetting filters leaves it alone. Below it come the category filter (see [Categories](#categories); for tasks the "Uncategorized" row looks at top-level tasks only, since that group lists only those) and a priority filter ("All" plus High/Medium/Low with a count each). Both are multi-select; "All" clears a list, and a "Reset filters" button appears once search and filters leave nothing to show.

**Grouped view.** Tasks sit under collapsible category headers; an "Uncategorized" section collects tasks without a category (including those whose category is in the Trash). It is not a category and can't be deleted. Empty groups are left out.

**Inline editing.** Double-click a title to rename it, starting from the stored title. Enter saves, Escape cancels — on a task just created and never named, Escape puts it in the Trash with Undo.

**Context menu.** Right-click a task to Mark as Completed/Active, Add Subtask, Link Entry, or Delete.

**Trash integration.** Deleted tasks go to the Trash, where they can be restored or removed for good. A task deleted with its subtasks is one item there, its entry links staying with it. A subtask deleted on its own earlier is a separate item, and deleting its parent for good takes it along.

## Categories

One list of categories serves Wiki, Operations, Tasks and Altar items, and the Categories view in the left rail — next to Tags — is the one place it is managed. The four modules only *assign* a category to an entry and group their lists by it; none of them can create, rename or delete one.

A fresh vault starts with eight ordinary categories in the app's language (Paradigm, Ritual, Meditation, Herbs, Crystals, Candles, Deities, Tools) plus the built-in **Sigils**.

Each row shows the category's emoji, its name, and how many entries in each module use it (Tasks, Operations, Wiki, Altar — the rail's order, with the module's icon as the column header). Only live entries count, not the Trash.

From here you can:

- **Add** a category with the header button — pick an emoji, type a name, Enter saves. A name already in use is refused with a message under the field; the name of a category in the Trash brings that one back instead (with the emoji you picked), together with its entries.
- **Rename and change the emoji** inline with the pencil; Enter saves, Escape cancels. The change shows everywhere immediately. Renaming to the name of a category in the Trash merges that one in — its entries and template assignments come along.
- **Delete** without a question, undoable from the toast. A deleted category goes to the Trash; its entries keep pointing at it and appear under "Uncategorized" until it is restored (bringing them back) or deleted for good (leaving them uncategorized). If another category took its name meanwhile, restoring merges the two into the one with the name (a template keeps a default star only where the combination has none yet).
- **Reorder** by dragging a row by its grip. This order is used everywhere — group headers, filter rows, the Altar tab strip, the category picker — and is saved immediately.

**Sigils** is the one built-in: it can't be renamed or deleted, since its name comes from the app's translations, and an operation inside it opens the sigil editor. It can still be dragged. Everything else, including the **Other** that older vaults carry, is an ordinary category. New categories go to the end of the list.

**In the modules.** Entries start with **no category** and stay under "Uncategorized" until you pick one in the properties panel (or the task row); "Uncategorized" is the first entry of every category picker, and choosing it removes an assignment. A category that nothing in a module uses doesn't appear there.

- **Grouping.** The Grouping toggle groups a list by category, independent of the sort order. Each group collapses and expands, and its header has a "+" that creates a new item directly in that category. Empty groups are left out; "Uncategorized" comes last.
- **Filter.** The filter panel lists only the categories that module actually uses — emoji, name and a count of matching items — with an "All" row on top that clears the selection, and an "Uncategorized" row whenever an item has no category (or its category is in the Trash), staying visible while it is selected.

A category found through the global search opens this view and briefly highlights its row.

## Lexicon

The Lexicon is where you keep **languages** — Enochian, runes, a tongue of your own — and translate with them. Everything it knows comes from your own vault; nothing is sent anywhere.

**Dashboard.** The rail's Lexicon button opens the list of your languages on the same dashboard every module uses — icon, name, and how many words and characters each holds — with the usual search, view (List / Cards / Cards in full width / Timeline) and sort in the right sidebar. A row's context menu offers Open in new tab, Duplicate (copying the alphabet and every word) and Delete; deleting moves the language to the Trash with an undo toast, its words travelling with it both ways.

**A language's page.** Clicking a language opens its page: a breadcrumb back to the list, its name as the title, and two sections.

- **Words** — a table of Term, Translation, Pronunciation and Note. "+ Word" adds a row and puts the cursor in it; every field saves when you leave it (Enter does the same), so a long list can be typed straight through. A search field filters the table, and the × removes a row right away with an undo toast — a single word does not go to the Trash.
- **Alphabet** — pairs of characters: yours on the left, the language's on the right. Several letters are allowed on either side ("th" → "ᚦ"), and the longest match wins. A pair with an empty left side is not kept.

The right sidebar holds the language's icon (emoji or image) and its size in words and characters, next to the back and delete buttons.

**Translating.** Under the language list sits the **Translate** section: your text on the left, the translation on the right, updating as you type. Above it you pick the language, swap the direction (into the language or out of it), and choose what it translates from:

- **Words** — the vocabulary only. An unknown word stays as it is, dotted and underlined, with "Not in the lexicon" on hover.
- **Characters** — the alphabet only, character by character.
- **Words, then characters** (the default) — every word is looked up first; only what the vocabulary doesn't know is transliterated.

Multi-word entries match as a phrase ("I am" → ZIRDO), capitalisation carries over (a sentence start stays capitalised, an all-caps word stays all-caps), and punctuation and line breaks stay where they were. A line under the result counts the words and how many were unknown; a Copy button copies the translation.

**Search.** The global search finds languages and single words — see [Search](#search).

**Backups.** Languages and their words travel in `.emeralddb` backups under their own "Lexicon" choice, on export and import.

## Trash

Deleting a journal entry, wiki article, operation, task, altar or altar library item moves it to the Trash rather than removing it. Trashed items are kept for a period set per vault (Settings → Storage — 7/14/30/60/90 days or never; 30 by default) and purged when the vault opens once that period has passed — categories too, whose entries are then left without one. The Trash's "time left" note names that period, or is left out when purging is off.

**Altars go to the Trash like everything else** — from the action bar, the dashboard card's context menu or the left list, with the same undo toast. Its placements stay with it, and restoring brings the arrangement back, except elements whose library item was deleted for good meanwhile. Links pointing at the altar keep pointing at it while it is in the Trash and are removed only when it is deleted for good. A library item in the Trash disappears from every altar and comes back to the same places when restored.

From the Trash view you can:

- **Restore** an item to its original section.
- **Delete permanently** to remove it immediately.
- Select several items and delete the selection.
- Empty the entire Trash at once (with confirmation).

Tags, categories, your own blocks, templates and the Lexicon's languages also go to the Trash and can be restored; a language brings its words back with it, and deleted for good takes them along. Trashed wiki articles and operations without a category are grouped under "Uncategorized". Only the latest deletion can be undone from the toast — a new one replaces the previous Undo; older items are restored from the Trash.

## Vaults

A vault is a **folder** you choose, holding its own encrypted database and its own images — see [Vault Layout](architecture/storage.md#vault-layout) for the on-disk layout and [Vault Encryption](#vault-encryption) for the password. Because nothing inside it refers to a location, a vault folder can be copied to another machine and opened there. A vault can carry its own icon — any emoji, shown on its card and on the Vault rail button while it is active; without one, both show the plain vault glyph.

**First start.** A new installation has no vault. Emerald opens straight into the vault modal below — with no way to close it — until you create or open one. An installation from before multi-vault support has its existing database adopted as a vault named "Emerald".

Vault management lives in its own modal, opened from the Vault icon in the left rail (above Settings):

- Each vault is a card with its name and folder. Clicking a card switches to that vault; the active vault's card is disabled and highlighted.
- **New Vault** creates an empty one. Give it a name and optionally an icon; the row shows live where it will land — by default `Documents/Emerald Vaults/{name}`, with a folder picker to choose elsewhere and a reset button. The target folder has to be empty: sharing it with unrelated files would make deleting them ambiguous later. Opening the new vault asks for its password.
- **Open vault** adds a vault that already exists on disk: pick its `emerald.db` file (not the folder — a folder dialog can't show whether one is there), and it joins the list under its folder's name. This is how you take over a vault from another machine or re-add one you removed.
- **Edit** and **Delete** are inline states on the card. Edit changes name and icon together. Delete asks for confirmation and offers **"Delete the files as well"** (off by default, showing the folder). It removes the vault's own files — database, its journal, images, the key file, and an empty `backup/` — but leaves anything else (an exported backup, a stray system file) and with it the folder; the modal then says so, making clear the database is gone either way. A folder that stayed can't host a *new* vault until it is emptied. Any vault can be deleted, including the active one (Emerald switches to another) and the last one (back to vault setup).
- A vault whose folder moved or is on a disconnected drive is marked **Folder not found** and can't be switched to; a folder button lets you point it at the new location (again via its `emerald.db`). Emerald deliberately doesn't recreate a missing folder — SQLite would put a fresh, empty database in it, and the vault would come back looking empty instead of telling you something is wrong.
- A vault Emerald is not *allowed* to read is marked **No access** and gets no relocate button — the folder is where you left it. On macOS this is what `~/Documents`, `~/Desktop` and iCloud folders look like until you grant access in System Settings › Privacy & Security; picking the `.db` file in the open dialog does not grant it.
- A vault in iCloud Drive, Dropbox or OneDrive works, but SQLite in a synchronised folder can be damaged if the sync client touches the file mid-write.

New vaults are not switched to automatically — except during first-start setup, where the first one becomes active. Importing a `.emeralddb` backup in Add Vault mode also creates a vault, filled from the backup — see [Vault Backup](#vault-backup-emeralddb).

## Vault Encryption

Every vault is encrypted: entries, images, drafts and backups are unreadable without the vault's password. Someone who gets hold of the vault folder — a lost laptop, a cloud folder, a copied backup drive — sees nothing of your practice. Settings (theme, fonts, limits) are the one thing left readable; they hold no content.

**A new vault** asks for a password (at least eight characters, entered twice) before it opens, and then shows its **recovery key**. The recovery key is the only way back in if the password is forgotten. It is shown once; write it down or keep it in a password manager — not inside the vault itself — and tick the box that says it is stored before continuing.

**An existing vault from before encryption** is encrypted the first time it opens: Emerald asks for a password, builds an encrypted copy, checks it, and only then replaces the original. A vault is never opened unencrypted. Depending on its size this takes a moment; a progress bar in the dialog shows how far it is, and if the volume does not have enough free space for the copy, Emerald says how much is needed and how much is free before it writes anything. An interruption — a crash, a power cut — leaves the vault usable and finishes or discards the work on the next start. Old plain backups inside the vault's `backup/` folder are encrypted along with it; the original files are deleted.

**Unlocking.** Opening or switching to a vault asks for its password. Leaving a vault locks it. If you forgot the password, **Forgot your password?** takes the recovery key and a new password, and gives you a new recovery key; the old one stops working.

**Remember on this device** (a switch in the password dialog and in Settings → Security) keeps the vault's key in the operating system's keychain, so the vault opens without a password on this computer. The files in the vault folder stay encrypted either way. The switch is missing where the system has no keychain.

**Settings → Security** covers three things for the open vault:

- **Remember on this device** — on or off.
- **Lock now** — closes the vault and asks for the password again, even if it is remembered. While the password is asked, no content stays on screen.
- **Change password** — enter the current password and a new one. The vault is re-encrypted under a new key (with a progress bar and the same free-space check as the first encryption) and you get a new recovery key. Open tabs close, and the window stays open until the new recovery key is confirmed. Backups made earlier still open with the password they were made with.

**What encryption does not do.**

- While a vault is unlocked, its content is in the computer's memory. Encryption protects a vault at rest, not a running session.
- Files that already left the vault stay as they are: backups exported before encryption and kept elsewhere, Markdown, PDF and `.emerald` exports, and old versions kept by a cloud service. Deleted files can sometimes be recovered from an SSD — only an encrypted disk (BitLocker, FileVault) closes that gap.
- The password cannot be recovered. Without the password and the recovery key, the vault is gone.

## Export and Import

All export and import actions are in the application menu — on macOS the native menu bar, on Windows and Linux the app's own title bar, with the same items and rules. The menu stays available in the altar's full-window mode, where image export is most often wanted.

> **Exports show an entry the way read mode does.** Markdown and PDF render each block on its own: hidden blocks are left out, field blocks list only the fields read mode shows (label and value), block titles appear as headings where read mode shows them, and a sigil exports its intention and letters, its drawing (in Markdown a placeholder) and its charge. While a sigil is charged and its reveal date not reached, calculator and drawing are left out of every export, `.emerald` included. Import is unaffected.

### PDF Export

A native save dialog asks for the destination and the PDF is written directly — no preview and no print dialog. It is rendered by the app's own webview, so emoji come out as proper colour glyphs. The suggested filename is `<Title>_YYYY-MM-DD.pdf`. Images are embedded; internal link chips appear as styled text.

**Export → Export as PDF…** is available while a Journal / Wiki / Operations entry is open, or an Altar in **reading view** (not while editing it); it is disabled elsewhere (Home, Tags, Trash …). For an altar it exports the rendered altar instead (see below).

### Altar PDF Export

With an altar open in reading view, **Export → Export as PDF…** renders it like the image export (full native resolution) and places it on a single PDF page. The page follows the altar's proportions — long edge 11", so a portrait altar gives a portrait page and a landscape altar a landscape page. This custom page size works on Windows; on macOS and Linux the PDF uses the platform's default page size. A dialog shows the saved path afterwards.

### Altar Image Export

**Export → Export as Image → JPEG… / PNG… / WebP…** renders the open altar at full native resolution into a file chosen in a native save dialog (suggested name `AltarTitle_YYYY-MM-DD.<ext>`). JPEG and WebP use high quality settings, PNG is lossless. It is enabled only while an altar is open in **reading view**; a dialog shows the saved path afterwards.

### Markdown Export

Saves a `.md` file: the `# Title`, a header with type, date, moon phase (when shown), category and tags, then `---` and the entry body. Images are left out; a block image (the sigil drawing, an image field) leaves its label as a placeholder, `*[Label]*`. Internal link chips become `[[Title]]` wiki links — an entry's links live in its body.

### Emerald Format

The Emerald format (`.emerald`) is a JSON file holding a full entry — or a full altar — with all metadata and embedded images, for lossless transfer between Emerald installations. **Export → Export as Emerald…** is enabled while a Journal / Wiki / Operations entry or a template's page is open, or an Altar in reading view, and exports whichever is active. **Import → From Emerald…** handles every type; the type is read from the file.

```json
{
  "version": "1",
  "type": "journal | wiki | operations | altar",
  "title": "…",
  "createdAt": "ISO 8601",
  "content": "HTML string (empty for altars)",
  "images": { "/absolute/path/to/image.png": "data:image/png;base64,…" },
  "meta": { … }
}
```

**Entries.** On import, images are saved into the vault's image folder (an identical image is stored once) and go through the vault's image limits like inserted ones (an image that stays too large, or can't be scaled, is kept as it is). The content is sanitised, links are resolved by id and then by title, and tags are added to the vault. An entry or altar keeps the file's `createdAt` as both creation and "last changed" date, so it lands at its place in the timeline — provided it is a readable date with a four-digit year; otherwise it is created now. Old English default titles import as empty, and fields this version doesn't use are ignored.

**Your own blocks.** An entry holding copies of Blocks-view blocks is written as `"version": "2"`, carrying those blocks in `meta.blockDefinitions`; everything else stays `"1"`, so older app versions keep accepting it. Import creates any missing block under its original id, so the copies are recognised and can be updated; an existing one (even in the Trash) is left as it is.

**Templates** export from their page or the templates list's context menu as `"version": "3"`, `"type": "template"` — a combination used only for templates, so an older app rejects the file instead of mistaking it for an operation. It carries the template's blocks, images and Blocks-view blocks like an entry, plus its icon, the title new entries get, its tags and its assignments. A built-in category in an assignment travels by id (its name depends on the language); any other by name and emoji, created on import if nothing matches (at most 20 new categories per file, so a crafted file can't flood the list). Which template is a *default* never travels — importing never displaces a default the vault already has.

**Altars.** The file carries background, overlay, grid and snapping settings, format, icon, thumbnail, the categories of the placed items (name and emoji), and every placed item with its name, emoji, category, note, image and placement (position, size, rotation, opacity, layer, locked/hidden). An imported background goes through the same 5 MB limit as an uploaded one. Import creates a new altar:

- Categories not present locally (matched by name, ignoring case) are created first, so items land in the right category.
- Items are matched against the library by name, category and image, reusing an existing item where possible — so re-importing a file, or importing into a vault that already has the same items, doesn't pile up duplicates, while items that only share a name but differ in artwork stay separate.
- If the import fails partway, the new altar and any newly created items are rolled back, leaving no orphans in the library.

### Import from Markdown

Reads a Markdown file exported by Emerald (or with the same structure). The `# Title` line becomes the title, key-value lines before `---` are metadata (unknown keys are ignored), and the body below is converted to rich text. A Markdown import has no creation date and is created now. Older files that carry an operation's status, end date and version, or a journal entry's paradigm/banishing/meditation and linked operations/articles, in the header have them turned into the matching block or link blocks.

**Destination confirmation.** The header's `type` decides where the entry goes. If it is `journal`, `wiki` or `operations`, the import proceeds directly; otherwise (Altar is not a valid destination) a dialog shows the detected title and asks for Journal, Wiki or Operations — cancelling aborts the import. `.emerald` files always carry a type, so they never ask.

### Vault Backup (`.emeralddb`)

The whole vault can be backed up and restored as one self-contained file (`.emeralddb`), separate from per-entry exports. The Backup page in **Settings** offers two flows.

**Export.**

- A "What to include" chip row picks the content: Journal, Wiki, Operations, Altars, Tasks, Tags, Lexicon and Settings. Templates and your own blocks travel whenever Journal, Wiki or Operations is included.
- The Settings chip (on by default) exports the vault's settings — language, theme, fonts, sizes, trash retention, sidebar, emoji defaults, image limits, tag rule, template rule — independently of the content chips.
- Optional from/to dates restrict entries to those created in that window (tags, categories, blocks, templates, languages and settings are not date-filtered).
- Trashed items are left out unless **Include deleted** is ticked — tags included, since trashed entries carry their ids.
- Images referenced by exported entries are embedded.
- A backup is **encrypted**. It opens with the password the vault has now — also on another computer, and also after the password is changed later: a backup is tied to the password it was made with, not to the current one.
- The save dialog opens in the vault's own **`backup/` folder** (recreated if it went missing), so backups travel with the vault folder — deleting the vault's files leaves a non-empty `backup/` standing. Any other location can be picked; for a vault outside the allowed storage locations (see [`security.md`](security.md)) the dialog just suggests a filename. Cancelling the dialog reports nothing.

**Import.**

- Choosing a backup first opens it. If it belongs to a vault that is unlocked right now, that is automatic. Otherwise Emerald asks for the password the backup was made with, or its recovery key from that time, and asks again after a wrong answer. Backups from before encryption are plain files and open without a question.
- A preview line counts the file's contents per type (templates include an older file's routines, which convert into templates). The same chip row picks what to apply.
- Three modes, from least to most invasive: **Add Vault** (into a new vault, then switch to it — the default, since it can't touch existing data), **Merge** (imported items get new ids, so nothing existing is overwritten), and **Replace** (overwrite the selected content in the current vault, with a warning).
- Add Vault asks for the new vault's name **and folder**, with the same folder row as creating a vault (default `Documents/Emerald Vaults/{name}`). The folder is checked before anything is touched: it must be empty or not exist yet, must not hold a vault, and must be readable. The new vault then asks for its own password; cancelling that cancels the import and removes the empty vault.
- A failed import — a corrupt file, a crash partway — leaves the vault exactly as it was: every mode fills a hidden copy of the database and swaps it in only once the import succeeded.
- If the file carries settings, Add Vault and Replace apply them; Merge lists them as checkboxes (appearance, trash, sidebar, emoji, images, tag rule, templates) so only the ticked groups come in.

For the file structure and per-mode semantics, see [DB Backup / Restore (`.emeralddb`) in `database.md`](database.md#db-backup--restore-emeralddb).

## Image Storage and Cleanup

Images are written into the vault's own `images/` folder, named after a hash of their content, so the same picture added twice is stored once. Entries refer to them by filename alone, which keeps a vault folder portable.

Nothing deletes an image automatically. **Settings → Storage → Unused images** scans on demand: *Scan* reports how many images nothing points at and how much space they take, *Remove* deletes exactly those. It is manual on purpose — an image just inserted but not yet saved would otherwise look unused.

A vault from before per-vault image folders has its images copied into its own folder the first time it is opened. The cleanup never deletes from the old shared pool, since a vault not yet opened may still read from it.

## Image Upload Validation

Every image upload accepts only **PNG**, **JPEG**, **GIF**, **WebP** and **SVG**; anything else is rejected before processing. This covers altar backgrounds, icons and library item images; icons and cover images of articles and operations; template and block icons; and images inserted into the editor via the toolbar, paste, or drag-and-drop from the file manager. Icons (of entries, templates, blocks and altars) refuse SVG on top of that.

A rejected file from a file picker shows an inline error near the control, cleared after 2.5 seconds. When every file dragged into the editor has an unsupported format, a dialog lists the allowed formats instead of silently ignoring the drop.

**Size limits.** Settings → Entries sets a per-vault maximum edge length (1024–3840px, or original) and file size (1–20 MB, or unlimited) for inserted images. Every insert path — paste, drag-and-drop, the toolbar, a field block's image — applies them the same way: the image is scaled down to the edge limit first (GIF and SVG are left alone, since scaling would lose the animation or the vectors), then checked against the size limit; one still too large is rejected with a notice naming the limit. The same notice covers unsupported formats where an insert path has no message line of its own.

## Context Menus

Right-click any entry in the left sidebar or in any list view (List, Cards, Cards in full width, Timeline) for three core actions — most menus add **Open in new tab**:

**Duplicate.** Creates a copy with " (Copy)" appended to the title ("Untitled Entry (Copy)" for an untitled one) and opens it. Every content field is copied, blocks included — a charged sigil stays charged in the copy.

**Rename.** Edits the title inline in the list item, starting from the stored title. Enter or clicking away saves; Escape cancels; an empty name changes nothing.

**Delete.** Moves the entry to the Trash and shows a 5-second undo toast in the bottom-right corner. If the entry is open, the view navigates away.

**Text editing context menu.** Right-clicking an input, textarea or other editable field offers Cut, Copy, Paste and Select all; right-clicking selected read-only text offers Copy. This replaces the webview's native menu everywhere except the rich-text editor, which keeps the native one for its spell-check suggestions. The commands are the same as in the title bar's Edit menu.

## Settings

Settings are **per vault** — stored in the vault's own `settings.json`. Switching vaults switches the whole configuration, and a vault folder copied to another machine keeps its settings; a new vault starts with the defaults. The window has eight pages:

- **General** — language, theme, the two fonts, interface size and editor text size (see [Language](#language), [Typography](#typography), [Sizing](#sizing), [Theming](#theming)).
- **Sidebar** — which list the left entry list shows (all items together, or one module's own), and how many entries it lists before "Show more".
- **Entries** — the emoji picker's default set, size limits for inserted images, whether new tags may appear on the spot (typed, from a template, from an import), whether a new entry starts with its default template, **Automatic formatting** (Markdown shortcuts such as `# ` or `**bold**`; typography such as curly quotes, dashes, arrows and fractions; auto-links for typed or pasted addresses — each its own switch, applying to editors opened afterwards), and whether journal entries show their **moon phase** (see [Journal](#journal)).
- **Security** — remember on this device, lock now, change password (see [Vault Encryption](#vault-encryption)).
- **Backup** — see [Vault Backup](#vault-backup-emeralddb).
- **Storage** — how long the Trash keeps deleted items, and the unused-images cleanup (see [Image Storage and Cleanup](#image-storage-and-cleanup)).
- **Updates** — see [Updates](#updates). The one page that is *not* per vault: the update source and the check on start belong to the installation (see [In-App Updates](security.md#in-app-updates)).
- **About** — version, author, license and links.

Each section has a short description under its heading, and a tooltip where useful.

## Updates

**Settings → Updates** shows the installed version, checks for a new one, and installs it. A check ends in one of three states: a newer version is offered, Emerald is up to date, or the source could not be reached. A source that *answers* without offering anything — including a 404, which every source returns until a release carries a manifest — counts as up to date; only a request that doesn't get through reports as unreachable. Technical error text goes to the console, not the window.

Finding an update downloads nothing by itself: the version, its changelog section and a **Download and install** button appear, with a progress bar during the download, and the app restarts into the new version. Vault data is untouched — an update replaces the application, not its content.

With **Check for updates on start** on (the default), the app checks once per launch. A find only shows a small dot on the gear in the left rail; clicking it opens Settings on the Updates page. Nothing opens or installs on its own.

**Update source** is a free-text address field. Empty — the normal state — uses the built-in addresses: `the-emerald-app.de` first, the GitHub release manifest as a fallback. It exists so a moved address can be fixed without a new build; the signing key is *not* editable, so a wrong address can only fail to deliver, never deliver something else (see [In-App Updates](security.md#in-app-updates)). Only complete `https` addresses are accepted, and changing the source clears the last result. Ticking **Check for updates on start** saves just that checkbox, leaving an unsaved address in the field as it is; the field's Reset clears it.

A `.deb` install is not offered updates and says so — the new version comes from the website. AppImage, the Windows installer and macOS update in place.

## Language

Settings → General → Language switches the vault's language between English, German, Spanish and French. English is the default and fallback; the other languages load the first time they are selected.

## Typography

Settings → General has two independent font controls:

- **UI font** — the typeface of the application shell, sidebars, settings, lists and all other non-editor UI. Default: **Inter**.
- **Editor body font** — the typeface of the editor body, entry titles, and the read-mode body of journal entries, wiki articles, operations and the altar view. Default: **Lora**.

Both offer the same eight typefaces: Inter, Source Sans 3, Nunito, IBM Plex Sans, Alegreya, Cormorant Garamond, Lora and Merriweather. They ship with the app (Latin and Latin Extended), so they look the same offline and nothing is fetched from the network. Serif fonts fall back to Georgia, sans-serif ones to Segoe UI / system-ui.

There is no separate heading font: headings in the editor and entry titles use the editor body font, sized by heading level.

**Editor text size** — a separate setting (14–22px, default 17px) for text in the editor body and in field values, independent of the interface size.

## Sizing

**Interface size** (Settings → General, 90/100/110/120%, default 100%) scales the whole window as a zoom rather than scaling individual elements, so fixed-width columns and panels grow along with the text instead of the text overflowing them.

## Theming

Emerald ships with two themes, selectable in Settings → General:

- **Emerald Noctis** — dark, with warm stone tones and jade green accents. The default.
- **Emerald Parchment** — light, with warm parchment backgrounds, flat bordered panels and adapted accents.

The whole UI, the Altar included, follows the chosen theme. For how themes are built and how to add one, see [Architecture → Theming System](architecture/appearance.md#theming-system).
