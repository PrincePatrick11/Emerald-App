# Editing

## Edit Mode Architecture

The main content area renders only the title and body. All metadata — tags, category, icon, cover image — is edited exclusively in the right sidebar's Properties panel. The sidebar writes directly to the relevant store; the main area subscribes to the same store fields and updates accordingly.

Unlike earlier versions, the Properties panel itself is now gated by the entry's edit state (`activeView.mode === 'edit'`): each panel renders a read-only summary (`EntryReadSections`, built from collapsible `SidebarSection`s — see [`components.md`](../components.md)) while viewing, and swaps to the same sections with editable values (`EditPropertyRow`, `PropertySelect`, `MediaPropertyRow` — see [`components.md`](../components.md)) only once the entry is opened for editing. Entering/leaving edit mode is triggered from the sidebar's own action bar, not from the main content area — there is no double-click-to-edit gesture on the entry itself; `EntryDetailFrame` has no `onEnterEditMode` prop.

## Cancel: discarding new entries and reverting autosaved edits

`ActiveView.isNew` marks an entry that was just created by a "New" action (Journal, Wiki,
Operations, Altar — every handler that calls `setActiveView({ ..., mode: 'edit' })` for a
freshly created row sets it) and never confirmed with Done. It is a session-only flag,
deliberately kept out of persisted state: `stripSessionFlags` (`src/lib/tabs.ts`) drops it
before a view is written into any history — `normalizeSavedTab` uses it when restoring tabs
from localStorage, and `pushHistory`/`normalizeSavedHistory` use it whenever a view is pushed
onto a tab's own back/forward history (see [Navigation History](navigation.md#navigation-history) below) —
all for the same reason, so that returning to the entry later (a restart, or Back) can never
make Cancel treat an entry that has lived past its creation session as still-discardable. When Cancel fires on a still-`isNew` entry, Journal, Wiki and Operations run their own Delete
handler: the entry goes to Trash with the usual undo toast, the same as any deleted entry —
whatever was typed into it is never lost outright. `AltarView`'s Cancel does the same for a
new altar, since v46 gave altars a soft delete of their own. Templates and blocks follow the rule too: "New template" / "New block" open the page with `isNew`, `useDraftPage` gets `onCancelNew` (the page's own delete), and Cancel then puts the page in the Trash with Undo instead of discarding the draft — Done keeps it as before. Tasks have no Cancel: Escape on a task that was just created and never named (`freshTaskIds` in `TasksView`, session-only) puts it in the Trash with Undo.

For an entry that *was* confirmed before, Cancel cannot simply restore "the store's current
state" — Journal, Wiki, and Operations all autosave the title/body a short
debounce after typing stops, so by the time Cancel is pressed the store already holds the
edited values. `useEntryEditor` (`src/hooks/useEntryEditor.ts`) instead captures a baseline of
the whole entry (`buildRestorePatch` — title, content and tags for Journal; Wiki and Operations
add category, icon and cover image) the moment edit mode is entered, and `restoreOnCancel()`
writes that baseline back on Cancel, together with the `updated_at` the entry had when editing
began (skipping the write if nothing changed) — the autosaves in between leave no trace in the
lists. The baseline is wider than `buildPatch` on purpose: the
Properties panel saves its fields straight to the store, so the autosave never carries them,
but Cancel takes them back along with the text — one rule, "Cancel restores the entry as it
was when editing began". The one thing Cancel does not undo is a change of type: that moves
the entry into another module, where editing continues with a fresh baseline.
Sigils need no variant of their own: since v42 they are blocks in `content`, so the
same baseline covers intention, letters, drawing and charge.

The type toggle below is the one thing outside the baseline: it writes through
`changeEntryType` the moment it's picked, the new module's view mounts in edit mode and
captures a fresh baseline, so Cancel afterwards goes back to how the entry looked right after
the move and leaves it under its new type.

The baseline outlives the view: `useEntryEditor` keeps it in a module-level map keyed by view
type and entry id, not in a ref, so looking into another tab in the middle of editing and
coming back continues the same edit — Cancel still goes back to where it began. A baseline
lives as long as some tab shows the entry in edit mode; a subscription on `uiStore` drops it
once none does, which covers Done, Cancel, Delete and closing the tab. It is memory only:
after a restart, a restored edit-mode tab starts a new baseline from what is stored.

The altar has no editor buffer to fall back on — placing, dragging, backgrounds, grid and
format all write through at once — so `store/altarEdit.ts` keeps a **snapshot** instead: the
altar's record and its placements as they were when edit mode was entered (`beginAltarEdit`,
called by `AltarView`). Cancel writes it back through `altarStore.restoreAltarSnapshot`,
including `updated_at` and the thumbnail, so the altar sits in the lists where it sat. The
write is an upsert per placement followed by a delete of what does not belong — there is no
transaction to lean on, so it is built to be repeatable: if it fails, the snapshot stays and
the next Edit and Cancel finish it. Cancel switches to read mode *first* and restores behind
it — `restoreAltarEdit` takes hold of the snapshot before its first `await`, since the change
of view would otherwise prune it while the write is still waiting. A vault switch and a
replace-mode restore drop every snapshot (`clearAltarEdits`), held ones included: the ids of
a replaced vault come back, and Cancel would write the old altar over the restored one. An Edit pressed right
after Cancel waits for that write (`beginAltarEdit`), so that it starts from a snapshot of
its own. `altarEditDirty` is what both the altar's leave guard and the
probe for background tabs ask. The snapshot has the baseline's lifetime: kept across a tab
switch, dropped once no tab shows the altar in edit mode. The title is the one field the
altar does not write at once; leaving the view without Done saves it, so that the edit can
continue in the other tab, and Cancel takes it back with the rest. Writes that run outside
the serialized chains — Done's title and thumbnail, the thumbnail taken when the view is
left — are tracked (`trackAltarWrite`), and both a new snapshot and Cancel wait for them.
Library items are not part of the snapshot: they belong to every altar. The snapshot does
record which elements were in the Trash when the edit began (`trashedItemIds`): their
placements are in no snapshot (the store hides them), so Cancel's delete leaves them alone
even if such an element came back from the Trash during the edit.

