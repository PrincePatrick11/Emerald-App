# Modules, Stores and Shared Data

## Module Registry

`src/lib/modules.ts` is the one source of truth for "which modules exist and what belongs to
each" — icon, nav-label key, untitled-placeholder key (a tab's and the title input's placeholder — everywhere else `displayTitle` picks the text, see "Titles and icons" below), the module's `ContentType`, and whether
it uses the right sidebar's editor action bar. `ModuleMeta.entryType` is non-null for all five
modules: Tasks and Altar are link *targets* (`'task'`/`'altar'` in `ContentType`) even though,
lacking an editor of their own, they can never be a link's *source*. `ENTRY_MODULE_IDS` (`journal`/`tasks`/`operations`/`wiki`/`altar`) is the canonical
order — it drives the rail's icon order, the entry list's tab order and, through the derived
`CATEGORY_MODULE_IDS` (the same minus `journal`), the order of the per-module usage columns
in `CategoriesView`. `MODULES` is the
`Record<EntryModuleId, ModuleMeta>` everything else reads; `MODULE_LIST` is its array form for
loops. `ViewId` (`EntryModuleId | AuxViewId`, where `AuxViewId` is `home`/`tags`/`categories`/
`blocks`/`templates`/`lexicon`/`trash`) is
what `ActiveView['type']` actually is — replacing an ad-hoc union that, via `ContentType`, used
to also admit `'operation'` (singular), a value no view ever had. `isViewId()` guards
persisted tabs at load time, so a localStorage entry from a since-removed view type is dropped
rather than crashing the router. `TRASH_KINDS`/`TRASH_KIND_ICONS` cover the (larger) set of
trash-only kinds, including `category` — the one global category list (see
[Categories](#categories) below) is an aux view rather than a module, so it has no
`ModuleMeta`, unlike the four per-module category kinds it replaced; `AUX_VIEWS.categories`
deliberately reuses `TRASH_KIND_ICONS.category`'s `FolderOpen` glyph, so a trashed category
and the view that manages it read as the same thing.

`viewTypeForEntryType(entryType)` lives here too (moved from `lib/tabs.ts`, which now holds
only tab ids and `isContentView`) — the one place translating the data model's `operation`
(singular; what `links.target_type`, drag payloads, and the internal-link mark all carry) into
`ActiveView`'s `operations` (plural, named after the module). It is now a reverse lookup over
`MODULES` instead of its own copy of the mapping, so `ModuleMeta.entryType` is the single
source both directions read.

**Titles and icons.** Two small rules live beside the registry so that no list decides them for itself. `src/lib/entryTitle.ts`: a new journal entry, article, operation, task or altar is stored with an **empty** title, and `displayTitle(t, type, title)` shows the translated "Untitled …" of that `ContentType` wherever a title is displayed — lists, cards, the left list, tabs, search, the Trash, link chips and pickers, task links, the detail heading, template usage, tag lists, drag labels and exports (an altar image or PDF export names its file and heading that way too). `hasOwnTitle(title)` is the one test for "has a title of its own" — template takeover (`mayTakeTemplateTitle`), `startOfNewEntry`, a type change and the tab bar use it instead of comparing against the old English default (`UNTITLED_TITLES` is gone). `isLegacyUntitled` and `LEGACY_UNTITLED_TITLES` recognise those old defaults, and only where data comes in: migration v48, `.emeralddb`, `.emerald` and Markdown import (`importedTitle` in `emeraldFormat.ts` also turns the app-language "Untitled …" a Markdown/PDF export writes for an empty title back into an empty one). Anything typed later is a title, whatever it says. Renaming starts from the *stored* title, not the display text: `EntryListTab` takes an optional `getEditTitle` for that (so Enter on an untitled row cannot save the translated placeholder), and Home's inline rename and the task row do the same. `entryIcon(type, entry, category)` in `modules.ts` is the one icon rule for a wiki article or operation in Home, lists, the left list, link chips and exports: its own icon (emoji or image), else its category's emoji, else the module's `DEFAULT_ENTRY_EMOJI`. A journal entry shows its moon phase instead.

A second, smaller registry sits in `src/components/editor/SuggestionList.tsx` —
`ENTRY_TYPE_ICONS`, `DEFAULT_ENTRY_EMOJI`, and `ENTRY_TYPE_LABEL_KEYS`, each keyed by
`ContentType` (link type) rather than `EntryModuleId`/`ViewId` (view type). It is deliberately
not folded into `MODULES`: the icon a link chip shows, the emoji fallback when neither a
custom icon nor a category emoji applies, and a link picker tab's label are all keyed by what
a link points *at*, which for Journal is a moon-phase emoji rather than the module's own
`BookOpen` icon — a concern `ModuleMeta` has no field for and that would only muddy it.
`LinkPickerModal`, `InternalLinkExtension`, `RichEditor`'s `[[` suggestion popup, and
`export.ts`'s icon resolution all read from this registry instead of repeating the mapping.

This file's import rule is deliberately narrow: only `lucide-react` and type-only imports (its
edge to `types/index.ts` runs both ways, but only as `import type`, which disappears at
compile time — a runtime import either direction would create a real cycle). No stores, no
React components. Two thinner layers build on top of it, kept separate so this file itself
stays free of both:

- **`src/store/moduleWiring.ts`** — the store-layer half. `moduleWiring` maps each
  `EntryModuleId` to its store's reload function; `trashWiring` maps each `TrashKind` to its
  restore/permanently-delete pair (`category` now goes to `categoryStore`, `template` to
  `templateStore`, `language` to `lexiconStore`, see [Categories](#categories),
  [Templates](templates.md#templates) and [Lexicon](#lexicon) below).
  `reloadAllStores()` is the canonical startup/vault-switch reload sequence — tags, categories,
  `block_definitions`, `templates` and the lexicon in parallel, then every module's content — replacing
  three hand-maintained copies of the same list that used to live in `vaultStore`, `dbBackup`,
  and `AppShell`. The sequencing is deliberate, not a hard data dependency: no fetcher reads
  another store, but loading tags/categories/blocks/templates first means a list never renders a
  frame with unresolved category or tag names, and a new entry never starts before its default
  template could be resolved. `reloadModules(ids)` reloads a targeted subset (used by the
  Emerald-format import, to reload only the modules the import touched) but always refetches
  `categories`, `block_definitions`, `templates` and the lexicon too, since an import can create
  new ones.
  Import rule: content stores only (`entry`/`task`/`altar`/`tag`/
  `category`/`blockDefinition`/`template`/`lexicon`) — never `uiStore`, `vaultStore`, or `trashStore`,
  which point at this module instead.
- **`src/components/layout/moduleViews.ts`** — the component-layer half. `VIEW_COMPONENTS` maps
  every `ViewId` to its `React.lazy` view. Import rule: **only `MainArea` may import this
  file** — any other importer risks pulling every view's lazy chunk (including TipTap, via
  Journal/Wiki/Operations) into its own bundle.

Consumers read the registry instead of repeating it: `LeftSidebarRail` loops `MODULE_LIST` for
its module icons; `LeftSidebarEntryList` builds its `TABS`/`TAB_LISTS` from it; `RightSidebar`
builds its `PROPERTIES_PANELS` record from it; `TabBar` reads it for fallback titles and icons;
`TrashView` reads `TRASH_KIND_ICONS`; `SearchResultList` builds its `KIND_META` record from
it; `uiStore` reads it for `LeftListTabId` and the `usesEditorSidebar` flag and uses `isViewId`
as a load-time guard; and `TasksView`'s former `typeMap` + `as any` cast is gone in favour of
calling `viewTypeForEntryType` directly.

## Entry Store

Journal entries, wiki articles and operations live in one Zustand store, `useEntryStore` (`src/store/entryStore.ts`), over the one `entries` table (see [`database.md`](../database.md#entries)); it replaced `journalStore`, `wikiStore` and `operationStore`, which had the same actions three times. The type is `Entry` (with a `type: EntryType`, `'journal' | 'wiki' | 'operation'`, both in `types/index.ts`) instead of `JournalEntry`/`WikiArticle`/`Operation`; `TemplateEntryType` is `EntryType` and `TaggedType` is `EntryType | 'template'`.

- **State:** `entries: Record<EntryType, Entry[]>` — one array per type, in the order rules each module had before (so a selector for one module re-renders on that module's changes only).
- **Actions:** `createEntry(type, { categoryId, blank, createdAt })`, `updateEntry`, `duplicateEntry`, `deleteEntry`, `restoreEntry`, `permanentlyDeleteEntry`, `getEntry(id, type?)`; `ENTRY_TYPES`, `allEntries`, `findEntry(entries, id, type?)`, `mapEntries` and `withAddedEntry` are the helpers for code that has to walk or patch all three lists (block copies, tag renames, category reassignment, the trash).
- **Write serialization** uses one key domain, `'entry'`, per entry id — not per type — so a type change and an autosave of the same entry queue behind each other.
- `lib/modules.ts`'s `entryTypeForView` maps a view (`journal`/`wiki`/`operations`) to its `EntryType`. `TabBar` and `RightSidebar` subscribe to one selector; the link chip's icon/label in `RichEditor` and the link titles in `TasksView` come from `useLinkItems`/`linkItemsByKey` instead of reading the stores themselves; `moduleWiring` reloads entries once for all three modules.

## Moon Phase

A journal entry's moon phase is not stored: `entryMoonPhase(createdAt)` / `journalIcon` in `src/lib/moonPhase.ts` derive it from `created_at`. The vault setting `journal.moonPhase` means "show it on journal entries" and works retroactively; with it off `JournalView` has no phase filter and no grouping by phase, and the "no moon phase" chip no longer exists. The setting keys are `moonPhaseShow`/`moonPhaseShowHint` in all four locales.

## Store Selectors

Every component subscribes to individual store fields, never the whole store:

```ts
// correct — single field
const entries = useEntryStore((s) => s.entries.journal);

// correct — several fields at once, shallow-compared
const { entries, createEntry } = useEntryStore(
  useShallow((s) => ({ entries: s.entries.journal, createEntry: s.createEntry }))
);

// wrong — re-renders on any store change
const store = useEntryStore();
```

This prevents unnecessary re-renders when unrelated fields change — a whole-store subscription in a permanently mounted component (sidebar, tab bar) re-renders it on every keystroke that touches the same store. The `useShallow` form (from `zustand/shallow`) is the way to pull several fields in one call; a plain object selector without it would defeat the purpose, since the fresh object fails the identity check every time. `RoutinesPanel`, the codebase's one remaining whole-store subscription, was removed along with routines rather than fixed.

## Rules of Hooks

All `useState`, `useEffect`, `useRef`, `useMemo`, and `useCallback` calls must appear before any early `return` statement in a component. Hooks placed after a conditional return crash the app with a "rendered fewer hooks than expected" error. Move the hook above the condition and use the condition inside the hook's callback if needed.

## Categories

Since v38, Wiki, Operations, Tasks, and Altar items share one category list (Wiki and Operations are `entries` rows since v49) — `useCategoryStore` (`src/store/categoryStore.ts`), backed by the single `categories` table (see [`database.md`](../database.md#categories)). Since v39 an entry's `category_id` may be `NULL`: having no category is the state a new entry starts in, and the one place that state is called something is the "Uncategorized" bucket, which also collects entries whose category has been moved to Trash — for the reader the two are the same thing. `lookupCategory(byId, id)` in `lib/categories.ts` is the one way to resolve a possibly-null id against a map or record; `categoryLabel` already accepted `null`. Before v38, each of the four modules carried its own store slice with the same five actions duplicated four times; that duplication is gone. Journal is not part of this — it groups by moon phase, not by category. Import rule: `categoryStore` may import the content stores (it reassigns their in-memory rows when a category is permanently deleted); none of them import it back. All cross-store access goes through `getState()` at call time, never at import time.

- **`useCategoryStore`** holds `categories: Category[]` (active only, ordered by `sort_order`) and `fetchCategories`/`addCategory`/`updateCategory`/`deleteCategory` (soft, rejects builtins)/`restoreCategory`/`permanentlyDeleteCategory`/`reorderCategories`/`getCategory`. `addCategory`/`updateCategory` reject a duplicate name via `categoryKey` (trim + lowercase, `src/lib/categoryMerge.ts` — the same comparison the v38 migration and the backup import use) by throwing `CATEGORY_NAME_TAKEN`. `addCategory` appends new categories to the end. Until v39 it slipped them in before the fallback `other` so that row stayed last; now that `other` is an ordinary category, there is nothing to keep last, and the order belongs to the user anyway (drag in `CategoriesView`). **A name belongs to one category** — the same rule as for tags: `addCategory` with the name of a trashed category restores that one (with whatever still points at it) and gives it the chosen emoji, rather than creating a second; `restoreCategory` into a name a live category took in the meantime merges into it, and so does `updateCategory` when a category is renamed to the name of one in the Trash (`mergeCategory`): `reassignCategoryContent(db, from, to)` moves the content over, the row goes, and the templates' assignments move to the survivor (a star only where no active template already has one for that type; see database.md), after which `templateStore` reloads. Otherwise a restored category goes to the end of the list rather than its old position. `permanentlyDeleteCategory` calls `reassignCategoryContent` (see database.md), which sets the affected content's `category_id` to `NULL`, then also `reassignCategoriesInMemory` — the same change applied to the already-loaded content stores' in-memory rows, so a later `update*` on one of them can't try to write back a `category_id` the foreign key would now reject. `trashStore.emptyTrash` calls the same in-memory helper for the same reason.
- **`CategoriesView`** (`src/components/views/CategoriesView.tsx`, the `categories` aux view) is the **one** place categories are managed: add, rename, change emoji, delete (no question) plus undo, drag-to-reorder, and a per-module usage count on every row. The four module dashboards only *assign* (`CategorySelect` in the properties panels, the task row, `AltarItemModal`) and group by category; none of them can create, rename or delete one any more. That replaced five scattered surfaces — a "+ Category" button in each of the four dashboards, a pencil and a delete button in every category group header, and the Altar strip's own pencil and "+ Category". Builtins (`other`, `sigils`) render without the edit and delete buttons — their action slot stays reserved, or their count columns would fall out of line with every other row — but stay draggable, since `reorderCategories` accepts any id. The view runs on `Dashboard` for its header but renders its list through `grouping: 'custom'` with no sort axis: a sort control over a list whose order *is* the user's hand-dragged `sort_order` would contradict itself. Consequence worth knowing: a freshly created category holds nothing, so it appears in no module until an entry points at it — deliberate, and why `categoriesUsedBy` no longer takes a "keep this one anyway" argument.
- **`CategorySelect`** carries an "Uncategorized" entry at the top of its list — since v39 a real value (`null`), not just the trigger's text for a category that no longer resolves. It is what a new entry shows, and choosing it clears an assignment.
- **`lib/categories.ts`**: `categoryLabel(t, cat)` is the one display-name rule for all four modules — a builtin (`other`/`sigils`) is named via `categories.builtin.<id>` in the active locale, everything else via its stored `name`. `categoriesUsedBy(all, items)` returns the categories a view should actually render as chips/groups/tabs: every category at least one item points at, plus the fallback. `categoryUsageCounts(sources)` counts in one pass per list how many entries of each module point at each category, and `dominantCategoryModule(usage)` picks the largest — one truth for `CategoriesView`'s count columns and for the module hint the global search puts beside a category hit, so a fifth categorized module cannot make the two disagree. The rest of the file (`legacyCategoryLabel`, `legacyBuiltinLabelKey`, `legacyDisplayName`, `legacyWikiCategoryEmoji`) exists only for migrations v36–v38 and for importing files/backups written before v38, resolving an old per-module builtin id or name back to a display name; nothing in the live UI reads it.
- Dragging an entry out of the left sidebar's entry list (`setDragItem` in `src/lib/dragState.ts`, read by the editor's drop indicator in `RichEditor.tsx`) carries the source category's **emoji** in its `category` field for every module now. Wiki's drag payload used to carry the raw `category_id` string there instead of resolving it to an emoji first — the drop indicator would have shown an id, not an icon; Tasks and the others already resolved it correctly, and Wiki now goes through the same `catById[...]?.emoji` lookup.
- **Altar-specific fallout:** `altarStore` no longer carries a `categories` slice or its own five category actions — it reads `useCategoryStore` like every other module now. Whether a placed item should flicker like a candle no longer depends on the builtin Altar category `candle` (that category is an ordinary, renameable/deletable row since v38); `isCandleEmoji(emoji)` in `altarConstants.ts` checks the item's own emoji (`🕯️`, with or without the variation selector) instead. The Altar tab strip does not reorder categories any more: it shows only the categories that hold an altar item, so a drag there would have rearranged a subset of the app-wide order. Ordering happens in `CategoriesView` only, which shows every category and writes the order it renders.

## Tags

Since v53 entries and templates store tag **ids** (`tags: string[]`); the `tags` table (`useTagStore`, `src/store/tagStore.ts`) holds name and colour. Four lists carry ids: the three entry types and templates (a template has no tag editor of its own in `TagsView` — see below — but passes its tags on to whatever entry it fills in). Tasks carry none (`TaggedType` has no `task`; `tasks.tags` was dropped in v50). The store holds only live tags, and an id that is not among them is shown nowhere: `useTagMap()` (live tags by id), `visibleTags(ids, byId)` (what `TagInput`, the template dialog and the lists render) and `liveTagNames(ids)` (what the `.emerald`, Markdown and HTML exports write — files still carry names) are the read side. `lib/tagRefs.ts` (DOM- and store-free, so `scripts/schema-check.mjs` can run it) is the write side for every list at once: `rewriteTagRefs` walks `entries` and `templates` including the Trash without stamping `updated_at`, `stripTagIds`/`replaceTagId` are its two uses, and `tagStore`'s `rewriteRefs` applies the result to the entry and template stores in memory.

- **`updateTag`** — a rename touches only the `tags` row; the entries carry the id and do not change. A name another live tag already has (case-insensitive) throws `TAG_NAME_TAKEN` — checked before the `serialized` chain, which would otherwise log the expected rejection as an error.
- **`deleteTag(id)`** (soft) only stamps `deleted_at`: every entry keeps the id, the tag is merely invisible until **`restoreTag`** brings it back. If a live tag of the same name (case-insensitive) appeared in the meantime, `restoreTag` merges into it — `replaceTagId` puts the live tag's id in every list and the trashed row is dropped — rather than leaving two. **`permanentlyDeleteTag`** and **`purgeTrashedTags`** (used by `emptyTrash`) strip the ids from every list before deleting the rows; the retention purge does the same in `runPeriodicCleanup`.
- **`createTag`** is `ensureTag` for the Tags view: it throws `TAG_NAME_TAKEN` instead of silently returning the existing tag. Both run through one `serialized` key, so a double-fired create of the same name finds the first one's tag instead of failing on `UNIQUE`.

Names are compared case-insensitively everywhere (`tagNameKey`, trim + lowercase); `TagInput` and the `.emerald`/Markdown import (`ensureTagIds`) store the id `ensureTag` returns. `tags.name` is `UNIQUE` across trashed rows as well, and **a name belongs to one tag**: creating a name a trashed tag carries — typed or from an import — brings that tag back with its colour and spelling (`reviveTrashedNamesake`), but first strips its id from the entries that still carried it: whoever gives the name now means this one entry, not the ones from back then. `createTag` with an explicit colour applies it. Renaming onto a trashed tag's name takes the name over: the trashed namesake is deleted for good (ids stripped first) — its entries do not get the name back. Categories follow the same rule, with one difference: a rename onto a trashed namesake merges it in and its entries come along (see Categories below). An entry or template **restored from the Trash** drops the ids of tags that no longer exist at all (`dropUnknownTagIds`, called from `trashWiring` through `withLiveTags`); the ids of trashed tags stay, since they can come back. `runPeriodicCleanup` sweeps dangling ids on every vault open as a backstop (see [`database.md`](../database.md#migration-model)).

**`tags.createInline` governs every way a new tag can appear.** Off, the tag field accepts only existing tags and a `.emerald` import keeps only the names that already are tags (`ensureTagIds`); on, both create what's missing. A template carries ids, so it never creates a tag: `usableTemplateTags(ids)` (`lib/templateTags.ts`, fed by `tagStore` via `registerTagLookup` to avoid the import cycle) hands over only its live tags — a trashed one stays in the template but goes into no new entry. A `.emeralddb` backup is a restore, not an import of content, and always brings its tags (resolved by id, then name — see [`database.md`](../database.md#db-backup--restore-emeralddb)). `drafts.json` moved to version 2 with v53: a version-1 file's template drafts carry tag names, which `draftStore` maps onto this vault's tag ids when reading (a name without a tag drops out).

**Tasks in the Trash.** `deleteTask` stamps the task and every descendant with the *same* `deleted_at` and deletes no `task_links` row; that shared stamp is how the rest tells "went together" from "was deleted earlier on its own". `selectTrashedTaskRoots` (`taskStore.ts`, used by `trashStore.fetchTrashed`) lists only the tasks whose parent is not in the Trash with the same stamp, so one deletion is one Trash item. `restoreTask` restores the task and the descendants carrying its stamp (`selectTrashedSubtree`, a recursive query on the database — the store only knows active tasks), moves the task to the top level if its parent is still in the Trash (a child under an invisible parent would stay invisible), and reloads tasks and links; on a task that is already back it does nothing, so a second Undo is harmless. `permanentlyDeleteTask` takes *every* trashed descendant, including those that went earlier on their own, since without their parent they would surface as roots. `taskStore` holds only the links of tasks outside the Trash (`selectLiveLinks`); `addLink` ignores a link that exists (the table's `UNIQUE` would otherwise fail in the background).

**`TagsView`** is a `Dashboard` in `category` mode with one group per tag. The header (title, "New tag", search, sort A→Z/Z→A/most used via `sortModes` and `count_desc`, a module filter) portals into the right sidebar like every module's. Groups start **collapsed** (`useCollapsedSet('tags', { defaultCollapsed: true })`): the list of headers — colour dot, name, `ModuleCounts` per module, or "unused" ("only in templates" when just a template carries the tag) — is the overview, and expanding one lists its entries from Journal, Operations and Wiki (`TAG_MODULE_IDS` — no Tasks, no Altar; templates carry tags too (and are counted for "only in templates"), but are not openable entries here — the same position routines held before they became templates). Tags are managed in their header, like categories in `CategoriesView`: the dot opens the palette, always-visible pencil/trash buttons and the context menu rename (inline `TagEditRow`, whose dot picks the colour too — creating uses the same row, preset to a random colour) and delete (no question, then undo). Unused tags stay visible via `keepEmptyGroups`, except while a search or module filter narrows the list. A search matching only entry titles shows the tag with just those entries and forces it open. Collapse keys are tag ids, so a renamed tag stays open.

## Lexicon

The Lexicon (rail, between Wiki and Altar) is a module without entries: it holds **languages** you keep
yourself — Enochian, runes, one you made up — and translates a text with them. It reaches no
network — the app's typefaces ship with it and its CSP allows no remote origin (see
[`security.md`](../security.md#content-security-policy)). What a language does not know stays
untranslated and is marked as such, because a word list cannot guess and pretending otherwise
would be the worse answer.

**Two tables, one store.** `languages` and `lexicon_entries` (migration v45, see
[`database.md`](../database.md#languages)) are both read by `lexiconStore`: every view needs both at
once — the dashboard counts the words, the language page lists them, the translate field reads
them. `lexiconRows.ts` holds the raw row access the store and the backup import share, the same
split `blockDefinitionRows.ts`/`templateRows.ts` already follow.

**Saving is immediate.** A vocabulary row is a pair of fields, not a draft: every field writes
when it loses focus, the alphabet the same, the name after a short typing pause. The language
page therefore has no `useDraftPage` and no "Done" — there is nothing to take back. It does sit
on the same `LibraryPageFrame` as the block and template pages, which is why that component now
splits what it owns from what the page brings: the shell (back link, name as title,
scrolling body, the sidebar portal) is the frame's, and what stands in the sidebar's action bar is
the page's. A draft page passes `draft` and gets "Unsaved" plus Done/Delete/Cancel; the language
page passes its own `actions` — back to the list, and delete. `lexicon` is in `LIBRARY_VIEW_IDS`
like the other two, since all three things that list actually governs apply: `{ type, id }` is a
page, it gets its own tab (with the language's own name and icon, like a block's or a
template's), and it opens the right sidebar.

A language is **not** exportable as a single `.emerald` file the way a template is. That format
carries a block stack; a language is two tables and an alphabet, and there is nothing in it a
`.emerald` importer could put anywhere. Backups carry it instead (see
[`database.md`](../database.md#db-backup--restore-emeralddb)).

**Translating** lives in `src/lib/lexicon.ts`, free of stores and i18n like the rest of `lib/`:

- **Words.** The text is split into words and everything between them; both survive into the
  result, so a translated invocation keeps its shape. Each word is looked up in the direction
  chosen — `toLanguage` matches `translation` and yields `term`, `fromLanguage` the other way —
  and a multi-word left-hand side is matched as a phrase, longest first. Only whitespace *within
  a line* may stand between its words: a phrase replaces everything it spans, so one that reached
  across a line break would swallow it and the text would come back a line shorter than it went
  in. The first matching row wins (the one with the lower `sort_order`), and the source word's
  capitalisation is carried over (ALL CAPS, First letter).
- **Characters.** `transliterate` rewrites character by character against the language's
  alphabet, longest run first — which is the whole reason the table is sorted that way: with `t`
  ahead of `th`, `th` would never be found. Anything not in the table stays as it is. Only a pair
  with both sides filled takes part (`isUsablePair`); a half-filled one is still *stored*
  (`isFilledPair`), so a side you mean to add later is not thrown away behind your back.
- **Both** (the default) is words first, then the alphabet for whatever the word list did not
  know. A word that comes back unchanged from both is reported as unknown — the result shows it
  dotted-underlined, and the line below counts them.

**The translate field is not on a language's page** but under the language list
(`Dashboard`'s `contentFooter`, like the Altar library under the altars): it picks its language
itself and works with all of them, so it belongs beside the list rather than inside one row.

**Search and trash.** A language and every single word are in the global search (`SearchKind`
`language`/`lexiconEntry`); a word has no page of its own and its hit opens the language holding
it, carried in `SearchHit.languageId`. Deleting a language is a soft delete with an undo toast —
its words stay attached and come back with it; permanently deleting it takes them along through
`ON DELETE CASCADE`.
