# Templates

## Templates

A **template** (`templates` table, v43, `store/templateStore.ts`) is a pre-filled entry: an
optional title, a block stack in the same `content` format an entry has, tags, and
**assignments** — JSON `TemplateAssignment[]` (`lib/blocks/templates.ts`) of `{ entryType,
category, isDefault }`, where `category` is a category id, `null` for "no category", or `'*'`
for "all categories" (Journal, which has no categories, only ever uses `'*'`). A template with no
assignments is offered everywhere; at most one active template can be the default for a given
`(entryType, category)` combination — `templateStore` enforces that invariant itself (not the
database, the same choice as `block_definitions`), clearing a star from whoever held it before
handing it to someone else, under one write key (`serialKey('template', '*')`) so a set-default
touching two rows can't interleave with another write. `resolveDefaultTemplate` falls back from
the exact category to `'*'` before giving up — one level for Journal, two for Wiki/Operations.

**Insertion is always a copy.** `instantiateTemplateBlocks` gives every block a fresh id (so two
insertions of the same template in one entry don't collide), remaps any charge's targets to the
new ids, unloads any sigil, and stamps `data-template-origin` (`BLOCK_ATTR.template`) on each
block — the same attribute mechanism a user-built block's `data-block-origin` uses, so
`entryBlockSummary`'s existing per-content scan picks up template origins alongside block-copy
origins with one more field, `templateEntries()` (`store/blockCopies.ts`) groups an
`EntryContentRow[]` by origin id for a template page's "Verwendung"/usage list, and
`copyUsage()` now counts a definition's copies inside templates too (`templates`/
`outdatedTemplates` on `CopyUsage`, alongside `entries`/`outdated`) — a template is content that
can go stale exactly like an entry can. Changing a template later never touches entries it
already filled; `updateAllCopies`/`removeAllCopies` (`blockCopies.ts`) walk templates as a
second content source next to the entry store, skipping a template whose own page is
open or has an unsaved draft the same way they skip an entry mid-edit (`CopyRunResult` gained
`changedTemplates`/`skippedDrafts` alongside `skippedEditing`).

