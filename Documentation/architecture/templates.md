# Templates

## Templates

A **template** (`templates` table, v43, `store/templateStore.ts`) is a pre-filled entry: an optional title, a block stack in the entry `content` format, tags, and **assignments** — JSON `TemplateAssignment[]` (`lib/blocks/templates.ts`) of `{ entryType, category }`. `category` is a category id, `null` for "no category", or `'*'` for "all categories" (Journal, which has no categories, only uses `'*'`).

An assignment means one thing: new entries of this combination start with a copy of the template. At most one active template holds a combination. `assignTemplate` in `templateStore` enforces that itself (not the database, as with `block_definitions`): it takes the combination from its holder under one write key (`serialKey('template', '*')`), so a change touching two rows can't interleave with another write. `resolveAssignedTemplate` falls back from the exact category to `'*'` — one level for Journal, two for Wiki/Operations.

### Insertion is a copy

`instantiateTemplateBlocks` gives every block a fresh id (two insertions in one entry don't collide) and remaps charge targets to the new ids. Everything else comes as it is, a drawn or loaded sigil too. Nothing in the entry remembers the template, and changing a template never touches entries it already filled. The same holds one level down: a block copy in a template stays as it was when the block changes.

### Starting an entry

`createEntry` starts from `startOfNewEntry(entryType, categoryId, blank)`, which resolves the assigned template and returns `{ title, content, tags, templateId }` via `templateStart`. Nothing applies with `blank` (imports and duplicates, which overwrite content anyway). The Sigils layout is no special case: `core-sigil` (`SIGIL_TEMPLATE_ID`) is a normal, editable, deletable template seeded for Operations × Sigils. `createItem` opens the new entry for editing, or for reading if the template's loaded sigil locks the whole entry.

`useTemplateNoticeStore` holds the "template applied" notice a new entry shows (Undo) — a store because the content stores set it and may not import a component. Undoing takes the template's title and tags back through `fieldsWithoutTemplate` (pure, no store reads).

Creation is the only moment an assignment applies by itself. Changing an entry's category or type never touches its content.

### Manual insertion

`TemplateInsertion` (blocks sidebar) opens `TemplatePickerModal` (name search over all templates). The blocks go below the content; an empty stack is replaced.

`store/templateApply.ts` is the seam between the block stack (which inserts the blocks itself, `BlockStackApi.applyTemplate`) and the rest: the stack flushes the editor's pending saves first, so a title typed a moment ago isn't clobbered, then title and tags go through the entry's store (`fieldsWithTemplate`: the template's title if the entry has none of its own, its tags added).

`useSaveAsTemplateAction` is the reverse: "Save as template" creates a template from an entry's current (live, if being edited) content and opens it.

### The dashboard and the template page

`TemplatesView` is a `Dashboard` of active templates under a collapsible `CollapsibleGroupHeader`, with view and sort in `uiStore.templatesPrefs` (a `ListPrefs` field, per vault — see [Tabs and Workspace State](navigation.md#tabs-and-workspace-state)). A row shows icon, name and an "Unsaved" marker; clicking opens `{ type: 'templates', id }`.

`TemplateEditor` renders that page on `LibraryPageFrame`, the shell it shares with `BlockDefinitionEditor` (back link, "Unsaved" marker, name-as-title input, `EditActionBar`/ `SidebarColumn` portalled into the right sidebar). Its draft lifecycle is `useDraftPage`:

- The draft lives in a `DraftStore<T>` (`createDraftStore<T>()` in `store/draftStore.ts`, behind `useBlockDraftStore` and `useTemplateDraftStore`), so edits survive `MainArea` unmounting the view on a module switch.
- "Done" writes only the fields that changed since the page opened (names compared trimmed), so a tag renamed meanwhile isn't overwritten.

Templates have no description; the picker matches the name only. `useShrunkIcon` (shrink an image icon to 64px, last write wins) and `TagsField` (the edit-mode "Tags" section) are shared with the other pages.

### The assignment table

`AssignmentGrid` is the one table assignments are read and set in. `TemplateAssignmentTable` shows it below the list and stays away while there are no templates; `TemplateAssignmentProperty` opens it in a modal from a template's page, where a click toggles that template in a cell. Both apply at once, outside the page's draft.

- Journal first on its own, as one "Every new entry" row — as a table column it would stand almost empty.
- Then a table with Wiki/Operations as columns and one row per "All categories"/ "Uncategorized"/category. "All categories", every row's fallback, is set off by a bold name only (a tinted band was too loud).
- On the dashboard a cell is a `Dropdown` of all templates and "No template"; a choice calls `assignTemplate` and is saved at once. Without a template of its own the cell shows the fallback ("↳ name"), or "—".

### Routines converted to templates

Migration v44 (`migrateRoutinesToTemplates`) turns every row of the old `routines` table into an unassigned template with the same id, then drops the table (backing up the database first if there was anything to convert). Markdown is parsed by a dedicated `Marked` renderer with raw HTML escaped and only `http(s)`/`mailto` links kept; `operation_ids`/`wiki_ids` become link-chip blocks (`internalLinkBlockHtml`); tags carry over.

A `.emeralddb` below backup version `'8'` with `routines` is converted the same way at import (`withRoutinesAsTemplates`, `dbBackup.ts`), but only *after* the type and category filters, since a link target must be in the file or already in the vault to survive. An add-vault import of such a file keeps the fresh vault's `core-sigil`; a file from `'8'` on that brings templates replaces it with its own version (or its absence).
