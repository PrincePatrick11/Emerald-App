# Modules, Stores and Shared Data

## Module Registry

`src/lib/modules.ts` is the one source of truth for "which modules exist and what belongs to each": icon, nav-label key, untitled-placeholder key (for a tab and the title input — everywhere else `displayTitle` picks the text, see "Titles and icons" below), the module's `ContentType`, and the `usesEditorSidebar`/`usesBlocks` flags.

- `ModuleMeta.entryType` is non-null for all five modules: Tasks and Altar are link *targets* (`'task'`/`'altar'`) even though, lacking an editor, they can never be a link's *source*.
- `ENTRY_MODULE_IDS` (`journal`/`tasks`/`operations`/`wiki`/`altar`) is the canonical order. It drives the rail's icon order, the entry list's tab order and, through `CATEGORY_MODULE_IDS` (the same minus `journal`), the usage columns in `CategoriesView` and the module hint `dominantCategoryModule` gives a category search hit.
- `MODULES` is the `Record<EntryModuleId, ModuleMeta>` everything reads; `MODULE_LIST` is its array form.
- `ViewId` (`EntryModuleId | AuxViewId`, with `AuxViewId` = `home`/`tags`/`categories`/`blocks`/ `templates`/`lexicon`/`trash`) is what `ActiveView['type']` is. `isViewId()` guards persisted tabs at load time, so a stored tab of an unknown view type is dropped rather than crashing the router.
- `TRASH_KINDS`/`TRASH_KIND_ICONS` cover the larger set of trash-only kinds, including `category`, whose `FolderOpen` glyph `AUX_VIEWS.categories` reuses.

`viewTypeForEntryType(entryType)` is the one place translating the data model's `operation` (singular — what `links.target_type`, drag payloads and the internal-link mark carry) into `ActiveView`'s `operations` (plural). It is a reverse lookup over `MODULES`, so `ModuleMeta.entryType` is the single source; `entryTypeForView` maps the other way.

**Titles and icons.** Two small rules live beside the registry so that no list decides them for itself:

