# Editing

## Edit Mode Architecture

The main content area renders only the title and body. All metadata — tags, category, icon, cover image — is edited in the right sidebar's Properties panel, which writes straight to the store; the main area subscribes to the same fields.

The Properties panel is gated by `activeView.mode === 'edit'`: while viewing, each panel renders a read-only summary (`EntryReadSections`, built from collapsible `SidebarSection`s); in edit mode the same sections show editable values (`EditPropertyRow`, `PropertySelect`, `MediaPropertyRow`) — see [`components.md`](../components.md). Edit mode is entered and left only through the sidebar's action bar; there is no double-click-to-edit on the entry itself.

## Cancel: discarding new entries and reverting autosaved edits

`ActiveView.isNew` marks an entry just created by a "New" action and not yet confirmed with Done. It is session-only: `stripSessionFlags` (`src/lib/tabs.ts`) drops it before a view enters any history — restored tabs (`normalizeSavedTab`) and a tab's back/forward history (`pushHistory`, `normalizeSavedHistory`, see [Navigation History](navigation.md#navigation-history)). Otherwise a restart or Back could make Cancel treat an entry that outlived its creation session as discardable.

Cancel on a still-`isNew` entry runs the page's own Delete: the entry goes to the Trash with the usual undo toast, so nothing typed is lost outright. This holds for Journal, Wiki, Operations and the altar, and for templates and blocks: "New template" / "New block" open the page with `isNew`, `useDraftPage` gets `onCancelNew` (the page's delete), and Done keeps the page. Tasks have no Cancel: Escape on a task that was just created and never named (`freshTaskIds` in `TasksView`, session-only) puts it in the Trash with Undo.

### Reverting a confirmed entry

Journal, Wiki and Operations autosave the title/body shortly after typing stops, so by the time Cancel is pressed the store already holds the edited values. `useEntryEditor` (`src/hooks/useEntryEditor.ts`) therefore captures a **baseline** when edit mode is entered (`buildRestorePatch` — title, content and tags; Wiki and Operations add category, icon and cover image), and `restoreOnCancel()` writes it back together with the `updated_at` the entry had then (skipped if nothing changed), so the autosaves leave no trace in the lists.

The baseline is wider than `buildPatch` on purpose: the Properties panel saves its fields directly, so the autosave never carries them, but Cancel takes them back with the text — one rule, "Cancel restores the entry as it was when editing began". Sigils are blocks in `content`, so the same baseline covers them.

