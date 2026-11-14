# Editing

## Edit Mode Architecture

The main content area renders only the title and body. All metadata — tags, category, icon, cover image — is edited in the right sidebar's Properties panel, which writes straight to the store; the main area subscribes to the same fields.

The Properties panel is gated by `activeView.mode === 'edit'`: while viewing, each panel renders a read-only summary (`EntryReadSections`, built from collapsible `SidebarSection`s); in edit mode the same sections show editable values (`EditPropertyRow`, `PropertySelect`, `MediaPropertyRow`) — see [`components.md`](../components.md). Edit mode is entered and left only through the sidebar's action bar; there is no double-click-to-edit on the entry itself.

## Cancel: discarding new entries and reverting autosaved edits

`ActiveView.isNew` marks an entry just created by a "New" action and not yet confirmed with Done. It is session-only: `stripSessionFlags` (`src/lib/tabs.ts`) drops it before a view enters any history — restored tabs (`normalizeSavedTab`) and a tab's back/forward history (`pushHistory`, `normalizeSavedHistory`, see [Navigation History](navigation.md#navigation-history)). Otherwise a restart or Back could make Cancel treat an entry that outlived its creation session as discardable.

Cancel on a still-`isNew` entry runs the page's own Delete: the entry goes to the Trash with the usual undo toast, so nothing typed is lost outright. This holds for Journal, Wiki and Operations, and for templates and blocks: "New template" / "New block" open the page with `isNew`, `useDraftPage` gets `onCancelNew` (the page's delete), and Done keeps the page. Tasks have no Cancel: Escape on a task that was just created and never named (`freshTaskIds` in `TasksView`, session-only) puts it in the Trash with Undo.

### Reverting a confirmed entry

Journal, Wiki and Operations autosave the title/body shortly after typing stops, so by the time Cancel is pressed the store already holds the edited values. `useEntryEditor` (`src/hooks/useEntryEditor.ts`) therefore captures a **baseline** when edit mode is entered (`buildRestorePatch` — title, content, tags and category; Wiki and Operations add icon and cover image), and `restoreOnCancel()` writes it back together with the `updated_at` the entry had then (skipped if nothing changed), so the autosaves leave no trace in the lists.

The baseline is wider than `buildPatch` on purpose: the Properties panel saves its fields directly, so the autosave never carries them, but Cancel takes them back with the text — one rule, "Cancel restores the entry as it was when editing began". Sigils are blocks in `content`, so the same baseline covers them.

