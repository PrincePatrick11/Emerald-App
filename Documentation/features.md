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

**Icons.** Articles can have a custom icon — either an emoji character or an image uploaded from your files. The icon appears in list views, in internal link chips, and in journal entry metadata.

**Cover Images.** A banner image displayed at the top of the article in read mode. Stored as a file in the app's image directory.

**Backlinks.** The right sidebar shows every journal entry, wiki article, or operation that links to the current article via an internal link chip.

**Special categories.** `paradigm`, `bannung`, and `meditation` articles are used as the target for the matching journal entry properties. These categories are not shown as generic filter chips in the wiki list.

## Operations

Operations track magical workings: rituals in progress, ongoing practices, servitors, and sigils.

**Categories.** Two built-in categories (Sigils and Servitors) and any number of custom categories you define. Categories have a name and an emoji.

**Active / Inactive.** Each operation can be marked active or inactive. The status badge in the operation's read view is clickable and saves immediately. The filter panel lets you filter the list to active or inactive operations.

**End Date and Version.** Optional fields available for all operations. End date is a calendar date; version is a free-form string (e.g. `1.0`, `draft`).

**Icon and Cover Image.** Same as wiki articles.

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

**Altar library.** You manage a personal library of items (candles, crystals, herbs, deities, symbols, tools, and other objects). Each item has a name, an emoji, a category, an optional note, and an optional uploaded image.

**Placing items.** In edit mode, drag items from the library panel onto the altar canvas. Items can be repositioned by dragging and scaled with a handle.

**Multiple altars.** You can create several named altars and switch between them. Each altar has its own title, intention text, background, and set of placements.

**Backgrounds.** Four built-in presets (Midnight, Ember, Forest, Moon) and the option to upload a custom background image.

**Intention.** A text field on each altar records your intention or purpose for that setup.

## Tabs & Workspace

Emerald supports browser-like tabs so you can keep several pieces of content open at the same time.

Tabs can contain journal entries, wiki articles, operations, sigils, and altars. This makes it easier to work across related material without losing your current place — for example, writing a journal entry while referencing a wiki article and an active operation.

You can:

- Open supported items in tabs.
- Switch between tabs without navigating away from your current workspace.
- Close tabs individually.
- Open entries, wiki articles, and operations in a new tab with middle-click.
- Close a tab with middle-click on the tab itself.
- Create a new empty tab from the tab bar.
- Reopen the app and continue with the previously open tabs.

If an item is already open, Emerald reuses the existing workspace context instead of forcing you to rebuild your working set from scratch.


## Routines

Routines are reusable content blocks that you can drop into any journal entry.

Each routine has a name, an emoji, plain-text content (Markdown is supported), and optional lists of operations and wiki articles to link.

Dropping a routine into an open entry appends its content as formatted paragraphs and merges its tags, linked operations, and linked wiki articles into the current entry. The drop is triggered from the Routines panel in the right sidebar.

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

## Context Menus

Right-click any entry in the left sidebar or in any list view (List, Cards, Timeline layouts) to get a context menu with three actions:

**Duplicate.** Creates a copy of the entry with all fields, appending " (Copy)" to the title. Navigates to the new entry automatically.

**Rename.** Activates an inline text input directly in the list item. Press Enter or click away to save; press Escape to cancel.

**Delete.** Soft-deletes the entry and shows a 5-second undo toast in the bottom-right corner. If the deleted entry is currently open, the view navigates away.