A type change during the edit is part of it (see [Changing an entry's type](#changing-an-entrys-type)): the baseline moves along into the new module's view, and Cancel takes the entry back to the module it came from.

The baseline outlives the view: it lives in a module-level map keyed by view type and entry id (`store/entryEdit.ts`), so looking into another tab mid-edit and coming back continues the same edit. A `uiStore` subscription drops it once no tab shows the entry in edit mode (Done, Cancel, Delete, closing the tab). It is memory only; after a restart a restored edit-mode tab starts a new baseline.

### The altar's snapshot

The altar writes every action through at once (placing, dragging, backgrounds, grid, format), so `store/altarEdit.ts` keeps a **snapshot** instead: the altar record and its placements as they were when edit mode was entered (`beginAltarEdit`, called by `AltarView`). Cancel writes it back through `altarStore.restoreAltarSnapshot`, including `updated_at` and the thumbnail, so the altar keeps its place in the lists.

- **Repeatable write.** An upsert per placement, then a delete of what does not belong — there is no transaction, so if it fails the snapshot stays and the next Edit and Cancel finish it.
- **Ordering.** Cancel switches to read mode first and restores behind it; `restoreAltarEdit` takes hold of the snapshot before its first `await`, since the view change would otherwise prune it. An Edit pressed right after Cancel waits for that write, so it starts from its own snapshot.
- **Untracked writes.** Writes outside the serialized chains — Done's title and thumbnail, the thumbnail taken when the view is left — go through `trackAltarWrite`; a new snapshot and Cancel both wait for them.
- **Vault switch / replace restore** drop every snapshot (`clearAltarEdits`), held ones included: the ids of a replaced vault come back, and Cancel would write the old altar over the restored one.
- **Title.** The one field not written at once; leaving the view without Done saves it so the edit can continue in another tab, and Cancel takes it back with the rest.
- **Library items** are not in the snapshot — they belong to every altar. The snapshot records which items were trashed when the edit began (`trashedItemIds`): their placements are in no snapshot (the store hides them), so Cancel's delete leaves them alone even if an item came back from the Trash during the edit.

`altarEditDirty` answers both the altar's leave guard and the background-tab probe. The snapshot has the baseline's lifetime: kept across a tab switch, dropped once no tab shows the altar in edit mode.

## Leaving an edit

An edit ends with Done or Cancel and nothing else. Leaving a page that is being edited *and has changes* any other way asks first — save, discard, or keep editing.

`store/leaveGuardStore.ts` holds the one **guard** of the open page: a key (`guardKey(viewType, id)`), a title for the question, `isDirty()`, and `save`/`discard`, which are the page's own Done and Cancel. Entries register theirs through `useEditActions` (`guard`; dirty means the stored state differs from the baseline, an autosave is pending, or the entry is new and unconfirmed); block and template pages through `useDraftPage` (dirty means a draft exists). `confirmLeave()` raises the question — `LeaveGuardModal`, rendered once in `AppShell` — and runs the answer; Escape, the X and a click beside the modal all mean "keep editing".

What asks:

- `uiStore.setActiveView`, `navigateBack`/`navigateForward` and `closeTab` run through `whenLeaveConfirmed`: immediately when nothing is dirty, otherwise after the answer. Back/Forward step from the history *as it was before the question* (`stepGuarded`), because Save and Discard navigate themselves and would otherwise shift the step by one.
- Closing a background tab that holds changes goes through `uiStore.askInTab`: it switches to the tab, waits for its view to register its guard (`guardRegistered` — the view may have to load), asks, then closes the tab and returns to the one it was closed from.
- `resolveOpenEdits()` (`lib/openEdits.ts`) asks for every open edit in turn — the open page, then each background tab via `askInTab`. A vault switch (`vaultStore.switchVault`) and a replace or add-vault import (`BackupPage`) call it first. `settleBeforeExit()` adds waiting for writes still under way (`drainSerialized`, `flushDrafts`) — for an update install (`UpdatesPage`) and closing the window (`AppShell`, Tauri's `onCloseRequested`), after which nothing gets another chance.

What does not ask: switching to another tab (the edit continues there), and Done, Cancel and Delete themselves — `useEditActions` wraps them in `withoutLeaveGuard(key, …)`, which exempts that one page while its handler runs.

Whether a *background* tab holds changes is answered without mounting it: `holdsOpenEdit(view)` asks the **probes** registered by `draftStore` (a draft exists), `entryEdit` (stored state differs from the baseline, the entry changed type, or it is new) and `altarEdit` (`altarEditDirty`). Only such a tab is switched to; an unchanged edit-mode tab closes without a flicker.

Whoever answers "keep editing" wants to be in the entry: the Settings and Vaults windows close on that answer (`useCloseOnKeepEditing`, fed by the `stays` counter in `leaveGuardStore`), whether they asked themselves or the window's close button did. `switchVault` resolves to `false` when the user keeps editing. The add-vault import asks *before* it starts and then passes `editsResolved`, so its own switch never asks again: a second "keep editing" would leave the old vault active, and the import would fill it instead of the new one.

## Changing an entry's type

`EntryTypeField` — the first row of the Journal/Wiki/Operation edit-mode Properties section — renders the modules from `MODULE_LIST` filtered by `usesBlocks` as a segmented control; picking one calls `changeEntryType(id, from, to)` (`src/lib/entryTypeChange.ts`). Tasks and Altar have a different data model and aren't convertible.

The entry keeps its id and its row in `entries`. `changeEntryType`:

1. flushes the source view's pending autosave (`EditActions.flush`, see [Right Sidebar Action Bar](#right-sidebar-action-bar)) — the store may still hold stale content when the toggle is clicked;
2. serialized under the entry's write key, runs one `UPDATE` of `type`, `entry_number` (a fresh one in the target type's count — or the former one when the entry returns to the type it had when editing began), title, content, tags, category, icon, cover image and `updated_at` (`retypeRow`); an untitled entry stays untitled and shows the new type's "Untitled …";
3. rewrites every chip pointing at the id to the new `data-entry-type` in `entries` (trashed rows included, so a restored entry doesn't come back with a stale chip) and `templates` (`retypeInternalLinks`, see [Internal Links](#internal-links)), remaps link defaults in `block_definitions` that target it (`remapDefinitionDefaults`), and updates `task_links.target_type`;
4. puts the converted entry into the store, carries the edit baseline along (see [Cancel after a type change](#cancel-after-a-type-change)), calls `uiStore.retypeEntryViews(id, from, to)` — which rewrites every tab's `view`, every tab's history and the tabless history in one `set()` — and only then removes the entry from its old type, so no open tab ever points at a type/id pair that doesn't exist.

Since the row never leaves its table, the entry never exists twice or not at all. Wiki and Operation keep category, icon and cover image across the move; converting to Journal drops them, and `typeChangeDropsProperties` makes the field ask first via `InlineConfirm` when any is set.

The content is left alone: a default template applies only when an entry is created (see [Defaulting on create](templates.md#defaulting-on-create)).

### Cancel after a type change

The type field only exists in edit mode, so every type change happens inside an edit, and Cancel has to undo it with the rest. Right before the tabs move, `retypeEntry` — the one path under `changeEntryType` and `revertEntryType` — calls `carryBaseline` (`store/entryEdit.ts`): the baseline is re-keyed to the new view and, on the first change, records its **origin** — the type and `entry_number` the entry had when editing began. The new view finds a baseline on mount and keeps it instead of capturing its own. A baseline with an origin always counts as dirty, for the leave guard and the background-tab probe alike.

`restoreOnCancel` first waits for the entry's write chain — a type change still writing is already part of the edit — then looks the baseline up by entry id (`baselineOf`), since it may no longer sit under the view Cancel was pressed in. It sees the origin and calls `revertEntryType` instead of the store's update. That is the same path as the change itself, run backwards: the row gets the origin's type and number, the baseline's fields — title, content, tags, category, icon, cover image — and its `updated_at`; chips, block defaults and `task_links` follow as they did on the way out. It ends with `retypeEntryViews(…, { endEdit: true })`, which puts the open page into read mode in the same `set()`, so the original module's view never mounts in edit mode and never captures a baseline of its own. `restoreOnCancel` returns `EDIT_ENDED`, and the view — being unmounted at that moment — does nothing further; its own `setActiveView` would point at a type/id pair that no longer exists. The same answer covers every case where the entry has left the view by the time Cancel finishes, such as a second Cancel behind the first. The reverted entry is put back at its sorted place in the store's list (`withSortedEntry`), not in front like a newly arrived one.

- **Category, icon and cover image** dropped by a move to Journal come back: Wiki's and Operations' baselines hold them, and the baseline is what travels.
- **The number.** The entry gets its old `entry_number` back unless another entry of that type took it meanwhile (`formerEntryNumber`); then it gets the next one. The same applies when the user switches back to the original type by hand — the origin is then dropped and the edit is an ordinary one again.
- **No save on the way out.** While Cancel runs, the debounce, unmount and navigate-away saves are off for that entry (`isDiscarding` in `store/entryEdit.ts`, see below for the lock on the action bar); they would write the discarded text over the restored entry. The mark is per entry, not per view: a revert unmounts more than the view Cancel was pressed in. After a revert it stays until the entry's next edit begins.
- **Back/Forward with "Discard".** `stepGuarded` steps from the history as it was before the question; `retypeEntryViews` rewrites that held copy too (`heldHistory`), or it would keep the entry under the discarded type.
- **The edit is locked while it writes.** `changeEntryType` and `restoreOnCancel` run inside `withEditLock` (`uiStore.ts`), which holds `uiStore.editLocked` — counted, since a Cancel can wait behind a type change still writing and the first to finish must not release the other's lock. While it is set, `RightSidebarActionBar` disables Done, Delete and Cancel (`EditActionBar`'s `locked`) and `EntryTypeField` its segments; their handlers ask the store at click time, since the lock has to hold from the click that set it, not from the next paint. Leaving the page is dropped too (`whenLeaveConfirmed`): the leave question would go to the guard of the view being torn down, and its Save or Discard would navigate to a type/id pair that no longer exists. Closing a background tab is refused the same way (`askInTab`). Draft pages of templates and blocks pass the flag to their own bar (`LibraryPageFrame`), since the lock is global and their closing step would be dropped as well. The other direction is covered by `EntryTypeField`: it refuses a click while the page's own Done, Cancel or Delete is still writing (`isEnding` in `leaveGuardStore`), whose step into read mode or back to the list would otherwise fall into the lock. `resolveOpenEdits` for the open page — vault switch, closing the window — does not check the lock. The automatic backup depends on the same lock: a run answers `busy` while it is set and drops what it read if `editLockEpoch()` moved meanwhile, since these writes span several tables — see [Automatic Backup](storage.md#automatic-backup).
- **Cancel ends the edit in its own tab.** `restoreOnCancel` remembers the tab it was pressed in. If the open page is no longer that entry in that view when the write is through — the type was reverted, or the user went to another tab meanwhile — it ends the edit there itself (`uiStore.endEditInTab`) and answers `EDIT_ENDED`, so the view neither navigates the wrong tab nor resets local state that already belongs to the next entry.
- **Unsaved copies follow a type change.** Besides the stored rows, `retypeUnsavedLinks` rewrites chips pointing at the entry in the baselines of other running edits (`retypeBaselineLinks`) and in template and block drafts (`base` and `draft`); a Cancel or Done there would otherwise write the old `data-entry-type` back. Likewise `reassignCategoriesInMemory` moves baselines off a merged or purged category (`reassignBaselineCategories`), or Cancel would fail on the foreign key.
- **The view an entry left does not save.** The hook's unmount and navigate-away saves skip an entry that is no longer of the view's type: `changeEntryType` flushed before, and the old view's state still carries chips of the old type.
- **A new, unconfirmed entry** is not reverted: Cancel puts it in the Trash under the type it has.

## Right Sidebar Action Bar

`RightSidebar.tsx` renders a `RightSidebarActionBar` pinned above the scrollable Properties content. It reads `uiStore.editActions` (set via `setEditActions`): in edit mode it shows Done/Delete/Cancel, in view mode Edit (plus a Fullscreen toggle for the altar). An entry whose loaded sigil locks it keeps the Edit button in place, disabled, with a tooltip (`editor.lockedBySigil`) on a wrapper `<span>`, because a disabled tone `Button` takes no pointer events.

Each entry view registers its handlers through `useEditActions(active, handlers)` (`src/hooks/useEditActions.ts`):

```ts
useEditActions(isEditing, { onSave: handleDone, onCancel: handleCancel, onDelete: handleDelete });
```

The handlers live in a ref overwritten on every render, and the effect depends only on `active` (and the guard key): `setEditActions` needs to run when edit mode flips, not per keystroke, yet the handlers must see the latest `title`/`content` at call time. Calling `setEditActions` on every render, combined with a whole-store `useUIStore()` subscription, produces an infinite render loop and a blank screen — keep sidebar-consuming components on per-field selectors (see [Store Selectors](modules.md#store-selectors)).

The optional fourth handler, `flush`, is for a sidebar action that needs the *current* row rather than what the last debounced autosave wrote: Journal/Wiki/Operations pass `flushAutoSave` from `useEntryEditor`, and `changeEntryType` calls `editActions?.flush?.()` before reading the entry.

## List Header Portal

In list views (every module, plus Home, Categories, Tags, Trash and the library views Blocks, Templates and Lexicon), `Dashboard`'s header — actions, toolbar, filter panel — lives **only** in the right sidebar; there is no inline fallback above the list. `RightSidebar.tsx` hands its host `<div>` to `uiStore.listHeaderHost` through a ref callback (`setListHeaderHost`); `SidebarPortal` (`src/components/ui/SidebarPortal.tsx`) `createPortal`s its children into it whenever it is non-null. `Dashboard` renders its header through one; a library page (block, template, language — `LibraryPageFrame`) renders its sidebar content (Done/Delete/Cancel, settings, usage) through another.

Invariant: exactly one writer (the ref callback) and at most one reader at a time — `MainArea` renders one view, so only one thing portals into the host. `listHeaderHost` is a DOM node and is not persisted.

Closing the right sidebar has nothing to fall back to: the header disappears with it and the list gets the room back. `AppShell` keeps the sidebar mounted (`inert`) for the collapse animation (see [Left Sidebar](navigation.md#left-sidebar-rail--entry-list)), so the header stays visible for that stretch and vanishes once the ref callback clears `listHeaderHost`.

`RightSidebar` decides whether to offer the host from `uiStore.dashboardMounted`, not from `activeView.id`. `Dashboard` announces itself in a `useLayoutEffect` (`setDashboardMounted`) — a layout effect, so opening an entry switches the sidebar to the action bar before the first paint. Guessing from `activeView.id` gets it wrong: Tasks carries an id while showing its list (a jump target, not an open entry), and a stale id of a just-deleted entry falls back to that module's `Dashboard` — both would show the entry action bar with a meaningless Edit button. `VIEWS_WITHOUT_ENTRIES` (`home`/`tags`/`categories` plus the library views) and a missing `activeView.id` also offer the host up front, so it exists before a lazily loaded list view has mounted its `Dashboard`. Home, Categories and Tags have no entries but go through `Dashboard` so their header portals like everyone else's.

### Header contents

The props and sections are documented in [`components.md`](../components.md) (`Dashboard`, `ListToolbar`, `FilterPanel`); the rules that matter here:

- `groupBy` (`{ value, onChange, label? }`) is the grouping axis, independent of `sort` (`GroupingMode` vs. `SortMode`). A module with nothing to group omits it.
- Every dashboard's main action is `primaryAction`; `danger: true` renders the red `btn-primary-danger` (Trash). `extraActions` are compact icon buttons on the same row; `contentFooter` renders below the content in every state, for a module's second area (Altar library, Blocks' built-in blocks, Templates' defaults overview, Lexicon's translate panel).
- `ListToolbar` and `FilterPanel` have only the sidebar-column presentation; `FilterPanel` is always visible. Search sits in the main area next to the title (`ListSearchField`).
- **Timeline.** `sortBlockedInTimeline` disables every non-date sort, and the grouping switch, with an explanatory tooltip — the timeline orders and groups by month on its own. The stored sort is not overwritten: the select *shows* newest first, `groupByMonth` orders by date (ascending only if the list already is), and the stored sort applies again with another layout.
- `FilterPanel`'s `displayToggles` (view preferences like Tasks' "Show completed") are not counted in the active-filter badge and untouched by a reset. Each `FilterList`'s "All" row clears it; "Reset filters" in the shared no-results state clears search and every filter at once.

## Auto-Save (the `useEntryEditor` hook)

Debounced auto-save (1.5 s), save-on-navigate and save-on-unmount live in `src/hooks/useEntryEditor.ts`, shared by JournalView, WikiView and OperationsView. The hook takes a `buildPatch()` closure and an `update(id, patch)` action and keeps the latest closure in a ref, so the navigate-away save still reads the *previous* entry's local state (the views' load effects run after the hook's — the hook call sits above them).

The editor content is mirrored into a ref (`contentRef`) on each keystroke rather than into React state, which would re-render the whole view per keystroke. `BlockStack`'s `initialContent` (and each `RichEditor`'s) is therefore an **initial value only**. Switching entries remounts the stack via its `key` (`` `${id}:${editorEpoch}` ``), and Cancel bumps `editorEpoch` to remount from the restored baseline. Since the whole block stack serialises into one `content` string, the baseline reverts every block change of the session, sigil blocks included.

Two guards protect the save paths:

- `ready` (the view's `loadedEntryId` gate) arms the navigate/unmount saves only after local state is hydrated, so a StrictMode double-mount in edit mode cannot write empty fields.
- `src/lib/editorLock.ts` suspends all automatic editor saves while a replace/add-vault backup import runs — otherwise the unmount triggered by the import's own navigation would write the pre-import content over the restored rows.

## Internal Links

`createInternalLinkExtension(getItems, getIcon, getLabel)` renders linked entries as inline chips; its callbacks are ref-backed so they always see current store state. Each chip stores `data-type="internalLink"`, `data-id`, `data-entry-type`, `data-label` and `data-icon`. Chips render identically in edit and view mode; the node view reads `editor.isEditable` at event time.

The chips in `content` are the only record of what links where — there is no links table.

**What an entry links** — the "Linked entries" field (`LinkedEntriesField`) of Journal, Wiki and Operations — is read straight out of the content via `extractInternalLinks` (`src/lib/internalLinkHtml.ts`). Reading is deliberately `DOMParser`-free (regex over the opening `<span>` tag): it sits on the database path, where migrations and the Node check scripts run it outside a browser. Writing/remapping a chip's markup (`remapInternalLinks`) uses a real `DOMParser`, since correctness matters more there than portability.

**Sidebar ↔ editor.** The field has no reference to the open view's TipTap instance, so it talks to it through three `document`-level custom events in `lib/links.ts`: `requestEntryLinkAppend`/`requestEntryLinkReveal`/`requestEntryLinkRemove`, answered via `subscribeEntryLinkRequest` on the `BlockStack` side, which routes them to the right text block (see [Content Blocks](blocks.md#content-blocks)). A request resolves to `true` only when an editable, mounted editor accepted it via `preventDefault()`; otherwise the field falls back (e.g. `reveal` navigates to the target). `isValidLinkTarget` guards all three and the navigate-on-click handler, since the events are reachable by any script in the WebView.

**Appending** a link (from the field, the `[[` picker, or a routine converted to a template — see [Routines converted to templates](templates.md#routines-converted-to-templates)) always adds a full block — a horizontal rule, the target's category as an `<h3>`, then the chip — never merging into an existing block. `internalLinkBlockHtml` is the one definition of that shape, shared by the editor's `appendEntryLink`, migrations v36/v37 and the import's legacy bridge (below). In a completely empty entry (`isBlankContent`, regex like `extractInternalLinks`) the block goes in without its leading rule (the `separator` option) — there is no text above to separate. `plainBlockHtml` renders the same shape without a chip, for a legacy value that resolves to nothing in this vault.

Appending then jumps to and highlights the new block (`revealEntryLink` with `caretAtBlockEnd`, a frame later so the node view exists), leaving the caret at the end ready to type; revealing an existing chip selects the chip itself as a node.

**Removing** a link deletes the whole block if the chip is the sole content of an appended block (`removeEntryLink` checks for the preceding rule/heading), or just the chip if it sits inline in the user's own text. `internalLink` is an inline atom, so its parent is always a textblock.

**Cross-vault import.** A chip's `data-id` is only meaningful in its own vault. `.emerald` export carries `meta.contentLinks` — id, entry type and title for every chip — so import can re-resolve each chip: by id first, then by the recorded title, then by the chip's own `data-label` for files without `contentLinks`. A chip that resolves to nothing becomes its display text (`remapInternalLinks`'s `null` case). The remap must run *before* DOMPurify: it parses and re-serialises the HTML, and that round-trip must not happen on content the sanitizer has already cleared. `sanitizeImportedHtml` is therefore the *last* step of every import that writes HTML — `.emerald` (after `beforeSanitize`, where legacy Journal links are appended as chips) and Markdown alike.

The import also keeps the file's creation date: `importedCreatedAt(file)` passes it to `createEntry`/`createAltar` (`createdAt` option) so the entry sits at its place in the timeline. Only a parseable date with a four-digit year passes (dates sort as text, and `+010000-…` would sort before 2024); otherwise it falls back to now. `updated_at` is set to the same date (`importedStamp`), since an import is not an edit.

**A chip's own type, rewritten in place.** `retypeInternalLinks(html, id, entryType)` sets `data-entry-type` on every chip pointing at `id`, for an entry that changed type (see [Changing an entry's type](#changing-an-entrys-type)) — the id stays, so only that attribute changes. It is regex-based like `extractInternalLinks`: `entryTypeChange.ts` runs it over every matching row of `entries` and `templates`, and a full parse-and-reserialise would rewrite content nobody touched.

**Pre-v36 legacy bridge.** Old Journal backups carry `linked_operation_ids`/`linked_wiki_ids`. Migration v36 rewrote them into content blocks of the shape above (see [`database.md`](../database.md#entries)); `entries` has no such columns. Import converts an older backup's values into chips row by row before inserting (`linkedIdsToContent`, `tablesLinkSource`/`rowsLinkSource` in `migrateLinkedIdsToContent.ts`), and `.emerald`/Markdown import of a pre-v36 file appends the same blocks.

**Pre-v37 legacy bridge.** Old Journal data carries three fixed properties — Paradigm, Banishing, Meditation, each tied to one wiki article — plus a meditation duration. Migration v37 (`migrateJournalFieldsToContent.ts`) rewrote these six columns into the same kind of content block; a backup that still carries them is converted row by row before insert (`journalFieldsToContent`, see [`database.md`](../database.md#entries)). The duration has no link target and becomes plain text after its chip (`"(20 min)"`, via `internalLinkBlockHtml`'s `suffix` option); a set `is_bannung`/`is_meditation` flag without an article becomes a `plainBlockHtml` paragraph naming the category. `.emerald`/Markdown import of pre-v37 files applies the same conversion through `appendLegacyLinks`/`legacyFieldTargets` in `emeraldFormat.ts`, which also decides the plain-text fallback when a referenced article doesn't exist in the importing vault.

## Text and Image Alignment

`RichEditor` configures `@tiptap/extension-text-align` for `heading` and `paragraph` only (`TEXT_ALIGN_TYPES`, exported from `EditorToolbar.tsx` so the extension config and the toolbar's disabled-state check share one list). Left alignment is the *absence* of the `textAlign` attribute, not an explicit `"left"`: the extension serialises whatever value it is given, and leaving it unset keeps a fresh paragraph's HTML free of a redundant attribute.

An image aligns through its own `align` attribute on the custom node in `ResizableImageExtension.tsx` — a paragraph's `text-align` never reaches it, since the image is a block node with its own width. `align` (the `Alignment` type, shared with text since the toolbar's three buttons drive both) serialises as `data-align` plus inline `margin-left`/`margin-right` (`alignMargins()`); `alignFromLegacyStyle()` reads the alignment from the margins alone for images stored without `data-align`. `data-align` is allowlisted in the `.emerald` import's DOMPurify config (`src/lib/emeraldFormat.ts`) but not in PDF export's sanitisation — nothing there reads it, and the inline margins carry the alignment regardless.
