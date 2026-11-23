# Modules, Stores and Shared Data

## Module Registry

`src/lib/modules.ts` is the one source of truth for the view vocabulary: which views exist, their icons and nav-label keys. Entries have no module of their own — what an entry is follows from its category.

- `CONTENT_MODULE_IDS` (`entries`/`tasks`) are the two content stores `moduleWiring` reloads, and the columns of the usage counters (`ModuleCounts`) in the categories and tags views.
- `ViewId` (`'tasks' | AuxViewId`, with `AuxViewId` = `dashboard`/`entry`/`tags`/`categories`/`images`/`symbols`/`blocks`/`templates`/`lexicon`/`trash`) is what `ActiveView['type']` is. `dashboard` is one dashboard's list by id (`{ type: 'dashboard', id }`) — "All entries" (`id: 'all'`, `ALL_ENTRIES_VIEW` in `uiStore.ts`, the start view and what a new tab shows), the built-ins and the dashboards made by hand. `entry` is the one entry page (`{ type: 'entry', id, dashboard }`), see [Where an entry opens](#where-an-entry-opens). `isViewId()` guards persisted tabs at load time, so a stored tab of an unknown view type is dropped rather than crashing the router.
- `COLLECTION_IDS` / `CollectionId` (`tags`, `categories`, `images`, `templates`, `blocks`, `lexicon`, `symbols`) are the collections `CollectionDashboard` shows; `uiStore.collectionPrefs` keys their view and sort by them, and the right sidebar treats them as views without an entry.
- `TASKS_VIEW` and `AUX_VIEWS` hold icon and nav label per view; `ENTRY_ICON` (`FileText`) stands for "an entry" where no entry icon is drawn (search badge, image places, usage counters).
- `ALL_ENTRIES_ICON` (`LayoutList`) is the rail glyph of "All entries", `DEFAULT_DASHBOARD_ICON` (`LayoutDashboard`) that of a dashboard without an icon of its own; `dashboardIcon(d)` gives the built-ins their glyphs (Journal `BookOpen`, Practice `Wand2`, Knowledge `Library`) — icons of the dashboard rows, not of the entries they show.
- `TRASH_KINDS`/`TRASH_KIND_ICONS` cover the larger set of trash-only kinds — `entry` (`FileText`), `dashboard` (`LayoutDashboard`), `category` (whose `FolderOpen` glyph `AUX_VIEWS.categories` reuses) and the rest.

Links name their target by kind `entry` or `task` only (`LinkTargetKind`, `linkTargetKindOf` in `lib/internalLinkHtml.ts`), so a change of category rewrites no link.

**Titles and icons.** Two small rules live beside the registry so that no list decides them for itself:

- `src/lib/entryTitle.ts`: new entries and tasks are stored with an **empty** title, and `displayTitle(t, 'entry' | 'task', title)` shows the translated "Untitled entry" or "Untitled task" wherever a title is displayed. `hasOwnTitle(title)` is the one test for "has a title of its own". Only a `.emerald` or Markdown import reads the app-language "Untitled …" an export wrote for an empty title as no title; anything typed is a title, whatever it says. Renaming starts from the *stored* title (`EntryListTab`'s `getEditTitle`), so Enter on an untitled row cannot save the placeholder.
- `entryIcon(entry, category, showMoonPhase)` in `src/lib/entryIcon.ts` is the one icon rule for an entry, in every list, tab, link chip and the export: its own icon (emoji or image), else its moon phase (category Journal with the vault setting on, see [Moon Phase](#moon-phase)), else its category's emoji, else `DEFAULT_ENTRY_ICON` (📄). A task without a category shows `DEFAULT_TASK_ICON` (✅).

A second, smaller registry sits in `src/components/editors/text/SuggestionList.tsx` — `TARGET_KIND_ICONS` and `TARGET_KIND_LABEL_KEYS`, keyed by `LinkTargetKind`: the link picker's tabs and the badge of a target without a category.

`modules.ts` imports only `lucide-react` and types (its edge to `types/index.ts` runs both ways, but only as `import type` — a runtime import either direction would be a real cycle). No stores, no React components. Two thinner layers build on top of it:

- **`src/store/moduleWiring.ts`** — the store-layer half. `moduleWiring` maps each `ContentModuleId` (`entries`, `tasks`) to its store's reload function; `trashWiring` maps each `TrashKind` to its restore/permanently-delete pair.
  - `reloadAllStores()` is the startup/vault-switch reload: tags, categories, dashboards, `block_definitions`, `templates` and the lexicon in parallel, then every module's content. No fetcher reads another store, but loading those first means a list never renders a frame with unresolved category or tag names, and a new entry never starts before its default template could be resolved.
  - `reloadModules(ids)` reloads a subset (the Emerald-format import) but always refetches the first group too, since an import can create new ones.
  - Import rule: content stores only (`entry`/`task`/`tag`/`category`/ `blockDefinition`/`template`/`lexicon`) — never `uiStore`, `vaultStore` or `trashStore`, which import this module instead.
- **`src/components/layout/moduleViews.ts`** — the component-layer half. `VIEW_COMPONENTS` maps every `ViewId` to its `React.lazy` view. Import rule: **only `MainArea` may import this file** — any other importer risks pulling every view's lazy chunk (including TipTap) into its own bundle.

## Adding a Module or Table

These places enumerate modules or tables and are easy to miss. Follow how the closest existing module does it: the Lexicon for a module with its own tables, Tasks for one with its own items. Leaving a place out can be right, as with the Lexicon and single-file export, but it should be a decision.

- **Schema:** `src/lib/schema.ts` (the table in `TABLES`), a step appended to `MIGRATIONS` in `src/lib/db.ts` and `BASELINE_VERSION` raised to it, see [Rules for Future Schema Changes](../database.md#rules-for-future-schema-changes). Image columns go into `IMAGE_FIELDS`.
- **Backup:** export, filter and insert in `src/lib/dbBackup.ts`, and a raised `EMERALD_FORMAT_VERSION` (`lib/emerald/manifest.ts`, with `FORMAT_VERSION` in `emerald_file.rs`) when an older build would import the new shape wrongly. A table missing here is lost on restore without an error.
- **Registry:** `src/lib/modules.ts`, the store's reload in `src/store/moduleWiring.ts`, the view in `src/components/layout/moduleViews.ts`.
- **Trash:** a soft-deleted item needs `TRASH_KINDS`, `trashWiring`, and listing and emptying in `src/store/trashStore.ts`.
- **Search:** `SearchKind` and the query in `src/lib/globalSearch.ts`, the display in `src/components/layout/titlebar/SearchResultList.tsx`.
- **Links:** a link target goes through `src/lib/linkItems.ts` and `viewOfLinkTarget`.
- **Files:** `src/lib/export.ts`, `src/lib/exportData.ts` and `src/lib/emeraldFormat.ts`, when the content can be exported or imported.
- **Categories and tags:** `src/lib/categories.ts` and the reassignment in `src/store/categoryStore.ts`, `src/lib/tagRefs.ts` (a new tagged thing needs a link table and an entry in `TAG_LINKS`).
- **Text and docs:** all four locale files, `Documentation/features.md`, `Documentation/database.md`, this file.

Then run the `crosscheck` agent, see [`agents.md`](../agents.md). `npm run check:schema` compares shapes only: it does not notice that search or the Trash lack the new data.

## Entry Store

All entries live in one Zustand store, `useEntryStore` (`src/store/entryStore.ts`), over the one `entries` table (see [`database.md`](../database.md#entries)). `Entry` (`types/index.ts`) has no type; what carries tags is `TagOwner` (`tagRefs.ts`: `'entry' | 'template' | 'image'`).

- **State:** `entries: Entry[]` — one list, newest first. A change replaces only that entry's object, so a selector over one entry (`findEntry(s.entries, id)`) re-renders only for it. Every view sorts for itself.
- **Reading by dashboard:** `useDashboardEntries(id)` (`hooks/useDashboardEntries.ts`, beside `useDashboard(id)`) gives the entries any dashboard shows, filtered and sorted once per change and cached by the identity of the list, the dashboard and the category list (`entriesOfDashboard` in `store/entryViews.ts`), so a list re-renders only when its own result changes. What lists every entry — search, link items, Tags, the category counts — reads `entries` directly.
- **Loading in two stages:** `fetchEntries` selects the entries' columns without their blocks and lists each entry in `pendingContent`, so lists and dashboards stand at once; `content` (the block stack as one string, from the rows of `blocks`) follows in the background in chunks of 1000 (`loadAllContent`, one retry), filled in only where an entry is still pending. Until then a pending entry's `content` is `''`. A single entry is loaded at once by `ensureEntryContent(id)` — the views do that through `useEntryContentReady` and mount `BlockStack` only with real content. Anything that reads one entry it did not open (duplicate, save as template, export of the open entry right after start) calls `ensureEntryContent` first. `updateEntry` never writes `content` for a pending entry. `fetchEntries({ keepLoaded: true })` — only after an `.emerald` import (`reloadModules`), which wrote through the store — keeps the content already loaded; a vault switch or backup import reloads everything.
- **Actions:** `createEntry({ categoryId, blank, createdAt, tagIds })` — it reads the category's start template from its row (this store imports no category store) and starts with it or the vault's default (see [Starting an entry](templates.md#starting-an-entry)); `updateEntry`, `duplicateEntry`, `deleteEntry`, `restoreEntry`, `permanentlyDeleteEntry`, `getEntry(id)`. A new entry from a dashboard starts in the first live category and with the first live tag of its filter (`startCategoryOf(dashboardId)`, `firstTagOf`, `createEntryIn(dashboardId, { categoryId })` in `lib/createItem.ts`) and opens on the entry page inside that dashboard.
- **Write serialization** uses one key domain, `'entry'`, per entry id, so a category change from the properties panel and an autosave of the same entry queue behind each other. Creating an entry runs under one more key, `ENTRY_NUMBER_KEY` (`lib/serialize.ts`): it reads the highest number and writes later, and the number is unique.
- The entry page, the properties panel, `TabBar` and `RightSidebar` find the open entry by id alone; link chips and link titles come from `useLinkItems`/`linkItemsByKey` instead of reading the stores themselves.

## Dashboards

A dashboard (`dashboards`, see [`database.md`](../database.md#dashboards)) is a view over entries by filter rules — categories, tags (`DashboardFilter`) — with a sort and a display (`DashboardDisplay`: view and grouping). The built-ins Journal, Practice and Knowledge are dashboards like any other, with start values; "All entries" has no filter, so no entry can become unfindable, and cannot be deleted. `useDashboardStore` (`store/dashboardStore.ts`) loads them with the categories and creates, updates, deletes (into the Trash), restores, permanently deletes and reorders them; `dashboardById` finds one. It imports no other store except the leaf `saveNoticeStore`.

On a failed database write the store goes back to the state it had before that change (two overlapping failed changes to the same dashboard can still leave the first one showing). Create and delete write first and set state afterwards; update and reorder stay optimistic (sort and layout buttons answer at once) and put the previous state back on failure, unless a later change has replaced it meanwhile. In all four the error is logged and reported through `reportSaveError` (a notice in `SaveNoticeToast`) instead of thrown: `createDashboard` then returns `null` and `deleteDashboard` returns `false`, which callers (`createDashboardAndOpen`, `deleteDashboardWithUndo`) answer by doing nothing further — no new tab, no undo entry. `restoreDashboard` and `permanentlyDeleteDashboard` still throw, as every trash type does; only the Trash's bulk restore catches and marks the failure — Undo, a single restore and a permanent delete leave it uncaught.

The actions the UI shares sit in `store/dashboardActions.ts`: `createDashboardAndOpen` (create, open its list, show its settings), `deleteDashboardWithUndo` (a page showing it goes to "All entries") and `showsDashboard(view, id)`. One settings dialog serves every dashboard: `openDashboardSettings(id)` (`store/dashboardSettingsStore.ts`) opens `DashboardSettingsModal`, mounted once by `AppShell` as `DashboardSettingsHost` — name, icon, the category filter (with a field that creates a category and ticks it) and the tag filter; "All entries" has neither filter nor Delete. It opens from the settings button beside "New …" on every entry dashboard, from the rail's right-click menu and right after a dashboard is created.

**View, sort and grouping live in the row.** `useDashboardPrefs(dashboard, dateField)` reads `sort` and `display` as the toolbar's `ListPrefs` and writes changes back (`sortModeOf`/`sortFromMode` translate between the dashboard's sort and the toolbar's `SortMode`), so every dashboard keeps its look across a restart and in the backup. `parseDashboardDisplay` reads missing or broken JSON as `DEFAULT_DISPLAY` (list, flat); the start values of the built-ins are in `BUILTIN_DASHBOARDS` (`schema.ts`) and reach only the seed.

**The list.** `EntryDashboard` (`components/views/EntryDashboard.tsx`) is the one entry list over a dashboard — search, category filter, grouping by category, list/cards/timeline, context menu, rename, empty state. `DashboardView` shows every dashboard through it; every entry is drawn by the same rule (`entryIcon`, its category and the date the dashboard sorts by, then what the entry's blocks add (`listInfo`, see [Blocks](blocks.md#registry)) — a sigil's target date; a card also shows its tags in one line, `CardTags`) and opens on the entry page inside this dashboard. A renamed built-in shows its name as title, tab title and rail tooltip (`dashboardLabel(t, d)`: the stored name, else the translated built-in name, else "Unnamed dashboard").

`lib/dashboards.ts` is the one rule for what a dashboard shows: `matchesFilter` (a missing rule does not narrow; categories: the entry's is one of them and that category is live — it takes the set of live category ids as a required argument, as `dashboardEntries` does, so a filter naming only purged or trashed categories shows nothing; tags: it carries one of them, an empty tag list is no rule, a purged tag drops out of the filter and a trashed one still passes), `parseDashboardFilter` (keeps an empty category list from a row or backup: it means "nothing"), `normalizeFilter` (applied when the settings dialog saves a changed selection: an empty list drops out, so deselecting every category gives "all"; `DashboardSettingsModal` leaves `filter` out of the update when the selection is unchanged, so saving only a name or icon never rewrites an emptied filter), `compareEntries`, `dashboardEntries`, `firstCategoryOf`, `firstTagOf` (the first still-existing tag of the filter; a new entry made in the dashboard gets it, via `createEntry`'s `tagIds`, merged with the template's tags, so it passes the tag filter). The filters are evaluated in memory — every entry is in the store anyway; filters on field values of blocks will need SQL, and start from here.

The category ids in the filters have no foreign key: `reassignCategoryContent` drops or moves them with a deleted or merged category, `reassignDashboardCategoriesInMemory` does the same in the store.

### Where an entry opens

An entry has no type and belongs to no dashboard; the same category may stand in several dashboards, and the entry shows in each. It opens on the one entry page, `EntryView` (`{ type: 'entry', id, dashboard }`), inside the dashboard it was clicked in — `entryView(id, dashboard)` in `store/entryViews.ts`. From anywhere else (link chip, search, Tags, Images, a task's link, the left list's "All entries") it opens in "All entries" (`viewOfLinkTarget`). The dashboard stays highlighted in the rail (`RailDashboards`), is where the back link leads (`EntryDetailFrame`), and decides which date the header shows (the one it sorts by). A tab keeps both; a dashboard that is gone falls back to "All entries", and an entry that is gone shows the dashboard's list. Moving an entry is changing its category in the properties panel (`EntryPropertiesPanel`), part of the edit like any other field.

## Moon Phase

The moon phase of an entry of the category Journal is not stored: `entryMoonPhase(entry, shown)` in `src/lib/moonPhase.ts` derives it from `created_at`; an entry of any other category has none, whatever dashboard shows it. The vault setting `journal.moonPhase` means "show it on journal entries" and works retroactively: with it on, such an entry shows its phase as its icon (unless it has one of its own, `entryIcon`), in the entry page's header and in the properties panel. The setting's locale keys are `moonPhaseShow`/`moonPhaseShowHint`.

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

Entries and tasks share one category list — `useCategoryStore` (`src/store/categoryStore.ts`), backed by the single `categories` table (see [`database.md`](../database.md#categories)). The journal is a built-in category of it; its entries show the moon phase of their creation day (when the vault setting is on).

An entry's `category_id` may be `NULL`. A new entry from a dashboard starts in the first live category of its filter (`startCategoryOf`); one without a category is in no dashboard that filters by category, only in "All entries" and those that filter by tags only. The "Uncategorized" bucket shows it, and also collects entries whose category is in the Trash — for the reader the two are the same thing. `lookupCategory(byId, id)` in `lib/categories.ts` resolves a possibly-null id; `categoryLabel` accepts `null`.

Import rule: `categoryStore` may import the content stores and the dashboard store (it reassigns their in-memory rows when a category is permanently deleted or merged); none of them import it back. Cross-store access goes through `getState()` at call time, never at import time.

- **`useCategoryStore`** holds `categories: Category[]` (active only, ordered by `sort_order`) and `fetchCategories`/`addCategory`/`updateCategory`/`setStartTemplate` (built-ins too)/`deleteCategory` (soft, rejects builtins)/`restoreCategory`/`permanentlyDeleteCategory`/`reorderCategories`/`getCategory`.
  - `addCategory`/`updateCategory` reject a duplicate name via `categoryKey` (trim + lowercase, `lib/categories.ts`, shared with the backup and `.emerald` imports) by throwing `CATEGORY_NAME_TAKEN`. `addCategory` appends to the end; the order belongs to the user.
  - **A name belongs to one category**, as with tags. `addCategory` with a trashed category's name restores that one and gives it the chosen emoji. `restoreCategory` into a name a live category took meanwhile, and `updateCategory` onto a trashed category's name, merge the two (`mergeCategory`): `reassignCategoryContent` moves the content over and the dashboards' filters name the survivor (see database.md).
  - `permanentlyDeleteCategory` sets the content's `category_id` to `NULL` (`reassignCategoryContent`), then applies the same change to the loaded stores' rows (`reassignCategoriesInMemory`, also called by `trashStore.emptyTrash`), so a later `update*` can't write back an id the foreign key would reject.
- **`CategoriesView`** (the `categories` aux view) is the **one** place categories are managed: a collection (`CollectionDashboard`) with add, rename, change emoji and choose the start template in `CategoryEditModal` (a click on the category), delete (no question, then undo), drag-to-reorder, a usage count (entries, tasks) and the start template on every row, and a filter by the dashboards whose filter names a category. The entry page only *assigns* (`CategorySelect`), the dashboards group by category.
  - The builtins (`journal`, `sigils`, `altars`) cannot be renamed or deleted; their dialog only changes the start template, and they stay draggable.
  - The hand-dragged order is the sort `manual` ("Custom order", the default); the grips (`usePointerReorder`) show only there, and only without search or filter, since `reorderCategories` writes the complete order. Name and usage sorts change this view only.
  - A freshly created category is in no dashboard's filter: its entries show in "All entries" until a dashboard's settings tick it — or it is created there, in the dashboard's settings, which ticks it at once.
- **`CategorySelect`** carries "Uncategorized" at the top of its list — a real value (`null`), what a new entry shows; choosing it clears an assignment.
- **`lib/categories.ts`**:
  - `categoryLabel(t, cat)` is the one display-name rule: a builtin via `categories.builtin.<id>`, everything else via its stored `name`.
  - `categoriesUsedBy(all, items)` returns the categories a view renders as chips/groups/tabs: those at least one item points at.
  - `categoryUsageCounts({ entries, tasks })` gives `CategoriesView`'s count columns.
  - `categoryKey(name)` is the one comparison of category names.

## Tags

Entries, templates and pictures of "Images" link their tags (`entry_tags`, `template_tags`, `image_tags`), held in memory as tag **ids** (`tags: string[]`); the `tags` table (`useTagStore`, `src/store/tagStore.ts`) holds name and colour. A template has no place in `TagsView` but passes its tags on to the entry it fills in. Tasks carry none.

The store holds only live tags, and an id that is not among them is shown nowhere:

- **Read side:** `useTagMap()` (live tags by id), `visibleTags(ids, byId)` (what the template dialog and the lists render; `TagInput` builds the same list itself, with its drafts among the real tags) and `liveTagNames(ids)` (what the `.emerald`, Markdown and HTML exports write — files carry names).
- **Write side:** `lib/tagRefs.ts` (DOM- and store-free, so `scripts/schema-check.mjs` can run it). Tags are rows of `entry_tags`, `template_tags` and `image_tags` (`TAG_LINKS`); the stores write an owner's tags with its row (`tagStatements`) and read them all at once (`readTagLinks`). A tag deleted for good takes its links with it (CASCADE); merging hands them over (`replaceTagId`), reviving a trashed namesake drops them (`unlinkTags`). `tagStore`'s `dropFromStores` applies the same to the entry, template and image stores in memory, and `replaceTagsInDashboards` (`schema.ts`) to the dashboards' filters.

The actions:

- **`updateTag`** — a rename touches only the `tags` row. A name another live tag has throws `TAG_NAME_TAKEN`, checked before the `serialized` chain so the expected rejection isn't logged as an error.
- **`deleteTag(id)`** (soft) only stamps `deleted_at`: every link stays, and the tag is invisible until **`restoreTag`** brings it back. If a live tag of the same name appeared meanwhile, `restoreTag` merges into it (`replaceTagId`, then the trashed row is dropped). **`permanentlyDeleteTag`** and **`purgeTrashedTags`** (used by `emptyTrash`) delete the rows, and their links go with them (CASCADE); the dashboards' filters drop them (`replaceTagsInDashboards`) and the dashboard store reloads. The retention purge in `runPeriodicCleanup` does the same in the database.
- **`createTag`** is `ensureTag` for the Tags view: it throws `TAG_NAME_TAKEN` instead of returning the existing tag. Both run through one `serialized` key, so a double-fired create of the same name finds the first one's tag instead of failing on `UNIQUE`. `ensureTag(name, id)` takes a fixed id for a tag that must be the same on every device ("Altar Library", `ALTAR_LIBRARY_TAG_ID`, which an Altar block's strip starts with); it is used only for a new name and only while no row holds that id (renamed, or in the trash), else the tag gets a new id. A third parameter, `newColor`, colours only a really new tag; a namesake found (even from the trash) keeps its own colour. Dialogs that save later don't call `ensureTag` while typing: `TagInput`'s drafts hold the new names, and `commitDraftTags` (exported from `TagInput.tsx`) runs `ensureTag(name, undefined, draftColor)` on Save, so Cancel leaves no tag.

Names are compared case-insensitively everywhere (`tagNameKey`, trim + lowercase); `TagInput` and the `.emerald`/Markdown import (`ensureTagIds`) store the id `ensureTag` returns (`TagInput` in draft mode: the id `commitDraftTags` returns on Save). `tags.name` is `UNIQUE` across trashed rows as well, and **a name belongs to one tag**:

- Creating a name a trashed tag carries — typed or imported — brings that tag back with its colour and spelling (`reviveTrashedNamesake`), but first removes its links (`unlinkTags`): whoever gives the name now means this one entry. `createTag` with an explicit colour applies it.
- Renaming onto a trashed tag's name deletes the trashed namesake for good (its links go with it) — its entries do not get the name back. Categories differ here: their trashed namesake is merged in, entries included (see [Categories](#categories)).
- An entry or template **restored from the Trash** reads its tags from the links; a tag gone for good took its links along, a trashed one stays linked, since it can come back.

**`tags.createInline` governs every way a new tag can appear.** Off, the tag field accepts only existing tags and a `.emerald` import keeps only names that already are tags (`ensureTagIds`); on, both create what's missing. A template carries ids, so it never creates a tag: `usableTemplateTags(ids)` (`lib/templateTags.ts`, fed by `tagStore` via `registerTagLookup` to avoid an import cycle) hands over only its live tags. A `.vault.emerald` backup is a restore, not a content import, and always brings its tags (resolved by id, then name — see [`database.md`](../database.md#db-backup--restore-vaultemerald)). `drafts.json` is version 2: a version-1 file's template drafts carry tag names, which `draftStore` maps onto this vault's tag ids when reading (a name without a tag drops out).

**`TagsView`** is a collection (`CollectionDashboard`): sort A→Z/Z→A/most used, a filter by where a tag is used (in entries, only elsewhere — with a hover hint naming templates, images and dashboard filters — nowhere — a tag in a dashboard's filter counts as used; labels and the hint under an open tag are built from the places: templates, images, dashboard filters, the hint naming the dashboards), list or cards. The list (`renderList`) is one row per tag with its entries below — the shared entry rows (`useEntryItems`), with their context menu, opening in "All entries", ordered by the view's own second sort (`subSort`, "Entry sorting": last changed newest/oldest, name; `uiStore.tagEntriesPrefs`, per vault); a card renames on click. Delete moves the tag to the Trash with Undo; a tag still on entries first shows a warning naming how many (`InlineConfirm` in its row, or in place of its card). The entries keep the tag's ID while it is in the Trash, so Undo puts it back on all of them.

- Groups start **collapsed**: the headers — colour dot, name, `ModuleCounts`, or "unused" / "only in {places}" (templates, pictures of "Images", dashboard filters — `tags.onlyIn`) — are the overview. Expanding one lists its entries (icon, category, date), each opening in "All entries"; templates and pictures are counted but not listed — an expanded tag without entries says so, naming where it is used, the dashboards by name (`tags.onlyInHint`, else `unusedHint`).
- A tag's dot opens the palette; the context menu renames (inline `TagEditRow`, also used for creating) and deletes (a warning first while it is on entries, then undo); on a card a click renames.
- Unused tags stay in the list, except while a search or the filter narrows it. A search matching only entry titles shows the tag with just those entries and forces it open. Collapse keys are tag ids, so a renamed tag stays open.

## Tasks in the Trash

`deleteTask` stamps the task and every descendant with the *same* `deleted_at` and deletes no `task_links` row; that shared stamp tells "went together" from "was deleted earlier on its own".

- `selectTrashedTaskRoots` (`taskStore.ts`, used by `trashStore.fetchTrashed`) lists only tasks whose parent is not in the Trash with the same stamp, so one deletion is one Trash item.
- `restoreTask` restores the task and the descendants carrying its stamp (`selectTrashedSubtree`, a recursive query — the store only knows active tasks), moves the task to the top level if its parent is still in the Trash, and reloads tasks and links. On a task that is already back it does nothing, so a second Undo is harmless.
- `permanentlyDeleteTask` takes *every* trashed descendant, including those that went earlier on their own, since without their parent they would surface as roots.
- `taskStore` holds only the links of tasks outside the Trash (`selectLiveLinks`); `addLink` ignores a link that exists (the table's `UNIQUE` would otherwise fail in the background).

## Lexicon

The Lexicon (rail, below Tasks) is a module without entries: it holds **languages** you keep yourself — Enochian, runes, one you made up — and translates a text with them. It reaches no network (see [`security.md`](../security.md#content-security-policy)). What a language does not know stays untranslated and is marked as such: a word list cannot guess, and pretending otherwise would be the worse answer.

**Two tables, one store.** `languages` and `lexicon_entries` (see [`database.md`](../database.md#languages)) are both read by `lexiconStore`, since every view needs both at once — the dashboard counts the words, the language page lists them, the translate field reads them. `lexiconRows.ts` holds the raw row access the store and the backup import share, the same split as `blockDefinitionRows.ts`/`templateRows.ts`.

**Saving is immediate.** A vocabulary row is a pair of fields, not a draft: every field writes when it loses focus, the alphabet the same, the name after a short typing pause. The language page therefore has no `useDraftPage` and no "Done": it sits on `LibraryPageFrame` but passes its own `actions` (back to the list, delete) instead of `draft`. `lexicon` is in `LIBRARY_VIEW_IDS` like blocks and templates: `{ type, id }` is a page with its own tab, and it opens the right sidebar.

A language is **not** exportable as a single `.emerald` file the way a template is. That format carries a block stack; a language is two tables and an alphabet, and nothing in it has a place for a `.emerald` importer. Backups carry it instead (see [`database.md`](../database.md#db-backup--restore-vaultemerald)).

**Translating** lives in `src/lib/lexicon.ts`, free of stores and i18n like the rest of `lib/`:

- **Words.** The text is split into words and everything between them; both survive into the result, so a translated invocation keeps its shape. Each word is looked up in the chosen direction — `toLanguage` matches `translation` and yields `term`, `fromLanguage` the other way — and a multi-word left-hand side is matched as a phrase, longest first. Only whitespace *within a line* may stand between a phrase's words: a phrase replaces everything it spans, so one reaching across a line break would swallow it. The first matching row wins (lower `sort_order`), and the source word's capitalisation is carried over (ALL CAPS, First letter).
- **Characters.** `transliterate` rewrites character by character against the alphabet, longest run first — with `t` ahead of `th`, `th` would never be found. Anything not in the table stays as it is. Only a pair with both sides filled takes part (`isUsablePair`); a half-filled one is still *stored* (`isFilledPair`), so a side you mean to add later is not thrown away.
- **Both** (the default) is words first, then the alphabet for whatever the word list did not know. A word that comes back unchanged from both is reported as unknown — shown dotted-underlined, and counted in the line below.

**The translate field is not on a language's page** but under the language list (`Dashboard`'s `contentFooter`, like Blocks' built-in blocks under the custom ones): it picks its language itself and works with all of them, so it belongs beside the list.

**Search and trash.** A language and every single word are in the global search (`SearchKind` `language`/`lexiconEntry`); a word has no page of its own, so its hit opens the language holding it (`SearchHit.languageId`). Deleting a language is a soft delete with an undo toast — its words stay attached and come back with it; permanently deleting it takes them along through `ON DELETE CASCADE`.