**Defaulting on create.** `startOfNewEntry(entryType, categoryId, fallbackTitle, blank)` resolves
the default for the combination (unless `blank`, used by imports and duplicates, which always
overwrite content anyway, or unless the vault's `templates.applyDefault` setting is off) and returns `{ title, content, tags, templateId }` via `templateStart`;
`createEntry` calls it instead of starting from an empty string.
Applying a default this way — rather than the old `defaultBlocksFor`/`lib/blocks/layouts.ts`,
which is gone — is also how the built-in Sigils layout now works: `core-sigil`
(`SIGIL_TEMPLATE_ID`) is a normal, editable, deletable template seeded as the default for
Operations × Sigils, not a hard-wired category special case. `useTemplateNoticeStore` holds the
one "template applied" notice a freshly created entry shows (Undo / "Other template") —
store-level because the content stores set it on create and may not import a component.
Creation is the only moment a default applies by itself. Changing an existing entry's category
or type never touches its content: deciding whether content is "still the old default" would
mean comparing it with the *current* version of that template, which editing the template
silently breaks for every older entry. What "Other template" needs to take a replaced
template's title and tags back lives in `fieldsWithTemplate`/`fieldsWithoutTemplate`/
`mayTakeTemplateTitle` (`lib/blocks/templates.ts`, pure — no store reads).

**Manual insertion, from the editor.** `TemplateInsertion` (blocks sidebar) offers
`TemplatePickerModal` (search over name, ordered by `templatesFor` — assigned to
this combination first) and, once a template is chosen into a non-empty entry,
`TemplateApplyDialog` (append or replace, plus checkboxes for title/tags — skipped for an empty
entry, which just inserts). `store/templateApply.ts` is the seam between the block stack (which
inserts the blocks itself, `BlockStackApi.applyTemplate`) and everything else a template can
carry: it flushes the editor's pending saves first (so a title typed a moment ago isn't clobbered
by the template's own title write), then applies title/tags through the entry's own store.
`useSaveAsTemplateAction` is the reverse direction — "Save as template" on any entry with a block
stack creates one from its current (live, if being edited) content and opens it.

**The dashboard page.** `TemplatesView` is a `Dashboard` list of active templates under a
collapsible "Templates" `GroupDivider` (remembered, like the built-in-blocks section on the Blocks
dashboard), with its own view (list/cards/wide cards/timeline, grouped by month of `updated_at`)
and sort (date/alpha) held in `uiStore.templatesPrefs` — one more `ListPrefs` field, remembered per
vault like the other modules' (see [Tabs and Workspace State](navigation.md#tabs-and-workspace-state)). A row or card shows only icon, name, an "Unsaved" marker for an
open draft, and the entry count — no assignments, no default star, no description; clicking one
opens `{ type: 'templates', id }`, rendered by `TemplateEditor` on
`LibraryPageFrame` — the same "Done"-saves-only-changed-fields page shell `BlockDefinitionEditor`
uses (`src/components/ui/LibraryPageFrame.tsx`, factored out once a second page needed it):
back link, "Unsaved" marker, name-as-title input, scrolling body, and
`EditActionBar`/`SidebarColumn` portalled into the right sidebar. `useDraftPage` is the shell's
shared draft lifecycle (`src/hooks/useDraftPage.ts`, likewise factored out of
`BlockDefinitionEditor`'s hand-written version): it mirrors an open page's draft into a
`DraftStore<T>` (`store/draftStore.ts` — `createDraftStore<T>()` is the one factory behind both
`useBlockDraftStore` and `useTemplateDraftStore`, so a tab's edits survive `MainArea` unmounting
the view on a module switch) and, on "Done", writes only the fields that actually changed since
the page opened (comparing trimmed names) rather than the whole draft — a tag renamed or a star
taken by another template while the page was open is left as it is instead of being silently
overwritten. `TemplateDraft` (`store/draftStore.ts`) omits `description` — the page has no field
for it any more, the `templates.description` column is gone since v54, and `TemplatePickerModal`'s
search and the insertion suggestions match the name only.
`useShrunkIcon` (`src/hooks/useShrunkIcon.ts`) is the shared "shrink an image icon to 64px, last
write wins" logic behind a draft's icon field, used by both pages.

**Assignment and default, as one table.** `assignmentStateAt`/`withAssignmentState`/
`sameAssignments` (`lib/blocks/templates.ts`, pure) replace the former `withDefaultAt`: a
combination's `AssignmentState` is `'off' | 'assigned' | 'default'` rather than a boolean star on
a possibly-missing row, `withAssignmentState` sets a cell to any of the three (removing the
assignment for `off`, adding or updating it otherwise, keeping its position in the array when it
already existed) and `sameAssignments` compares two assignment lists ignoring order, so toggling a
cell off and back on isn't treated as a change. `assignmentParts.tsx` holds the modal's table and
what the modal and the overview share: `AssignmentTable` (the modal's only — Journal as one row
under its own heading, then Wiki/Operations as fixed-width columns with "All
categories"/"Uncategorized"/each category as rows; an optional `extraColumn` for the dialog's
"Both"), `AssignmentLegend`, `EntryTypeHeading`, `ASSIGNMENT_STATE_ICONS` (`Minus`/`Check`/`Star`)
and `useAssignmentStateLabels`. `TemplateAssignmentsModal` edits a copy of
the template's assignments: each cell is an `IconToggleGroup` over the three states — `Star` when
another active template already holds the default there, or when this cell's default would
replace it. `IconToggleGroup.value` now accepts `null`, which the modal's "Both" column uses when
Wiki and Operations disagree, so the segment row shows no option pressed rather than picking one
side arbitrarily. `TemplateAssignments` (the sidebar) shows the current assignments read-only —
sorted the same way the table lists them (`TEMPLATE_ENTRY_TYPES` order, then the categories'
own order) — with a star for a default (which default it replaces is said in the modal), as the "Assignment" property of the Properties section: a value button ("Everywhere" or the
count, or the single assignment itself with a star when it is a default) that opens the modal,
with the full list in its tooltip; the modal's
"Apply" only calls `onChange` when `sameAssignments` says something actually changed, so a
no-op edit leaves the draft untouched. `TemplateDefaultsOverview` is the dashboard's read-only
view of the same assignments, laid out like the modal but with its own markup rather than
`AssignmentTable`: a one-line hint under the section heading, then one `panel` holding Journal on
its own first — its heading and a single "Every new entry" row, since Journal has no categories and
as a table column would stand almost empty (Journal as a third column was tried and dropped) —
then the category table with a "Category" column and Wiki/Operations as columns, one row per "All
categories"/"Uncategorized"/category (a fixed emoji column keeps the names aligned). The headings
carry the module icons (`EntryTypeHeading`); the "All categories" row — every other row's
fallback — is set off by a bold name alone (a tinted band across the panel was tried and dropped
as too loud); it, "Uncategorized" and "Every new entry" carry a muted icon
(`Layers`/`CircleDashed`/`FilePlus`) in the emoji column the category rows fill with their emoji.
There is no legend
and no star: each cell links to the default by name alone and to every template merely offered
there with a subtle check (the tooltip names the state), opening the template on click, plus the fallback
("↳ name", `CornerDownRight`, full text in a tooltip) whenever the combination has no default of
its own — a plain "—" once neither is set. `templateStore.setDefaultFor` is gone along with the
overview's own dropdown; a default is now only ever set through a template's own
`TemplateAssignmentsModal`, and a page's pending assignment edits are still reconciled against
whatever another template's edit did meanwhile via `mergeAssignmentChanges` (base → draft,
replayed onto current) rather than one silently clobbering the other. `FieldDropdown`
(`src/components/ui/FieldDropdown.tsx`) is now used only by `CategorySelect`'s `field` variant;
`TagsField` (`src/components/sidebar/fields/TagsField.tsx`) is the edit-mode "Tags"
section around `TagInput`, shared by Journal/Wiki/Operations' properties panels and the
template page.

**Routines became templates, then were removed.** Routines had no UI path since `RoutinesPanel`
stopped being rendered (see [Module Map](../architecture.md#module-map)) — the store, table and drag channel
(`routineStore.ts`, `routineDragState.ts`, the `LinkedOpsInput`/`LinkedWikiInput` id-array fields
that only the panel used) stayed dead code until this cycle removed them outright. Migration v44
(`migrateRoutinesToTemplates`) turns every row in `routines` into an unassigned template with the
same id — its Markdown content parsed with raw HTML escaped and only `http(s)`/`mailto` links
kept (a dedicated `Marked` renderer, not the trusted insertion path routines used to go through),
its `operation_ids`/`wiki_ids` resolved into the same link-chip blocks `internalLinkBlockHtml`
produces elsewhere, tags carried as-is — then drops the table; a database backup is written first
if there was anything to convert. An older `.emeralddb` (backup version below `'8'`) that still
carries `routines` goes through the same conversion at import time
(`withRoutinesAsTemplates`), but only *after* the type filters run, since a routine's
link target has to either be in the file or already in the target vault to survive; add-vault
import keeps the fresh vault's own `core-sigil` template rather than letting an old file's
version of it (or lack of one) override it.
