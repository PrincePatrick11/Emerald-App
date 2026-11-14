# Templates

## Templates

A **template** (`templates` table, `store/templateStore.ts`) is a pre-filled entry: an optional title, a block stack (rows of `blocks` with `template_id` set, like an entry's) and tags.

Which template a new entry starts with is said by its category, not by the template: every category has at most one **start template** (`categories.template_id`), and the vault has one **default template** (setting `templates.defaultTemplateId`, `lib/vaultSettings.ts`) for entries without a category and categories without a start template of their own. `resolveStartTemplate` (`lib/blocks/templates.ts`) takes the category's, else the default — each only while it is active, so a template in the Trash counts as none and its categories fall back to the default meanwhile. Deleting a template for good clears it on its categories (`ON DELETE SET NULL`) and in the setting (`permanentlyDeleteTemplate`). All writes of `templateStore` run under one key (`serialKey('template', '*')`).

### Insertion is a copy

`instantiateTemplateBlocks` gives every block a fresh id (two insertions in one entry don't collide) and remaps charge targets to the new ids. Everything else comes as it is, a drawn or loaded sigil too. Nothing in the entry remembers the template, and changing a template never touches entries it already filled. The same holds one level down: a block copy in a template stays as it was when the block changes.

### Starting an entry

`createEntry` reads the start template of the entry's category from its row and starts from `startOfNewEntry(categoryTemplateId, blank)`, which resolves it with the vault's default and returns `{ title, content, tags, templateId }` via `templateStart`. Nothing applies with `blank` (imports and duplicates, which overwrite content anyway). The Sigils layout is no special case: `core-sigil` (`SIGIL_TEMPLATE_ID`) is a normal, editable, deletable template, seeded as the start template of the category Sigils (and `core-altar` as that of Altars). `createItem` opens the new entry for editing, or for reading if the template's loaded sigil locks the whole entry.

`useTemplateNoticeStore` holds the "template applied" notice a new entry shows (Undo) — a store because the content stores set it and may not import a component. Undoing takes the template's title and tags back through `fieldsWithoutTemplate` (pure, no store reads).

Creation is the only moment a start template applies by itself. Changing an entry's category never touches its content.

### Manual insertion

`TemplateInsertion` (blocks sidebar) opens `TemplatePickerModal` (name search over all templates). The blocks go below the content; an empty stack is replaced.

`store/templateApply.ts` is the seam between the block stack (which inserts the blocks itself, `BlockStackApi.applyTemplate`) and the rest: the stack flushes the editor's pending saves first, so a title typed a moment ago isn't clobbered, then title and tags go through the entry's store (`fieldsWithTemplate`: the template's title if the entry has none of its own, its tags added).

`useSaveAsTemplateAction` is the reverse: "Save as template" creates a template from an entry's current (live, if being edited) content and opens it.

### The dashboard and the template page

`TemplatesView` is a `Dashboard` of active templates under a collapsible `CollapsibleGroupHeader`, with view and sort in `uiStore.templatesPrefs` (a `ListPrefs` field, per vault — see [Tabs and Workspace State](navigation.md#tabs-and-workspace-state)). A row shows icon, name and an "Unsaved" marker; clicking opens `{ type: 'templates', id }`.

`TemplateEditor` renders that page on `LibraryPageFrame`, the shell it shares with `BlockDefinitionEditor` (back link, "Unsaved" marker, name-as-title input, `EditActionBar`/ `SidebarColumn` portalled into the right sidebar). Its draft lifecycle is `useDraftPage`:

- The draft lives in a `DraftStore<T>` (`createDraftStore<T>()` in `store/draftStore.ts`, behind `useBlockDraftStore` and `useTemplateDraftStore`), so edits survive `MainArea` unmounting the view on a module switch.
- "Done" writes only the fields that changed since the page opened (names compared trimmed), so a tag renamed meanwhile isn't overwritten.

Templates have no description; the picker matches the name only. `useShrunkIcon` (shrink an image icon to icon size, last write wins) and `TagsField` (the edit-mode "Tags" section) are shared with the other pages.

### Start and default template in the interface

A category's start template is chosen in its edit row under Categories (`TemplateSelect`: "Default template" or a template), saved with the row; the built-in categories open that row from their context menu, with only the template to change. The default template is a `TemplateSelect` below the template list (`DefaultTemplateSection`, a `DashboardSection`), shown while there are templates, and applies at once. `TemplateSelect` shows a template in the Trash as none, the rule `resolveStartTemplate` applies.