- `src/lib/entryTitle.ts`: new entries, tasks and altars are stored with an **empty** title, and `displayTitle(t, type, title)` shows the translated "Untitled …" wherever a title is displayed. `hasOwnTitle(title)` is the one test for "has a title of its own". `isLegacyUntitled` recognises the old English defaults, only where data comes in (migration v48, `.emeralddb`, `.emerald` and Markdown import); anything typed later is a title, whatever it says. Renaming starts from the *stored* title (`EntryListTab`'s `getEditTitle`), so Enter on an untitled row cannot save the placeholder.
- `entryIcon(type, entry, category)` in `modules.ts` is the one icon rule for a wiki article or operation: its own icon (emoji or image), else its category's emoji, else the module's `DEFAULT_ENTRY_EMOJI`. A journal entry shows its moon phase instead.

A second, smaller registry sits in `src/components/editor/SuggestionList.tsx` — `ENTRY_TYPE_ICONS` and `ENTRY_TYPE_LABEL_KEYS`, keyed by `ContentType` (what a link points *at*) rather than `ViewId`. It is deliberately not folded into `MODULES`, which has no field for that concern.

`modules.ts` imports only `lucide-react` and types (its edge to `types/index.ts` runs both ways, but only as `import type` — a runtime import either direction would be a real cycle). No stores, no React components. Two thinner layers build on top of it:

- **`src/store/moduleWiring.ts`** — the store-layer half. `moduleWiring` maps each `EntryModuleId` to its store's reload function; `trashWiring` maps each `TrashKind` to its restore/permanently-delete pair.
  - `reloadAllStores()` is the startup/vault-switch reload: tags, categories, `block_definitions`, `templates` and the lexicon in parallel, then every module's content. No fetcher reads another store, but loading those first means a list never renders a frame with unresolved category or tag names, and a new entry never starts before its default template could be resolved.
  - `reloadModules(ids)` reloads a subset (the Emerald-format import) but always refetches the first group too, since an import can create new ones.
  - Import rule: content stores only (`entry`/`task`/`altar`/`tag`/`category`/ `blockDefinition`/`template`/`lexicon`) — never `uiStore`, `vaultStore` or `trashStore`, which import this module instead.
- **`src/components/layout/moduleViews.ts`** — the component-layer half. `VIEW_COMPONENTS` maps every `ViewId` to its `React.lazy` view. Import rule: **only `MainArea` may import this file** — any other importer risks pulling every view's lazy chunk (including TipTap) into its own bundle.

## Entry Store

Journal entries, wiki articles and operations live in one Zustand store, `useEntryStore` (`src/store/entryStore.ts`), over the one `entries` table (see [`database.md`](../database.md#entries)). The type is `Entry` with `type: EntryType` (`'journal' | 'wiki' | 'operation'`, `types/index.ts`); `TemplateEntryType` (`lib/blocks/templates.ts`) is `EntryType`, and `TaggedType` (`tagStore.ts`) is `EntryType | 'template'`.

- **State:** `entries: Record<EntryType, Entry[]>` — one array per type, so a selector for one module re-renders on that module's changes only.
- **Loading in two stages:** `fetchEntries` selects every column but `content` and lists each entry in `pendingContent`, so lists and dashboards stand at once; `content` follows in the background in chunks of 1000 (`loadAllContent`, one retry), filled in only where an entry is still pending. Until then a pending entry's `content` is `''`. A single entry is loaded at once by `ensureEntryContent(id)` — the views do that through `useEntryContentReady` and mount `BlockStack` only with real content. Anything that walks all contents (block-copy rewrites, the Blocks view's delete prompt) awaits `whenEntryContentLoaded()`; anything that reads one entry it did not open (duplicate, save as template, type change, export of the open entry right after start) calls `ensureEntryContent` first. `updateEntry` never writes `content` for a pending entry. `fetchEntries({ keepLoaded: true })` — only after an `.emerald` import (`reloadModules`), which wrote through the store — keeps the content already loaded; a vault switch or backup import reloads everything. Code that writes other entries' content directly (type change's link rewrite) takes their ids out of `pendingContent` with `withoutIds`, so the background load cannot put back its older copy.
- **Actions:** `createEntry(type, { categoryId, blank, createdAt })`, `updateEntry`, `duplicateEntry`, `deleteEntry`, `restoreEntry`, `permanentlyDeleteEntry`, `getEntry(id, type?)`. `allEntries`, `findEntry(entries, id, type?)`, `mapEntries` and `withAddedEntry` are the helpers for code that walks or patches all three lists (block copies, tag changes, category reassignment, the Trash).
- **Write serialization** uses one key domain, `'entry'`, per entry id — not per type — so a type change and an autosave of the same entry queue behind each other.
- `TabBar` and `RightSidebar` find the entry via `entryTypeForView`; link chips and link titles come from `useLinkItems`/`linkItemsByKey` instead of reading the stores themselves; `moduleWiring` reloads entries once for all three modules.

## Moon Phase

A journal entry's moon phase is not stored: `entryMoonPhase(createdAt)` / `journalIcon` in `src/lib/moonPhase.ts` derive it from `created_at`. The vault setting `journal.moonPhase` means "show it on journal entries" and works retroactively; with it off, `JournalView` has no phase filter and no grouping by phase. The setting's locale keys are `moonPhaseShow`/`moonPhaseShowHint`.

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

A whole-store subscription in a permanently mounted component (sidebar, tab bar) re-renders it on every keystroke that touches the same store. `useShallow` (from `zustand/shallow`) is the way to pull several fields in one call; a plain object selector without it fails the identity check every time.

## Rules of Hooks

All `useState`, `useEffect`, `useRef`, `useMemo`, and `useCallback` calls must appear before any early `return` statement in a component. Hooks placed after a conditional return crash the app with a "rendered fewer hooks than expected" error. Move the hook above the condition and use the condition inside the hook's callback if needed.

## Categories

Wiki, Operations, Tasks and Altar items share one category list — `useCategoryStore` (`src/store/categoryStore.ts`), backed by the single `categories` table (see [`database.md`](../database.md#categories)). Journal is not part of this; it groups by moon phase.

An entry's `category_id` may be `NULL`: no category is the state a new entry starts in. The "Uncategorized" bucket shows it, and also collects entries whose category is in the Trash — for the reader the two are the same thing. `lookupCategory(byId, id)` in `lib/categories.ts` resolves a possibly-null id; `categoryLabel` accepts `null`.

Import rule: `categoryStore` may import the content stores (it reassigns their in-memory rows when a category is permanently deleted); none of them import it back. Cross-store access goes through `getState()` at call time, never at import time.

- **`useCategoryStore`** holds `categories: Category[]` (active only, ordered by `sort_order`) and `fetchCategories`/`addCategory`/`updateCategory`/`deleteCategory` (soft, rejects builtins)/`restoreCategory`/`permanentlyDeleteCategory`/`reorderCategories`/`getCategory`.
  - `addCategory`/`updateCategory` reject a duplicate name via `categoryKey` (trim + lowercase, `lib/categoryMerge.ts`, shared with migration v38 and the backup import) by throwing `CATEGORY_NAME_TAKEN`. `addCategory` appends to the end; the order belongs to the user.
  - **A name belongs to one category**, as with tags. `addCategory` with a trashed category's name restores that one and gives it the chosen emoji. `restoreCategory` into a name a live category took meanwhile, and `updateCategory` onto a trashed category's name, merge the two (`mergeCategory`): `reassignCategoryContent` moves the content over, the templates' assignments move to the survivor (see database.md), and `templateStore` reloads.
  - `permanentlyDeleteCategory` sets the content's `category_id` to `NULL` (`reassignCategoryContent`), then applies the same change to the loaded stores' rows (`reassignCategoriesInMemory`, also called by `trashStore.emptyTrash`), so a later `update*` can't write back an id the foreign key would reject.
- **`CategoriesView`** (the `categories` aux view) is the **one** place categories are managed: add, rename, change emoji, delete (no question, then undo), drag-to-reorder, and a per-module usage count on every row. The module dashboards only *assign* (`CategorySelect`) and group by category.
  - The builtin (`sigils`) has no edit and delete buttons — their slot stays reserved so the count columns line up — but stays draggable.
  - The list uses `grouping: 'custom'` with no sort axis: a sort control over a hand-dragged order would contradict itself.
  - A freshly created category appears in no module until an entry points at it — deliberate.
- **`CategorySelect`** carries "Uncategorized" at the top of its list — a real value (`null`), what a new entry shows; choosing it clears an assignment.
- **`lib/categories.ts`**:
  - `categoryLabel(t, cat)` is the one display-name rule: a builtin via `categories.builtin.<id>`, everything else via its stored `name`.
  - `categoriesUsedBy(all, items)` returns the categories a view renders as chips/groups/tabs: those at least one item points at.
  - `categoryUsageCounts(sources)` and `dominantCategoryModule(usage)` are one truth for `CategoriesView`'s count columns and the search's module hint.
  - The `legacy*` helpers serve only migrations v36–v38 and imports of pre-v38 files.
- **Altar:** `altarStore` reads `useCategoryStore` like every other module. Whether a placed item flickers like a candle depends on its own emoji (`isCandleEmoji` in `altarConstants.ts`, `🕯️` with or without the variation selector), not on a category. The Altar tab strip does not reorder categories: it shows only those holding an altar item, so a drag there would rearrange a subset of the app-wide order.

## Tags

Entries and templates store tag **ids** (`tags: string[]`); the `tags` table (`useTagStore`, `src/store/tagStore.ts`) holds name and colour. Four lists carry ids: the three entry types and templates (a template has no place in `TagsView` but passes its tags on to the entry it fills in). Tasks carry none.

The store holds only live tags, and an id that is not among them is shown nowhere:

- **Read side:** `useTagMap()` (live tags by id), `visibleTags(ids, byId)` (what `TagInput`, the template dialog and the lists render) and `liveTagNames(ids)` (what the `.emerald`, Markdown and HTML exports write — files carry names).
- **Write side:** `lib/tagRefs.ts` (DOM- and store-free, so `scripts/schema-check.mjs` can run it). `rewriteTagRefs` walks `entries` and `templates` including the Trash without stamping `updated_at`; `stripTagIds`/`replaceTagId` are its two uses, and `tagStore`'s `rewriteRefs` applies the result to the entry and template stores in memory.

The actions:

- **`updateTag`** — a rename touches only the `tags` row. A name another live tag has throws `TAG_NAME_TAKEN`, checked before the `serialized` chain so the expected rejection isn't logged as an error.
- **`deleteTag(id)`** (soft) only stamps `deleted_at`: every entry keeps the id, and the tag is invisible until **`restoreTag`** brings it back. If a live tag of the same name appeared meanwhile, `restoreTag` merges into it (`replaceTagId`, then the trashed row is dropped). **`permanentlyDeleteTag`** and **`purgeTrashedTags`** (used by `emptyTrash`) strip the ids from every list before deleting the rows; the retention purge in `runPeriodicCleanup` does the same.
- **`createTag`** is `ensureTag` for the Tags view: it throws `TAG_NAME_TAKEN` instead of returning the existing tag. Both run through one `serialized` key, so a double-fired create of the same name finds the first one's tag instead of failing on `UNIQUE`.

Names are compared case-insensitively everywhere (`tagNameKey`, trim + lowercase); `TagInput` and the `.emerald`/Markdown import (`ensureTagIds`) store the id `ensureTag` returns. `tags.name` is `UNIQUE` across trashed rows as well, and **a name belongs to one tag**:

- Creating a name a trashed tag carries — typed or imported — brings that tag back with its colour and spelling (`reviveTrashedNamesake`), but first strips its id from the entries that still carried it: whoever gives the name now means this one entry. `createTag` with an explicit colour applies it.
- Renaming onto a trashed tag's name deletes the trashed namesake for good (ids stripped first) — its entries do not get the name back. Categories differ here: their trashed namesake is merged in, entries included (see [Categories](#categories)).
- An entry or template **restored from the Trash** drops the ids of tags that no longer exist at all (`dropUnknownTagIds`, via `withLiveTags` in `trashWiring`); ids of trashed tags stay, since they can come back. `runPeriodicCleanup` sweeps dangling ids on every vault open as a backstop (see [`database.md`](../database.md#migration-model)).

**`tags.createInline` governs every way a new tag can appear.** Off, the tag field accepts only existing tags and a `.emerald` import keeps only names that already are tags (`ensureTagIds`); on, both create what's missing. A template carries ids, so it never creates a tag: `usableTemplateTags(ids)` (`lib/templateTags.ts`, fed by `tagStore` via `registerTagLookup` to avoid an import cycle) hands over only its live tags. A `.emeralddb` backup is a restore, not a content import, and always brings its tags (resolved by id, then name — see [`database.md`](../database.md#db-backup--restore-emeralddb)). `drafts.json` is version 2: a version-1 file's template drafts carry tag names, which `draftStore` maps onto this vault's tag ids when reading (a name without a tag drops out).

**`TagsView`** is a `Dashboard` in `category` mode with one group per tag. Its header (title, "New tag", search, sort A→Z/Z→A/most used, a module filter) portals into the right sidebar like every module's.

- Groups start **collapsed**: the headers — colour dot, name, `ModuleCounts`, or "unused" ("only in templates") — are the overview. Expanding one lists its entries from Journal, Operations and Wiki (`TAG_MODULE_IDS`); templates are counted but not listed.
- Tags are managed in their header, like categories in `CategoriesView`: the dot opens the palette; pencil/trash buttons and the context menu rename (inline `TagEditRow`, also used for creating) and delete (no question, then undo).
- Unused tags stay visible via `keepEmptyGroups`, except while a search or module filter narrows the list. A search matching only entry titles shows the tag with just those entries and forces it open. Collapse keys are tag ids, so a renamed tag stays open.

## Tasks in the Trash

`deleteTask` stamps the task and every descendant with the *same* `deleted_at` and deletes no `task_links` row; that shared stamp tells "went together" from "was deleted earlier on its own".

- `selectTrashedTaskRoots` (`taskStore.ts`, used by `trashStore.fetchTrashed`) lists only tasks whose parent is not in the Trash with the same stamp, so one deletion is one Trash item.
- `restoreTask` restores the task and the descendants carrying its stamp (`selectTrashedSubtree`, a recursive query — the store only knows active tasks), moves the task to the top level if its parent is still in the Trash, and reloads tasks and links. On a task that is already back it does nothing, so a second Undo is harmless.
- `permanentlyDeleteTask` takes *every* trashed descendant, including those that went earlier on their own, since without their parent they would surface as roots.
- `taskStore` holds only the links of tasks outside the Trash (`selectLiveLinks`); `addLink` ignores a link that exists (the table's `UNIQUE` would otherwise fail in the background).

## Lexicon

The Lexicon (rail, between Wiki and Altar) is a module without entries: it holds **languages** you keep yourself — Enochian, runes, one you made up — and translates a text with them. It reaches no network (see [`security.md`](../security.md#content-security-policy)). What a language does not know stays untranslated and is marked as such: a word list cannot guess, and pretending otherwise would be the worse answer.

**Two tables, one store.** `languages` and `lexicon_entries` (migration v45, see [`database.md`](../database.md#languages)) are both read by `lexiconStore`, since every view needs both at once — the dashboard counts the words, the language page lists them, the translate field reads them. `lexiconRows.ts` holds the raw row access the store and the backup import share, the same split as `blockDefinitionRows.ts`/`templateRows.ts`.

**Saving is immediate.** A vocabulary row is a pair of fields, not a draft: every field writes when it loses focus, the alphabet the same, the name after a short typing pause. The language page therefore has no `useDraftPage` and no "Done": it sits on `LibraryPageFrame` but passes its own `actions` (back to the list, delete) instead of `draft`. `lexicon` is in `LIBRARY_VIEW_IDS` like blocks and templates: `{ type, id }` is a page with its own tab, and it opens the right sidebar.

A language is **not** exportable as a single `.emerald` file the way a template is. That format carries a block stack; a language is two tables and an alphabet, and nothing in it has a place for a `.emerald` importer. Backups carry it instead (see [`database.md`](../database.md#db-backup--restore-emeralddb)).

**Translating** lives in `src/lib/lexicon.ts`, free of stores and i18n like the rest of `lib/`:

- **Words.** The text is split into words and everything between them; both survive into the result, so a translated invocation keeps its shape. Each word is looked up in the chosen direction — `toLanguage` matches `translation` and yields `term`, `fromLanguage` the other way — and a multi-word left-hand side is matched as a phrase, longest first. Only whitespace *within a line* may stand between a phrase's words: a phrase replaces everything it spans, so one reaching across a line break would swallow it. The first matching row wins (lower `sort_order`), and the source word's capitalisation is carried over (ALL CAPS, First letter).
- **Characters.** `transliterate` rewrites character by character against the alphabet, longest run first — with `t` ahead of `th`, `th` would never be found. Anything not in the table stays as it is. Only a pair with both sides filled takes part (`isUsablePair`); a half-filled one is still *stored* (`isFilledPair`), so a side you mean to add later is not thrown away.
- **Both** (the default) is words first, then the alphabet for whatever the word list did not know. A word that comes back unchanged from both is reported as unknown — shown dotted-underlined, and counted in the line below.

**The translate field is not on a language's page** but under the language list (`Dashboard`'s `contentFooter`, like the Altar library under the altars): it picks its language itself and works with all of them, so it belongs beside the list.

**Search and trash.** A language and every single word are in the global search (`SearchKind` `language`/`lexiconEntry`); a word has no page of its own, so its hit opens the language holding it (`SearchHit.languageId`). Deleting a language is a soft delete with an undo toast — its words stay attached and come back with it; permanently deleting it takes them along through `ON DELETE CASCADE`.
