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

**Custom Properties.** You can attach any number of named properties to an entry. Supported types: text, number, date, toggle (boolean with configurable on/off labels), checkbox. Enabling "Show in entry" displays the property as a read-only badge in the entry's read view.

**List views.** The journal list supports three layouts (List, Cards, Timeline) and four sort orders (newest first, oldest first, A→Z, Z→A). A filter panel lets you filter by moon phase and by custom property values. Search filters by title.

**Context menu.** Right-click any entry in the list or sidebar to Duplicate, Rename, or Delete it.

## Wiki

The wiki stores reference articles about anything relevant to your practice: rituals, deities, herbs, symbols, concepts, spells, tools, and more.

**Categories.** Each article belongs to one category. Twelve built-in categories cover the most common types. You can add custom categories from the list view. Category sort groups articles by category with inline category management.

**Icons.** Articles can have a custom icon: either an emoji character or an image. Image icons render only when the icon value is a local-safe source (`/` path), a `data:image/...` URL, or a `blob:` URL. Remote `http://` and `https://` icon URLs are not rendered as images.

**Cover Images.** A banner image displayed at the top of the article in read mode. Stored as a file in the app's image directory.

**Backlinks.** The right sidebar shows every journal entry, wiki article, or operation that links to the current article via an internal link chip.

**Special categories.** `paradigm`, `bannung`, and `meditation` articles are used as the target for the matching journal entry properties. These categories are not shown as generic filter chips in the wiki list.

## Operations

Operations track magical workings: rituals in progress, ongoing practices, servitors, and sigils.

**Categories.** Two built-in categories (Sigils and Servitors) and any number of custom categories you define. Categories have a name and an emoji.

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

**Altar library.** You manage a personal library of items (candles, crystals, herbs, deities, symbols, tools, table objects, and other objects). Each item has a name, an emoji, a category, an optional note, and an optional uploaded image.

Library editing uses a modal flow for **add / edit / delete** actions. In edit mode, the library strip is docked under the canvas, supports resize, and persists height in `localStorage` (`altar-library-height`).

Library tiles use a compact fixed footprint (**70×85 px**) to keep more items visible.

**Placing items.** In edit mode, drag items from the library panel onto the altar canvas. Items can be repositioned by dragging, scaled with a handle, rotated, layered (`z-index`), adjusted for opacity, hidden, and locked.

Locked placements are click-through on the canvas (pointer events disabled), so interactions pass to items behind them.

**Inspector and placement controls.** The right sidebar includes a placed-elements list and an inline inspector rendered directly under the selected row. Inspector fields include `x`, `y`, `scale`, `rotation`, `opacity`, and `z-index`, plus layer ordering controls. The delete button for the selected element is in the inspector header (top-right corner).

**Duplicate.** In edit mode, each placed-element row has a Duplicate button (copy icon). Duplicating a placement creates a copy with identical size, rotation, and opacity, offset +2% in both axes, placed on top of all other elements, unlocked, visible, and immediately selected. The same action is available via right-click on any row.

**Row actions (edit mode).** Each placed-element row shows three icon buttons from left to right: Duplicate, Lock/Unlock, Eye/Hide. Right-clicking a row opens a context menu with "Duplicate" and "Remove" entries (portal-rendered at fixed position, auto-closes on the next click anywhere).

**Selecting elements.** Clicking a row in the placed-elements sidebar highlights the corresponding element on the canvas with a jade border in both view and edit mode. Clicking the same row again deselects it (the inspector closes). Clicking an empty area of the canvas or the sidebar also deselects.

**Sidebar sections.** The altar sidebar groups controls into three collapsible sections — Background, Grid Options, and Placed Elements — each with a chevron toggle. All three default to open. In view mode the background section header reads "Background"; in edit mode it reads "Change Background".

**Canvas resolution.** Each altar stores a native canvas resolution (e.g. `1920x1080`). In edit mode the sidebar shows a collapsible "Canvas Options" section where you can pick a ratio (16:9, 4:3, 3:2, 1:1, 2:3, 9:16) and a size (Small / Medium / Large / Very Large), or enter a fully custom width × height up to 7680×4320. The canvas is displayed at native size and scaled uniformly to fit the viewport via CSS transform. Dashboard preview cards reflect the altar's aspect ratio rather than using a fixed height.

**Grid and snapping.** Each altar stores its own grid configuration: overlay toggle, size (8–128 px), opacity (1–25%), color, snap-to-grid, rotation snap, and scale to grid. Settings are saved immediately to the database and persist per altar, so switching between altars always restores that altar's own grid state. Grid controls are visible only in edit mode.

- *Snap to grid* — moves place items on grid intersections.
- *Snap rotation angle* — when enabled, dragging the rotation handle snaps to a configurable angle step (1–180°, default 15°). When disabled, rotation is free; holding Shift still snaps to 15° steps.
- *Scale to grid* — when enabled, resizing a placement snaps its display size to the nearest multiple of `gridSize × 2`.

**Multiple altars.** You can create several named altars and switch between them. Each altar has its own title, intention text, background, and set of placements.

**Backgrounds.** Four built-in presets (Midnight, Ember, Forest, Moon) and the option to upload a custom background image.

Custom backgrounds are persisted as file-backed image paths (legacy inline data URLs are migrated). Background previews use a cached preview map for reliable rendering.

**Intention.** A text field on each altar records your intention or purpose for that setup.

**View mode and full-window mode.** Full-window altar mode is only available in view mode. Entering edit mode exits full-window mode automatically. Grid controls are edit-only and hidden in read/view mode.

## Navigation

