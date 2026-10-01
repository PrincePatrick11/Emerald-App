# Templates

## Templates

A **template** (`templates` table, v43, `store/templateStore.ts`) is a pre-filled entry: an
optional title, a block stack in the entry `content` format, tags, and **assignments** — JSON
`TemplateAssignment[]` (`lib/blocks/templates.ts`) of `{ entryType, category, isDefault }`.
`category` is a category id, `null` for "no category", or `'*'` for "all categories" (Journal,
which has no categories, only uses `'*'`). A template with no assignments is offered everywhere.

At most one active template is the default for a given `(entryType, category)`. `templateStore`
enforces that itself (not the database, as with `block_definitions`): it clears the previous
holder's star under one write key (`serialKey('template', '*')`), so a set-default touching two
rows can't interleave with another write. `resolveDefaultTemplate` falls back from the exact
category to `'*'` — one level for Journal, two for Wiki/Operations.

### Insertion is a copy

`instantiateTemplateBlocks` gives every block a fresh id (two insertions in one entry don't
collide), remaps charge targets to the new ids, unloads sigils, and stamps `data-template-origin`
(`BLOCK_ATTR.template`) on each block — the same mechanism as a user-built block's
`data-block-origin`. So `entryBlockSummary` picks up template origins alongside block-copy
origins, and `templateEntries()` (`store/blockCopies.ts`) groups entries by origin for a
template page's usage list.

Changing a template never touches entries it already filled. A template can itself hold block
copies that go stale: `copyUsage()` counts them (`templates`/`outdatedTemplates`), and
`updateAllCopies`/`removeAllCopies` walk templates as a second content source, skipping one whose
page is open or has an unsaved draft (`changedTemplates`/`skippedDrafts` on `CopyRunResult`).

### Defaulting on create

`createEntry` starts from `startOfNewEntry(entryType, categoryId, blank)`, which resolves the
default and returns `{ title, content, tags, templateId }` via `templateStart`. Nothing applies
with `blank` (imports and duplicates, which overwrite content anyway) or when the vault setting
`templates.applyDefault` is off. The Sigils layout is no special case: `core-sigil`
(`SIGIL_TEMPLATE_ID`) is a normal, editable, deletable template seeded as default for
Operations × Sigils.

`useTemplateNoticeStore` holds the "template applied" notice a new entry shows (Undo / "Other
template") — a store because the content stores set it and may not import a component. Taking a
replaced template's title and tags back goes through `fieldsWithTemplate`/`fieldsWithoutTemplate`/
`mayTakeTemplateTitle` (pure, no store reads).

Creation is the only moment a default applies by itself. Changing an entry's category or type
never touches its content: deciding whether content is "still the default" would mean comparing
it with the *current* template, which any template edit silently breaks for older entries.

### Manual insertion

`TemplateInsertion` (blocks sidebar) opens `TemplatePickerModal` (name search, ordered by
`templatesFor` — assigned templates first). For a non-empty entry, `TemplateApplyDialog` then
asks append or replace and whether to take title/tags; an empty entry just inserts.

`store/templateApply.ts` is the seam between the block stack (which inserts the blocks itself,
`BlockStackApi.applyTemplate`) and the rest: it flushes the editor's pending saves first, so a
title typed a moment ago isn't clobbered, then applies title/tags through the entry's store.

`useSaveAsTemplateAction` is the reverse: "Save as template" creates a template from an entry's
current (live, if being edited) content and opens it.

### The dashboard and the template page

`TemplatesView` is a `Dashboard` of active templates under a collapsible `GroupDivider`, with
view and sort in `uiStore.templatesPrefs` (a `ListPrefs` field, per vault — see [Tabs and
Workspace State](navigation.md#tabs-and-workspace-state)). A row shows icon, name, an "Unsaved"
marker and the entry count; clicking opens `{ type: 'templates', id }`.

`TemplateEditor` renders that page on `LibraryPageFrame`, the shell it shares with
`BlockDefinitionEditor` (back link, "Unsaved" marker, name-as-title input, `EditActionBar`/
`SidebarColumn` portalled into the right sidebar). Its draft lifecycle is `useDraftPage`:

- The draft lives in a `DraftStore<T>` (`createDraftStore<T>()` in `store/draftStore.ts`, behind
  `useBlockDraftStore` and `useTemplateDraftStore`), so edits survive `MainArea` unmounting the
  view on a module switch.
- "Done" writes only the fields that changed since the page opened (names compared trimmed), so a
  tag renamed or a star taken by another template meanwhile isn't overwritten.

Templates have no description; picker and suggestions match the name only. `useShrunkIcon`
(shrink an image icon to 64px, last write wins) and `TagsField` (the edit-mode "Tags" section)
are shared with the other pages.

### Assignment and default

A combination's `AssignmentState` is `'off' | 'assigned' | 'default'`. In `lib/blocks/templates.ts`,
`assignmentStateAt` reads it, `withAssignmentState` sets it (removing the assignment for `off`,
otherwise updating it in place), and `sameAssignments` compares lists ignoring order, so toggling
a cell off and on again isn't a change.

A default is set only in a template's `TemplateAssignmentsModal`, which edits a copy and calls
`onChange` on "Apply" only if `sameAssignments` reports a change. Each cell is an
`IconToggleGroup` over the three states, with `Star` when another template holds the default
there or this cell would replace it. The "Both" column passes `value={null}` when Wiki and
Operations disagree, so no option shows pressed rather than one side picked arbitrarily. Pending
assignment edits are reconciled with other templates' edits via `mergeAssignmentChanges` (base →
draft, replayed onto current).

`assignmentParts.tsx` holds the modal's `AssignmentTable` plus what modal and overview share
(`AssignmentLegend`, `EntryTypeHeading`, `ASSIGNMENT_STATE_ICONS`, `useAssignmentStateLabels`).
`TemplateAssignments` is the sidebar's read-only "Assignment" property: a value button
("Everywhere", the count, or the single assignment) that opens the modal, with the full list —
`TEMPLATE_ENTRY_TYPES` order, then category order — in its tooltip.

### Defaults overview

`TemplateDefaultsOverview` is the dashboard's read-only view of all assignments, with its own
markup rather than `AssignmentTable`:

- Journal first on its own, as one "Every new entry" row — as a table column it would stand
  almost empty.
- Then a table with Wiki/Operations as columns and one row per "All categories"/
  "Uncategorized"/category. "All categories", every row's fallback, is set off by a bold name
  only (a tinted band was too loud).
- No legend and no star: a cell names its default and, with a subtle check, every template merely
  offered there; a click opens the template. Without a default of its own it shows the fallback
  ("↳ name"), or "—".

### Routines converted to templates

Migration v44 (`migrateRoutinesToTemplates`) turns every row of the old `routines` table into an
unassigned template with the same id, then drops the table (backing up the database first if
there was anything to convert). Markdown is parsed by a dedicated `Marked` renderer with raw HTML
escaped and only `http(s)`/`mailto` links kept; `operation_ids`/`wiki_ids` become link-chip blocks
(`internalLinkBlockHtml`); tags carry over.

A `.emeralddb` below backup version `'8'` with `routines` is converted the same way at import
(`withRoutinesAsTemplates`, `dbBackup.ts`), but only *after* the type and category filters, since
a link target must be in the file or already in the vault to survive. An add-vault import of such
a file keeps the fresh vault's `core-sigil`; a file from `'8'` on that brings templates replaces
it with its own version (or its absence).