## Leaving an edit

An edit ends with Done or Cancel and nothing else. Leaving a page that is being edited *and
has changes* any other way asks first — save, discard, or keep editing — instead of silently
keeping what was typed, which is what navigating away used to do.

`store/leaveGuardStore.ts` holds the one **guard** of the page that is open: a key
(`guardKey(viewType, id)`), a title for the question, `isDirty()`, and `save`/`discard`, which
are the page's own Done and Cancel. Entries register theirs through `useEditActions` (the
views pass `guard`; dirty means the stored state differs from Cancel's baseline, an autosave
is pending, or the entry is new and unconfirmed), a block's or template's page through
`useDraftPage` (dirty means a draft exists in its draft store). `confirmLeave()` raises the
question — `LeaveGuardModal`, rendered once in `AppShell` — and runs the answer; Escape, the X
and a click beside the modal all mean "keep editing".

What asks:

- `uiStore.setActiveView`, `navigateBack`/`navigateForward` and `closeTab` run through
  `whenLeaveConfirmed`: immediately when nothing is dirty, otherwise after the answer.
  Back/Forward step from the history *as it was before the question* (`stepGuarded`), because
  Save and Discard navigate themselves (back to the list) and would otherwise shift the step
  by one.
- Closing a tab in the background that holds changes goes through `uiStore.askInTab`: it
  switches to the tab, waits for its view to register its guard (`guardRegistered` — the view
  may have to load), and asks; then the tab closes and the one it was closed from comes back.