**Left sidebar structure.** The left sidebar is divided into three fixed zones:

1. A non-scrollable nav block at the top containing links to Journal, Tasks, Operations, Wiki, and Altar.
2. A scrollable list of journal entries below the nav block.
3. An icon-only row at the bottom containing Settings (left), Tags (centre), and Trash (right-aligned). These three items show only icons (no labels); hover titles are provided via `title` attributes.

**Breadcrumb back links.** When an entry is open in JournalView, WikiView, or OperationsView, the topbar shows a clickable breadcrumb that navigates back to the corresponding list view (e.g. clicking "Journal" returns to the journal entry list without closing the tab).

**Internal link chips.** Links inserted with `[[` are rendered as styled chips in both edit mode and view mode. There is no raw `[[Label(id)]]` text representation in edit mode.

## Tabs & Workspace

Emerald supports browser-like tabs so you can keep several pieces of content open at the same time.

Tabs can contain journal entries, wiki articles, operations, sigils, and altars. This makes it easier to work across related material without losing your current place — for example, writing a journal entry while referencing a wiki article and an active operation.

You can:

- Open supported items in tabs.
- Switch between tabs without navigating away from your current workspace.
- Close tabs individually.
- Drag tabs left/right to reorder them.
- Open entries, wiki articles, and operations in a new tab with middle-click.
- Close a tab with middle-click on the tab itself.
- Create a new empty tab from the tab bar.
- Reopen the app and continue with the previously open tabs in the same order.

Tab reordering uses Framer Motion's `Reorder.Group` / `Reorder.Item` for drag interactions and animated layout transitions. The resulting order is persisted in `localStorage` as part of the `open-tabs` payload.

If an item is already open, Emerald reuses the existing workspace context instead of forcing you to rebuild your working set from scratch.


## Routines

Routines are reusable content blocks that you can drop into any journal entry.

Each routine has a name, an emoji, plain-text content (Markdown is supported), and optional lists of operations and wiki articles to link.

Dropping a routine into an open entry appends its content as formatted paragraphs and merges its tags, linked operations, and linked wiki articles into the current entry. The drop is triggered from the Routines panel in the right sidebar.

## Tasks

The Tasks module provides a hierarchical task manager with categories, priorities, and cross-references to Journal entries, Wiki articles, and Operations.

**Categories.** A default "Allgemein" category is seeded on first launch. You can create, rename, and delete custom categories from the list view via the pencil button on each category header. Deleting a category moves its tasks to an uncategorized section — they are not lost. Categories show an emoji icon, a name, and a task count badge.

**Subtasks.** Every task can have nested subtasks to any depth. Subtasks are indented under their parent and can be expanded or collapsed. Marking a parent task as completed recursively marks all subtasks as completed (and vice versa). Deleting a parent task also deletes all its descendants.

**Priorities.** Each task has a priority: Low, Medium, or High. The priority is displayed as a colored flag icon (green, yellow, red) and can be changed via a dropdown on each task row.

**Links.** A task can link to Journal entries, Wiki articles, and Operations. Linked entries appear as clickable chips on the task row — clicking navigates to the linked entry.

**Toolbar.** The list supports a search bar, five sort orders (Category, Newest, Oldest, A–Z, Z–A, Priority), and a Show/Hide Completed toggle. Only the List view is available.

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

## Export and Import

All export and import actions are in the native application menu.

### PDF Export

Opens a preview window showing the entry with its metadata formatted as a print document. A "Save as PDF" button triggers the system print dialog where you can choose a file destination. Images in the entry are embedded as base64 before the preview is generated. Internal link chips are rendered as styled spans.

### Markdown Export

Saves a `.md` file with a frontmatter block followed by the entry body. Frontmatter includes date, moon phase, paradigm, banishing, meditation, linked operations, linked wiki articles, category, status, end date, version, tags, and custom properties. Images are stripped (not included). Internal link chips become `[[Title]]` wiki-link syntax. Linked operations and wiki articles include their UUID: `Operations: Title [uuid]`.

### Emerald Format

The Emerald format (`.emerald` file extension) is a JSON file that captures the full entry including all metadata and embedded images. It is designed for lossless transfer between Emerald installations.

The file structure:

```json
{
  "version": "1",
  "type": "journal | wiki | operations",
  "title": "…",
  "createdAt": "ISO 8601",
  "content": "HTML string",
  "images": { "/absolute/path/to/image.png": "data:image/png;base64,…" },
  "meta": { … }
}
```

On import, image data-URLs are re-saved into the local image directory (with SHA-256 deduplication), HTML is sanitised with DOMPurify, and linked entries are resolved by ID first and then by title as a fallback. Tags are synced into the local tags table. Custom properties are recreated in the same order.

### Import from Markdown

Parses a Markdown file exported by Emerald (or following the same structure). The `# Title` line becomes the entry title. Key-value lines before the `---` separator are parsed as metadata. Unrecognised metadata keys become custom text properties. The body below `---` is parsed from Markdown to HTML using `marked`.

Note: this path is parser-based (Markdown -> HTML) and is not identical to Emerald JSON import sanitisation. Metadata rendered into PDF export is escaped before interpolation.

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

Each theme defines a complete set of CSS custom properties (backgrounds, text colours, borders, accents, scrollbar colours, menu styles, danger states, etc.) in separate files under `src/themes/`. Components reference these variables so the entire UI switches consistently. A Tailwind utility bridge in `src/index.css` overrides hardcoded Tailwind colour classes for both themes.

For the token naming strategy, normalization pipeline, and instructions for adding new themes, see [Architecture → Theming System](architecture.md#theming-system).