A move to another module during the edit is part of it (see [Moving an entry to another module](#moving-an-entry-to-another-module)): the baseline moves along into the new module's view, and Cancel takes the entry back to the category and view it came from.

The baseline outlives the view: it lives in a module-level map keyed by view type and entry id (`store/entryEdit.ts`), so looking into another tab mid-edit and coming back continues the same edit. A `uiStore` subscription drops it once no tab shows the entry in edit mode (Done, Cancel, Delete, closing the tab). It is memory only; after a restart a restored edit-mode tab starts a new baseline.

## Leaving an edit

An edit ends with Done or Cancel and nothing else. Leaving a page that is being edited *and has changes* any other way asks first — save, discard, or keep editing.

`store/leaveGuardStore.ts` holds the one **guard** of the open page: a key (`guardKey(viewType, id)`), a title for the question, `isDirty()`, and `save`/`discard`, which are the page's own Done and Cancel. Entries register theirs through `useEditActions` (`guard`; dirty means the stored state differs from the baseline, an autosave is pending, or the entry is new and unconfirmed); block and template pages through `useDraftPage` (dirty means a draft exists). `confirmLeave()` raises the question — `LeaveGuardModal`, rendered once in `AppShell` — and runs the answer; Escape, the X and a click beside the modal all mean "keep editing".

What asks:

- `uiStore.setActiveView`, `navigateBack`/`navigateForward` and `closeTab` run through `whenLeaveConfirmed`: immediately when nothing is dirty, otherwise after the answer. Back/Forward step from the history *as it was before the question* (`stepGuarded`), because Save and Discard navigate themselves and would otherwise shift the step by one.
- Closing a background tab that holds changes goes through `uiStore.askInTab`: it switches to the tab, waits for its view to register its guard (`guardRegistered` — the view may have to load), asks, then closes the tab and returns to the one it was closed from.
- `resolveOpenEdits()` (`lib/openEdits.ts`) asks for every open edit in turn — the open page, then each background tab via `askInTab`. A vault switch (`vaultStore.switchVault`) and a replace or add-vault import (`BackupPage`) call it first. `settleBeforeExit()` adds waiting for writes still under way (`drainSerialized`, `flushDrafts`) — for an update install (`StartUpdates`) and closing the window (`AppShell`, Tauri's `onCloseRequested`), after which nothing gets another chance.

What does not ask: switching to another tab (the edit continues there), and Done, Cancel and Delete themselves — `useEditActions` wraps them in `withoutLeaveGuard(key, …)`, which exempts that one page while its handler runs.

Whether a *background* tab holds changes is answered without mounting it: `holdsOpenEdit(view)` asks the **probes** registered by `draftStore` (a draft exists) and `entryEdit` (stored state differs from the baseline, the entry moved to another module, or it is new). Only such a tab is switched to; an unchanged edit-mode tab closes without a flicker.

Whoever answers "keep editing" wants to be in the entry: the Settings and Vaults windows close on that answer (`useCloseOnKeepEditing`, fed by the `stays` counter in `leaveGuardStore`), whether they asked themselves or the window's close button did. `switchVault` resolves to `false` when the user keeps editing. The add-vault import asks *before* it starts and then passes `editsResolved`, so its own switch never asks again: a second "keep editing" would leave the old vault active, and the import would fill it instead of the new one.

## Moving an entry to another module

An entry has no type: which module shows it follows from its category and the dashboards' filters (see [Dashboards](modules.md#dashboards)). `EntryAreaField` — the first row of the Journal/Wiki/Operation edit-mode Properties section — renders the modules from `MODULE_LIST` filtered by `usesBlocks` as a segmented control, its value the module the entry counts as (`viewOfEntry`). Picking another one is a change of category: `moveToArea` sets the first category of that module's dashboard (`startCategoryOf`) — unless the entry's category already belongs there — and moves the tabs. Tasks have a different data model and aren't part of it.

Inside `withEditLock`, `moveToArea`:

1. waits for a pending icon write (`pendingEntryWrites`) and flushes the source view's pending autosave (`EditActions.flush`, see [Right Sidebar Action Bar](#right-sidebar-action-bar)) — the store may still hold stale content when the toggle is clicked;
2. writes the new `category_id` through the store's `updateEntry`, like the category row below it would;
3. carries the edit baseline along (`carryBaseline`, see below) and calls `uiStore.moveEntryViews(id, from, to)` — which rewrites every tab's `view`, every tab's history and the tabless history in one `set()`.

Nothing else is rewritten: link chips, link defaults of custom blocks and `task_links` name the entry by id with the target kind `entry` (see [Internal Links](#internal-links)), and every module view opens any entry by id. Title, content, tags, number, icon and cover image stay as they are. The content is left alone too: a start template applies only when an entry is created (see [Starting an entry](templates.md#starting-an-entry)). Changing the category in the category row moves the entry to the other module as well, as far as lists, search and Home are concerned; only the open tab stays where it is.

### Cancel after a move

The field only exists in edit mode, so every move happens inside an edit, and Cancel has to undo it with the rest. Right before the tabs move, `carryBaseline` (`store/entryEdit.ts`) re-keys the baseline to the new view and, on the first move, records its **origin** — the view the edit began in. The new view finds a baseline on mount and keeps it instead of capturing its own. A baseline with an origin always counts as dirty, for the leave guard and the background-tab probe alike; a move back to the origin makes it an ordinary edit again.

`restoreOnCancel` first waits for the entry's write chain — a move still writing is already part of the edit — then looks the baseline up by entry id (`baselineOf`), since it may no longer sit under the view Cancel was pressed in. With an origin it writes the baseline back like any Cancel — title, content, tags, category, icon, cover image and `updated_at`; every view's baseline holds the category — and then calls `moveEntryViews(…, { endEdit: true })`, which puts the open page into read mode in the same `set()`, so the original module's view never mounts in edit mode and never captures a baseline of its own. `restoreOnCancel` returns `EDIT_ENDED`, and the view — being unmounted at that moment — does nothing further. The same answer covers every case where the entry has left the view by the time Cancel finishes, such as a second Cancel behind the first.

- **No save on the way out.** While Cancel runs, the debounce, unmount and navigate-away saves are off for that entry (`isDiscarding` in `store/entryEdit.ts`, see below for the lock on the action bar); they would write the discarded text over the restored entry. The mark is per entry, not per view: a move back unmounts more than the view Cancel was pressed in. After it, it stays until the entry's next edit begins.
- **Back/Forward with "Discard".** `stepGuarded` steps from the history as it was before the question; `moveEntryViews` rewrites that held copy too (`heldHistory`), or it would keep the entry under the discarded view.
- **The edit is locked while it writes.** `moveToArea` and `restoreOnCancel` run inside `withEditLock` (`uiStore.ts`), which holds `uiStore.editLocked` — counted, since a Cancel can wait behind a move still writing and the first to finish must not release the other's lock. While it is set, `RightSidebarActionBar` disables Done, Delete and Cancel (`EditActionBar`'s `locked`) and `EntryAreaField` its segments; their handlers ask the store at click time, since the lock has to hold from the click that set it, not from the next paint. Leaving the page is dropped too (`whenLeaveConfirmed`): the leave question would go to the guard of the view being torn down. Closing a background tab is refused the same way (`askInTab`). Draft pages of templates and blocks pass the flag to their own bar (`LibraryPageFrame`), since the lock is global and their closing step would be dropped as well. The other direction is covered by `EntryAreaField`: it refuses a click while the page's own Done, Cancel or Delete is still writing (`isEnding` in `leaveGuardStore`), whose step into read mode or back to the list would otherwise fall into the lock. `resolveOpenEdits` for the open page — vault switch, closing the window — does not check the lock. The automatic backup depends on the same lock: a run answers `busy` while it is set and drops what it read if `editLockEpoch()` moved meanwhile, since these writes span several tables — see [Automatic Backup](storage.md#automatic-backup).
- **Cancel waits for a pending icon.** An image icon is shrunk before it is written (`useShrunkIcon`), so its write can still be on the way when Cancel is pressed. The write goes through `trackEntryWrite` (`store/entryEdit.ts`); `restoreOnCancel` awaits `pendingEntryWrites` inside the lock, after `beginDiscard`, so the late write sees `isDiscarding` and drops itself instead of landing after the restore. `moveToArea` awaits it too, at the start of its lock. The altar tracks the write through `trackAltarWrite`; its Cancel waits for it and then writes the snapshot over it.
- **Cancel ends the edit in its own tab.** `restoreOnCancel` remembers the tab it was pressed in. If the open page is no longer that entry in that view when the write is through — the entry went back to its view, or the user went to another tab meanwhile — it ends the edit there itself (`uiStore.endEditInTab`) and answers `EDIT_ENDED`, so the view neither navigates the wrong tab nor resets local state that already belongs to the next entry.
- **Merged or purged categories.** `reassignCategoriesInMemory` moves baselines off a merged or purged category (`reassignBaselineCategories`), or Cancel would fail on the foreign key.
- **A new, unconfirmed entry** is not moved back: Cancel puts it in the Trash.

## Right Sidebar Action Bar

`RightSidebar.tsx` renders a `RightSidebarActionBar` pinned above the scrollable Properties content. It reads `uiStore.editActions` (set via `setEditActions`): in edit mode it shows Done/Delete/Cancel, in view mode Edit. An entry whose loaded sigil locks it keeps the Edit button in place, disabled, with a tooltip (`editor.lockedBySigil`) on a wrapper `<span>`, because a disabled tone `Button` takes no pointer events.

Each entry view registers its handlers through `useEditActions(active, handlers)` (`src/hooks/useEditActions.ts`):

```ts
useEditActions(isEditing, { onSave: handleDone, onCancel: handleCancel, onDelete: handleDelete });
```

The handlers live in a ref overwritten on every render, and the effect depends only on `active` (and the guard key): `setEditActions` needs to run when edit mode flips, not per keystroke, yet the handlers must see the latest `title`/`content` at call time. Calling `setEditActions` on every render, combined with a whole-store `useUIStore()` subscription, produces an infinite render loop and a blank screen — keep sidebar-consuming components on per-field selectors (see [Store Selectors](modules.md#store-selectors)).

The optional fourth handler, `flush`, is for a sidebar action that needs the *current* row rather than what the last debounced autosave wrote: Journal/Wiki/Operations pass `flushAutoSave` from `useEntryEditor`, and `EntryAreaField` calls `editActions?.flush?.()` before changing the category.

## List Header Portal

In list views (every module, plus Home, Categories, Tags, Trash and the library views Blocks, Templates and Lexicon), `Dashboard`'s header — actions, toolbar, filter panel — lives **only** in the right sidebar; there is no inline fallback above the list. `RightSidebar.tsx` hands its host `<div>` to `uiStore.listHeaderHost` through a ref callback (`setListHeaderHost`); `SidebarPortal` (`src/components/ui/SidebarPortal.tsx`) `createPortal`s its children into it whenever it is non-null. `Dashboard` renders its header through one; a library page (block, template, language — `LibraryPageFrame`) renders its sidebar content (Done/Delete/Cancel, settings, usage) through another.

Invariant: exactly one writer (the ref callback) and at most one reader at a time — `MainArea` renders one view, so only one thing portals into the host. `listHeaderHost` is a DOM node and is not persisted.

Closing the right sidebar has nothing to fall back to: the header disappears with it and the list gets the room back. `AppShell` keeps the sidebar mounted (`inert`) for the collapse animation (see [Left Sidebar](navigation.md#left-sidebar-rail--entry-list)), so the header stays visible for that stretch and vanishes once the ref callback clears `listHeaderHost`.

`RightSidebar` decides whether to offer the host from `uiStore.dashboardMounted`, not from `activeView.id`. `Dashboard` announces itself in a `useLayoutEffect` (`setDashboardMounted`) — a layout effect, so opening an entry switches the sidebar to the action bar before the first paint. Guessing from `activeView.id` gets it wrong: Tasks carries an id while showing its list (a jump target, not an open entry), and a stale id of a just-deleted entry falls back to that module's `Dashboard` — both would show the entry action bar with a meaningless Edit button. `VIEWS_WITHOUT_ENTRIES` (`home`/`tags`/`categories` plus the library views) and a missing `activeView.id` also offer the host up front, so it exists before a lazily loaded list view has mounted its `Dashboard`. Home, Categories and Tags have no entries but go through `Dashboard` so their header portals like everyone else's.

### Header contents

The props and sections are documented in [`components.md`](../components.md) (`Dashboard`, `ListToolbar`, `FilterPanel`); the rules that matter here:

- `groupBy` (`{ value, onChange, label? }`) is the grouping axis, independent of `sort` (`GroupingMode` vs. `SortMode`). A module with nothing to group omits it.
- Every dashboard's main action is `primaryAction`; `danger: true` renders the red `btn-primary-danger` (Trash). `extraActions` are compact icon buttons on the same row; `contentFooter` renders below the content in every state, for a module's second area (Blocks' built-in blocks, Templates' defaults overview, Lexicon's translate panel).
- `ListToolbar` and `FilterPanel` have only the sidebar-column presentation; `FilterPanel` is always visible. Search sits in the main area next to the title (`ListSearchField`).
- **Timeline.** `sortBlockedInTimeline` disables every non-date sort, and the grouping switch, with an explanatory tooltip — the timeline orders and groups by month on its own. The stored sort is not overwritten: the select *shows* newest first, `groupByMonth` orders by date (ascending only if the list already is), and the stored sort applies again with another layout.
- `Dashboard`'s `displayToggles` (view preferences, in the sidebar's view section, like Tasks' "Show completed") are not counted in the active-filter badge and untouched by a reset. Each `FilterList`'s "All" row clears it; "Reset filters" in the shared no-results state clears search and every filter at once.

## Auto-Save (the `useEntryEditor` hook)

Debounced auto-save (1.5 s), save-on-navigate and save-on-unmount live in `src/hooks/useEntryEditor.ts`, shared by JournalView, WikiView and OperationsView. The hook takes a `buildPatch()` closure and an `update(id, patch)` action and keeps the latest closure in a ref, so the navigate-away save still reads the *previous* entry's local state (the views' load effects run after the hook's — the hook call sits above them).

The editor content is mirrored into a ref (`contentRef`) on each keystroke rather than into React state, which would re-render the whole view per keystroke. `BlockStack`'s `initialContent` (and each `TextEditor`'s) is therefore an **initial value only**. Switching entries remounts the stack via its `key` (`` `${id}:${editorEpoch}` ``), and Cancel bumps `editorEpoch` to remount from the restored baseline. Since the whole block stack serialises into one `content` string, the baseline reverts every block change of the session, sigil blocks included.

Two guards protect the save paths:

- `ready` (the view's `loadedEntryId` gate) arms the navigate/unmount saves only after local state is hydrated, so a StrictMode double-mount in edit mode cannot write empty fields.
- `src/lib/editorLock.ts` suspends all automatic editor saves while a replace/add-vault backup import runs — otherwise the unmount triggered by the import's own navigation would write the pre-import content over the restored rows.

## Internal Links

`createInternalLinkExtension(getItems, getIcon, getLabel)` renders linked entries as inline chips; its callbacks are ref-backed so they always see current store state. Each chip stores `data-type="internalLink"`, `data-id`, `data-entry-type`, `data-label` and `data-icon`. Chips render identically in edit and view mode; the node view reads `editor.isEditable` at event time.

The chips in the text blocks are the record of what links where — there is no links table of their own. `block_refs` lists each chip's target per block, which is how the image cleanup and the backup find what a block names; what an open entry links is read from its in-memory text.

**What an entry links** — the "Linked entries" field (`LinkedEntriesField`) of Journal, Wiki and Operations — is read straight out of the entry's text (the block stack the store holds as one string) via `extractInternalLinks` (`src/lib/internalLinkHtml.ts`). Reading is deliberately `DOMParser`-free (regex over the opening `<span>` tag): it sits on the database path, where the Node check scripts run it outside a browser. Writing/remapping a chip's markup (`remapInternalLinks`) uses a real `DOMParser`, since correctness matters more there than portability.

**Sidebar ↔ editor.** The field has no reference to the open view's TipTap instance, so it talks to it through three `document`-level custom events in `lib/links.ts`: `requestEntryLinkAppend`/`requestEntryLinkReveal`/`requestEntryLinkRemove`, answered via `subscribeEntryLinkRequest` on the `BlockStack` side, which routes them to the right text block (see [Content Blocks](blocks.md#content-blocks)). A request resolves to `true` only when an editable, mounted editor accepted it via `preventDefault()`; otherwise the field falls back (e.g. `reveal` navigates to the target). `isValidLinkTarget` guards all three and the navigate-on-click handler, since the events are reachable by any script in the WebView.

**Appending** a link (from the field or the `[[` picker) always adds a full block — a horizontal rule, the target's category as an `<h3>`, then the chip — never merging into an existing block. `internalLinkBlockHtml` is the one definition of that shape, shared by the editor's `appendEntryLink` and `BlockStack`. In a completely empty entry (`isBlankContent`, regex like `extractInternalLinks`) the block goes in without its leading rule (the `separator` option) — there is no text above to separate.

Appending then jumps to and highlights the new block (`revealEntryLink` with `caretAtBlockEnd`, a frame later so the node view exists), leaving the caret at the end ready to type; revealing an existing chip selects the chip itself as a node.

**Removing** a link deletes the whole block if the chip is the sole content of an appended block (`removeEntryLink` checks for the preceding rule/heading), or just the chip if it sits inline in the user's own text. `internalLink` is an inline atom, so its parent is always a textblock.

**Cross-vault import.** A chip's `data-id` is only meaningful in its own vault. `.emerald` export carries `meta.contentLinks` — id, target kind and title for every chip — so import can re-resolve each chip: by id first, then by the recorded title, then by the chip's own `data-label` for files without `contentLinks`. A chip that resolves to nothing becomes its display text (`remapInternalLinks`'s `null` case). The remap must run *before* DOMPurify: it parses and re-serialises the HTML, and that round-trip must not happen on content the sanitizer has already cleared. `sanitizeImportedHtml` is therefore the *last* step of every import that writes HTML — `.emerald` and Markdown alike.

The import also keeps the file's creation date: `importedCreatedAt(file)` passes it to `createEntry` (`createdAt` option) so the entry sits at its place in the timeline. Only a parseable date with a four-digit year passes (dates sort as text, and `+010000-…` would sort before 2024); otherwise it falls back to now. `updated_at` is set to the same date (`importedStamp`), since an import is not an edit.

**What a chip stores.** `data-entry-type` holds the target *kind* — `entry` or `task` (`linkTargetKindOf`), never which module an entry is in: an entry has no type, and its module follows from its category at the moment the chip is shown or clicked (`viewOfLinkTarget` in `store/entryViews.ts`). So a change of category rewrites no chip. `linkItemKey` maps a chip and a link item (which carries the display kind) onto the same key, `entry:<id>` or `task:<id>`.

## Text and Image Alignment

`TextEditor` configures `@tiptap/extension-text-align` for `heading` and `paragraph` only (`TEXT_ALIGN_TYPES`, exported from `EditorToolbar.tsx` so the extension config and the toolbar's disabled-state check share one list). Left alignment is the *absence* of the `textAlign` attribute, not an explicit `"left"`: the extension serialises whatever value it is given, and leaving it unset keeps a fresh paragraph's HTML free of a redundant attribute.

An image aligns through its own `align` attribute on the custom node in `ResizableImageExtension.tsx` — a paragraph's `text-align` never reaches it, since the image is a block node with its own width. `align` (the `Alignment` type, shared with text since the toolbar's three buttons drive both) serialises as `data-align` plus inline `margin-left`/`margin-right` (`alignMargins()`); `alignFromLegacyStyle()` reads the alignment from the margins alone for images stored without `data-align`. `data-align` is allowlisted in the `.emerald` import's DOMPurify config (`src/lib/emeraldFormat.ts`) but not in PDF export's sanitisation — nothing there reads it, and the inline margins carry the alignment regardless.