- `lib/openEdits.ts`'s `resolveOpenEdits()` asks for every open edit in turn — the open page,
  then each background tab through the same `askInTab` — and is what a vault switch
  (`vaultStore.switchVault`) and a replace or add-vault import (`BackupPage`) call before they
  do anything. `settleBeforeExit()` adds waiting for the writes still under way
  (`drainSerialized`, `flushDrafts`) — for an update install (`UpdatesPage`) and closing the
  window (`AppShell`, Tauri's `onCloseRequested`), after which nothing gets another chance.

What does not ask: switching to another tab (the edit continues there, see the baseline
above), and Done, Cancel and Delete themselves — `useEditActions` wraps them in
`withoutLeaveGuard(key, …)`, which exempts that one page while its handler runs, not the
others.

Whether a *background* tab holds changes is answered without mounting it:
`holdsOpenEdit(view)` asks the **probes** that `draftStore` (a draft exists) and
`useEntryEditor` (the stored state differs from the baseline, or the entry is new) register.
Only a tab that does is switched to; an unchanged edit-mode tab closes without a flicker.

Whoever answers "keep editing" wants to be in the entry: the Settings and Vaults windows
close on that answer (`useCloseOnKeepEditing`, fed by the `stays` counter in
`leaveGuardStore`), whether they asked themselves or the window's close button did.
`switchVault` resolves to `false` when the user chose to keep editing. The add-vault import
asks *before* it starts and then passes `editsResolved`, so its own switch never asks again:
a second question answered "keep editing" would leave the old vault active, and the import
would fill it instead of the new one.

## Changing an entry's type

`EntryTypeField` (Journal/Wiki/Operation Properties sections, the first row — above Category,
or above the moon phase for Journal) renders the three module icons from `MODULE_LIST` filtered by
`usesBlocks` as a segmented control; picking one calls `changeEntryType(id, from, to)`
(`src/lib/entryTypeChange.ts`). Tasks and Altar have a different data model and aren't
convertible, so they get no field and no entry in `ConvertibleEntryType`.

The entry keeps its id and its row: `changeEntryType` first flushes the source view's
pending autosave (the new optional `EditActions.flush`, set via `useEditActions`'s
`flushAutoSave` — see Right Sidebar Action Bar below, needed since the store may still hold
stale content at the moment the toggle is clicked), then, serialized under the entry's write
key, runs one `UPDATE` of `type`, `entry_number` (a fresh one for the target type) and category
(`retypeRow`) — an empty title stays empty, the new type's "Untitled …" shows by itself —
rewrites every chip pointing at the id to the new `data-entry-type` across all entries —
trashed rows included, so a restored entry doesn't come back with a stale
chip — and templates (`retypeInternalLinks`, see Internal Links below), remaps the id inside
any `block_definitions` link default that targeted it (`remapDefinitionDefaults`'s resolver may
now hand back an `entryType` alongside `id`/`label`), and updates `task_links.target_type`.
Since the row never leaves its table, there is no window in which the entry exists twice or
not at all. Wiki and
Operation keep category, icon and cover image across the move; converting either to Journal
drops them (a journal entry has no category), and `typeChangeDropsProperties` tells the field to ask first via `InlineConfirm`
when any of the three is actually set.

The move leaves the content alone: a default template applies when an entry is created, never
afterwards (see [Templates](templates.md#templates)). Once the row exists under the new type,
`uiStore.retypeEntryViews(id, from, to)` rewrites every tab's `view`, every tab's history, and
the tabless history in one `set()` — no open tab is ever left pointing at a type/id pair that
briefly doesn't exist, since the row is updated and the store moved across types in one step.

## Right Sidebar Action Bar

`RightSidebar.tsx` renders a `RightSidebarActionBar` pinned above the scrollable Properties content, replacing what used to be separate Edit/Save/Cancel/Delete buttons duplicated in every entry view's header. The bar reads `uiStore.editActions` (set via `setEditActions({ onSave, onCancel, onDelete? })`) to know what to call — in edit mode it shows Done/Delete/Cancel; in view mode it shows Edit (plus a Fullscreen toggle for Altar); an entry whose loaded sigil locks the whole entry keeps the Edit button in place, disabled, with a tooltip saying why (`editor.lockedBySigil`; the tooltip sits on a wrapper `<span>`, because a disabled tone `Button` takes no pointer events).

Each of the five entry views registers its handlers through the shared `useEditActions(active, handlers)` hook (`src/hooks/useEditActions.ts`) — previously each view carried its own copy of the same ref-latched effect:

```ts
useEditActions(isEditing, { onSave: handleDone, onCancel: handleCancel, onDelete: handleDelete });
```

Inside the hook, the handlers are kept in a ref that is overwritten on every render, and the effect itself only depends on `active`: `setEditActions` only needs to run when edit mode flips, not on every keystroke, but the handlers it registers must still see the latest `title`/`content`/etc. at call time. An earlier, pre-hook version of this effect had no dependency array and called `setEditActions` unconditionally on every render, which combined with a whole-store `useUIStore()` subscription in the same component to produce an infinite render loop (each `setEditActions` call re-rendered the subscriber, which re-ran the effect, which called `setEditActions` again) and a blank screen on startup. Keep sidebar-consuming components on per-field selectors (see Store Selectors above) to avoid reintroducing it — the hook itself already scopes its effect to `[active]`.

`EditActions` gained an optional fourth handler, `flush`, alongside `onSave`/`onCancel`/`onDelete` — Journal/Wiki/Operations pass their `flushAutoSave` from `useEntryEditor`. It exists for a sidebar action that needs the *current* store row before it acts rather than whatever the last debounced autosave already wrote: `changeEntryType` (see above) calls `useUIStore.getState().editActions?.flush?.()` before reading the entry out of its store.

## List Header Portal

In list views (every module, plus Home, Categories, Tags and Blocks), `Dashboard`'s whole
header — title row, toolbar, and filter panel — lives **only** in the right sidebar; there
is no inline fallback above the list. `RightSidebar.tsx` mounts a host `<div>` and hands its
DOM node to `uiStore.listHeaderHost` through a ref callback (`setListHeaderHost`);
`SidebarPortal` (`src/components/ui/SidebarPortal.tsx`) reads the field back and, whenever it
is non-null, `createPortal`s its `children` into it — `Dashboard` renders its header through
one, and the page of a user-built block (below) renders its own sidebar content through
another; `MainArea` only ever renders one view, so at most one of the two is ever mounted at
a time. Closing the right sidebar has nothing to fall back to — the header disappears along
with the sidebar and the list gets the full height back, deliberately: `AppShell` keeps the
sidebar mounted (`inert`) for the 200ms collapse animation described above, so the header
stays visible inside it for that stretch and vanishes once `RightSidebar` actually unmounts
and its ref callback clears `listHeaderHost`.

`RightSidebar` decides whether to offer the host from `uiStore.dashboardMounted`, not from
`activeView.id`. `Dashboard` announces itself in a `useLayoutEffect`
(`setDashboardMounted(true)`/`(false)` on mount/unmount — a layout effect rather than a
passive one, so opening an entry switches the sidebar over to the action bar before the
first paint instead of a frame late) and `RightSidebar` renders the host whenever a
`Dashboard` is mounted. Guessing from `activeView.id` used to get this wrong twice: Tasks
carries an id even while showing its list (a jump target from the left list or global
search, not an open entry), and a stale id left behind by a just-deleted Journal/Wiki/
Operations entry falls back to that module's `Dashboard` too — both used to land on the
entry action bar instead, complete with a meaningless Edit button. `VIEWS_WITHOUT_ENTRIES`
(`home`/`tags`/`categories`/`blocks`) and a missing `activeView.id` still offer the host up
front too, alongside `dashboardMounted`, so it exists before a lazily-loaded list view's
chunk has finished loading and `Dashboard` has had a chance to mount. Home, Categories, Tags
and Blocks have no entries of their own, but all four go through `Dashboard` for their list
precisely so their title and primary action portal like everyone else's — Home and
Categories through `grouping: 'custom'`, Tags through `category` mode with one collapsible
group per tag, Blocks through `flat` mode. There is no placeholder text left for a view
without a dashboard, because there is no longer a view without one: opening a block (a
`{ type: 'blocks', id }` view) replaces the list with `BlockDefinitionEditor`, which portals
its own sidebar content — Done/Delete/Cancel, icon, display rules, usage — into the same
host the way `Dashboard` does, rather than falling back to a placeholder.

Invariant: exactly one writer (the host div's ref callback) and, at a time, one reader
(`SidebarPortal`, mounted by either `Dashboard` or `BlockDefinitionEditor`) — `MainArea`
only ever renders one view, so at most one thing ever portals into the host.
`listHeaderHost` deliberately isn't persisted; it's a DOM node.

`groupBy` (`{ value, onChange, label? }`) carries the grouping axis — independent of `sort`
since a session change split "group by category" out of `SortMode` into its own
`GroupingMode`; a module that has nothing to group (Altar's altars) simply omits it, and the
toolbar then shows only view and sort. `headerRight` is gone: Trash's actions go through
`primaryAction` like every other dashboard — `danger: true` renders it as the red
`btn-primary-danger`, and its confirmation swaps the button's label for the "yes" and adds
a cancel X via `extraActions`. `Dashboard`'s `toolbarExtraActions` prop and
`FilterPanelProps.extraPanelContent` slot were removed in an earlier pass — Tasks' priority
filter moved into `FilterPanel`'s own `statusChips`/`statusLabel` instead of a bespoke extra
slot.

`extraActions` (compact icon buttons right of `primaryAction`, on the same row — the
labelled button fills that row and they keep their square size beside it) and
`contentFooter` (rendered below the content in the normal, empty, and no-results states
alike) exist for a module's own secondary area rather than another module-wide pattern — so
far the Altar dashboard's library section is the only user of either, see [Altar UI
Composition](altar.md#altar-ui-composition) below.

`ListToolbar` and `FilterPanel` now have only this one, sidebar-column presentation — no
horizontal strip variant and no filter-toggle button; `FilterPanel` stands permanently
visible under the toolbar instead of behind one. Search sits on its own full-width row in
the main area next to the title (`ListSearchField`, see above), not in `ListToolbar` at all.
`ListToolbar` renders each axis under its own `SidebarGroup` heading: View is an
`IconToggleGroup` with `fill` (four modes, full-width segments); Sort is `SortSelect`
(exported from `ListToolbar.tsx`), a `FieldDropdown` with `variant="sidebar"` naming what it
sorts by and by which date ("Created · newest", "Name · A → Z" — `sortDate` picks whether
the date modes compare `created`/`updated`/`deleted`, and `sortLabel` overrides the
heading, e.g. Altar's "Sort · Altars"); Grouping is a `SwitchRow` ("Group by {label}",
`groupBy.label` lowercased via the `lowercase` i18n formatter), greyed out in Timeline.
`Dropdown` itself is unrelated to this header now, used only by `CategorySelect`, `TaskRow`'s
priority menu, and `HomeView`'s own per-section toolbar. The disabled predicate for Timeline
(`sortBlockedInTimeline` in `ListToolbar.tsx`) is unchanged: A→Z, Z→A and Category sorting
are disabled with an explanatory tooltip, since the timeline already orders its entries by
date and ignores those modes regardless of what's picked; the Grouping switch is disabled
there too, since Timeline always groups by month on its own. Choosing Timeline does not overwrite the stored sort: the select just *shows* newest first while a blocked sort is stored, and `groupByMonth` orders by date on its own (ascending only if the list already is), so the stored sort applies again when another layout is picked.

`FilterPanel` stacks, in order: `extraGroups` (controls that are neither filters nor display
toggles, e.g. the Altar library's own sort and grouping), `displayToggles` (`SwitchRow`s
under a "Display" heading — a view preference like Tasks' "Show completed" or the Altar
preview, not counted in the active-filter badge and untouched by a reset), the primary
`FilterList` (a vertical list — icon/emoji, label, count, an "All" row on top — replacing the
old horizontal filter chips), and a second `FilterList` for Tasks' priorities. There is no
"Clear all" button any more; each list's own "All" row clears it, and a "Reset filters"
button (in the shared no-results state) is the only remaining way to clear search and every
filter at once.

## Auto-Save (the `useEntryEditor` hook)

Debounced auto-save (1.5s), save-on-navigate and save-on-unmount live in
`src/hooks/useEntryEditor.ts`, used by JournalView, WikiView and
OperationsView — each of which used to carry its own ~80-line copy of the
same machinery, with quietly drifting details. The hook takes a
`buildPatch()` closure and an `update(id, patch)` action; it keeps the
latest closure in a ref, so the navigate-away save still reads the
*previous* entry's local state (the views' load effects run after the
hook's effects — the hook call sits above them in the component body).

The editor content itself is mirrored into a `pendingHtmlRef` on each
keystroke rather than into React state: a state update would re-render the
whole view per keystroke. `BlockStack`'s `initialContent` (and each
`RichEditor`'s) is consequently an **initial value only** — the old effect
that compared `editor.getHTML()` against the prop on every render (a second
full-document serialisation per keystroke) is gone. Switching entries remounts
the stack via its `key` (`` `${id}:${editorEpoch}` ``), and Cancel bumps
`editorEpoch` to remount from the restored baseline. Since the whole block
stack serialises into that one `content` string, Cancel's
baseline reverts every block change of the session — sigil blocks included, since v42.

Two guards protect these save paths: `ready` (the view's `loadedEntryId`
gate) arms the navigate/unmount saves only after local state is hydrated,
so a StrictMode double-mount in edit mode cannot write empty fields; and
`src/lib/editorLock.ts` suspends all automatic editor saves while a
replace/add-vault backup import runs — without it, the unmount triggered
by the import's own navigation would write the pre-import content over
the freshly restored rows.

## Internal Links

`createInternalLinkExtension(getItems, getIcon, getLabel)` creates a TipTap extension that renders linked entries as inline chips. Callbacks are typed via the `InternalLinkOptions` interface (no `as any` cast) and are ref-backed so they always see the current store state. Each chip stores `data-type="internalLink"`, `data-id`, `data-entry-type`, `data-label`, and `data-icon` attributes.

Chips are rendered identically in both edit mode and view mode — the `[[Label(id)]]` raw-text edit representation was removed. The node view no longer tracks `editor.isEditable` via `useState`/`useEffect`; editability checks (e.g. click handling) read `editor.isEditable` directly at event time.

The chips in `content` are the only record of what links where. Until v47 a `links` table mirrored them on every save, for a backlinks panel that was never mounted; nothing read it, and migration v47 dropped it.

**What an entry links** — Journal, Wiki and Operations' right-sidebar "Linked entries" field (`LinkedEntriesField`) — is read straight out of the same content, via `extractInternalLinks` (`src/lib/internalLinkHtml.ts`), rather than tracked as its own list. That file is deliberately `DOMParser`-free for reading (regex over the opening `<span>` tag): it sits on the database path too — migration v36 and the schema-check Node harness call it outside a browser — while writing/remapping a chip's markup (`remapInternalLinks`) does use a real `DOMParser`, since correctness there matters more than portability.

The sidebar field has no reference to the TipTap instance of whichever view happens to be open, so it talks to it through three `document`-level custom events defined in `lib/links.ts`: `requestEntryLinkAppend`/`requestEntryLinkReveal`/`requestEntryLinkRemove`, each paired with `subscribeEntryLinkRequest` on the `BlockStack` side, which routes the request to the right text block (see [Content Blocks](blocks.md#content-blocks)). A request resolves to `true` only when an editable, currently-mounted editor accepted it via `preventDefault()`; the field falls back accordingly — `reveal`, for instance, navigates to the target view instead of jumping to it in text when nothing answered. `isValidLinkTarget` guards all three (and the pre-existing navigate-on-click handler), since the events are reachable by any script in the WebView.

Appending a link (from the field, from `[[`-picker selection, or from a routine converted to a template, whose linked operations/wiki articles become the same shape — see [Templates](templates.md#templates)) always adds a full block — a horizontal rule, the target's category as an `<h3>`, then the chip — never merges into an existing block; `internalLinkBlockHtml` is the one definition of that shape, shared by the editor's `appendEntryLink`, migrations v36/v37, and `.emerald`/Markdown import's legacy-column bridge (below). Removing a link deletes that whole block if the chip is the sole content of one of these appended blocks (`removeEntryLink` checks for the preceding rule/heading before treating it as one), or just the chip if it sits inline in text the user wrote around it. Appending also jumps to the new block and briefly highlights it via `revealEntryLink`, run a frame later so the chip's node view has actually rendered — the same function the `reveal`-on-click path already used, but with its `caretAtBlockEnd` option set: appending leaves a text selection at the end of the chip's paragraph, ready to keep typing, where clicking an existing chip (`reveal`-on-click, and the field's own "jump to it" navigation) still selects the chip itself as a node, since there "this one" is the point being made. `internalLink` is an inline atom, so its parent is always a textblock — there is no other case to branch on, and the position math no longer pretends there is.

If the entry was completely empty (`<p></p>`), the block goes in without its leading horizontal rule — a rule separates the link from the text above it, and there is no text yet. `isBlankContent` (`src/lib/internalLinkHtml.ts`) decides this the same way `extractInternalLinks` decides what's a link: regex over the HTML, no `DOMParser`, since migrations v36/v37 and the schema-check Node harness need to ask the same question outside a browser. `internalLinkBlockHtml` takes a `separator` option for this, and `plainBlockHtml` renders the same shape without a chip, for a legacy value that no longer resolves to anything in this vault (see the v37 note below) — text alone rather than a dead link.

**Cross-vault import.** A link chip's `data-id` is only meaningful inside the vault it was written in. `.emerald` export now carries `meta.contentLinks` — id, entry type, and title for every chip in the exported content — so importing into a *different* vault can re-resolve each chip: by id first (same vault, or an id that happens to already match), then by the title recorded in `contentLinks`, then by the chip's own embedded `data-label` for files exported before this field existed. A chip that resolves to nothing becomes its own display text rather than a dead link (`remapInternalLinks`'s `null` case). This remap must run *before* DOMPurify, not after — it parses and re-serialises the HTML, and that round-trip is not allowed to happen on content DOMPurify has already cleared. `sanitizeImportedHtml` is therefore the *last* step of every import that writes HTML — `.emerald` (after `beforeSanitize`, where a legacy Journal entry's links are appended as chips) and Markdown alike; anything added after it would skip the filter. The creation date comes along too: `importedCreatedAt(file)` hands the file's `createdAt` to `createEntry`/`createArticle`/`createOperation`/`createAltar` (`opts.createdAt`) so an import sits at its place in the timeline; only a parseable date with a four-digit year passes (dates sort as text, and `+010000-…` would sort before 2024), anything else falls back to now. `updated_at` is always now.

**A chip's own type, rewritten in place.** `retypeInternalLinks(html, id, entryType)` (`src/lib/internalLinkHtml.ts`) sets `data-entry-type` on every chip pointing at `id` to a new value, for an entry that changed which of Journal/Wiki/Operation it is (see Edit Mode Architecture below) — the id stays the same, so only that one attribute needs to change. Like `extractInternalLinks`/`isBlankContent`, it stays regex-over-the-tag rather than `DOMParser`-based: `entryTypeChange.ts` runs it over every stored row across all three content tables plus `templates`, and a full parse-and-reserialise of each would rewrite content nobody actually touched.

**Pre-v36 legacy bridge.** Journal entries used to carry two dedicated columns, `linked_operation_ids`/`linked_wiki_ids`, shown as their own chip rows under the title. Migration v36 rewrites them into content blocks the same way described above and empties the columns (see [`database.md`](../database.md#entries)); `.emerald`/Markdown import of a file written before that migration append the same blocks instead of writing to the columns. The columns are gone since v49 (`entries` has no `linked_*` columns); import converts an older backup's values into chips row by row before inserting (`linkedIdsToContent`, `tablesLinkSource`/`rowsLinkSource` in `migrateLinkedIdsToContent.ts`), so the `legacyIds` bridge in `LinkedEntriesField`, `EntryReadSections` and `JournalPropertiesPanel` no longer exists.

**Pre-v37 legacy bridge.** Journal also used to carry three fixed properties — Paradigm, Banishing, Meditation — each a dropdown tied to one wiki article, plus a meditation-duration number field. `JournalPropertiesPanel` no longer has any of the four; migration v37 (`migrateJournalFieldsToContent.ts`) rewrites the six columns behind them into the same kind of content block, once, and clears all six. The meditation duration has no link target, so it becomes plain text appended after its chip (`"(20 min)"`, via `internalLinkBlockHtml`'s `suffix` option); `is_bannung`/`is_meditation` could be set without an article attached (the checkbox predates the dropdown), which becomes a `plainBlockHtml` text paragraph naming the category instead of vanishing outright. `.emerald`/Markdown import applies the same conversion to files written before v37, through `appendLegacyLinks`/`legacyFieldTargets` in `emeraldFormat.ts` — the one place that also decides the plain-text fallback when a referenced article doesn't exist in the importing vault. Since v49 the six columns no longer exist; a backup that still carries them is converted row by row before insert (`journalFieldsToContent`, see [`database.md`](../database.md#entries)).

## Text and Image Alignment

`RichEditor` configures `@tiptap/extension-text-align` for `heading` and `paragraph` only (the type list is `TEXT_ALIGN_TYPES`, exported from `EditorToolbar.tsx` so the extension config and the toolbar's own disabled-state check read from one list instead of two that could drift). Left alignment is deliberately the *absence* of the `textAlign` attribute rather than an explicit `"left"` value: the installed extension serialises whatever value it is given, `left` included, and leaving it unset keeps a freshly-typed paragraph's HTML free of a redundant attribute.

An image aligns through its own `align` attribute on the custom node in `ResizableImageExtension.tsx` instead — a paragraph's `text-align` never reaches it, since the image is a block node with its own width. `align` (`'left' | 'center' | 'right'`, exported as the `Alignment` type — it names both the text and the image case, since the toolbar's three buttons drive both) serialises as `data-align` plus inline `margin-left`/`margin-right` (`alignMargins()`); `alignFromLegacyStyle()` reads the alignment back out of the margins alone for images stored before `data-align` existed. `data-align` is allowlisted in the DOMPurify config for `.emerald` import (`src/lib/emeraldFormat.ts`) but deliberately not for PDF export's sanitisation — nothing in that path reads the attribute, and alignment survives PDF export through the inline margins regardless.
