# Navigation, Tabs and Search

## Global Search

The title bar's search field searches every module by title, tag and body text. It is a pure in-memory filter: `useGlobalSearch` (`src/hooks/useGlobalSearch.ts`) builds a `SearchCorpus` from the Zustand stores `AppShell` already loads, and `searchCorpus()` (`src/lib/globalSearch.ts`) scores and sorts it. There is no FTS5 table — the stores are the single source of truth (see [Data Flow](../architecture.md#data-flow)), and a second searchable copy would be one more thing to keep in sync.

`globalSearch.ts` has no JSX: it decides *what* matched and how well; how a hit looks is `SearchResultList.tsx`'s job. `matchRecord()` tries, per record:

1. the title (prefix beats substring),
2. then the tags,
3. then — only for queries of two or more characters — the full text, through a thunk that only runs when the cheaper checks fail.

For Journal/Wiki/Operations the thunk turns the stored HTML into plain text via `plainTextFor()` (`src/lib/searchText.ts`), cached per `(id, updated_at)` so a keystroke doesn't re-parse the vault. `clearSearchTextCache()` runs on vault switch (`vaultStore.ts`) and `.emeralddb` import (`dbBackup.ts`), since both can leave stale ids or reused id/timestamp pairs behind.

`htmlToText()` uses `DOMParser` rather than `innerHTML` on a detached `<div>`: the parsed document is inert, so an imported `<img onerror>` never runs (see [Security → Search Text Extraction](../security.md#search-text-extraction)). `foldTypography()` maps TipTap's `Typography` output (curly quotes, en/em dashes) back to keyboard characters, one for one, so `don't` finds a curly apostrophe. Query and result highlighting share the same folding through `comparable()`, so they never disagree about what matched.

`searchCorpus()` returns every `SearchHit`, best first; capping is `useGlobalSearch`'s job, in two memos. One re-scores only when corpus or query change, the other slices to `limit`. "Show more" (`SearchModal.tsx`) grows `limit` by `PAGE_SIZE` (50), which re-slices instead of re-scoring — the point of the split, since the search already reruns on every keystroke.

A hit's `key` is `${kind}:${id}` (categories share one id space). A category hit's optional `module` is the module holding most of its entries (`categoryUsageCounts`/ `dominantCategoryModule`), shown as a hint beside the hit; the hit opens the categories view.

Templates are not in the corpus — the templates dashboard is a library like Blocks, not an entry type (see [Templates](templates.md#templates)). The Lexicon is the exception among the libraries: being a library governs its page shell (`LIBRARY_VIEW_IDS`), not searchability, and a language you keep yourself is closer to Journal/Wiki content than to a definition — so languages and their words are searchable (see [Lexicon](modules.md#lexicon)).

`viewForSearchHit()` maps a hit to an `ActiveView`. Tasks, tags and categories have no page per record: the hit opens their view with the record's id, and `TasksView`/`TagsView`/ `CategoriesView` react through the shared `useDeepLink` hook (`src/hooks/useDeepLink.ts`). It is keyed on the `activeView` *object*, not the id inside it, so opening the same result twice still works; it clears search/filters/collapsed state, then scrolls the row into view a frame later. A `handledView` ref keeps a later store change from re-triggering it and overwriting filters the user has since changed. `TagsView` also selects the tag; `CategoriesView`, with no selection, highlights the row for two seconds.

These deep links carry an id into a view that has no *entries*, so `{ type: 'categories', id }` (or `'tags'`/`'home'`) must never reach the entry action bar, whose Edit button would set `mode: 'edit'` on a view without an editor. `RightSidebar` offers the list-header host whenever `activeView.type` is in `VIEWS_WITHOUT_ENTRIES`, id or not — see [List Header Portal](editing.md#list-header-portal).

## Drag and Drop

Tauri's WKWebView does not pass HTML5 drag events to JavaScript, so all drag-and-drop uses Pointer Events:

1. `onPointerDown` on the draggable element sets the item in a module-level drag state (`dragState.ts`, `altarDragState.ts` — thin adapters over `createDragChannel()` in `src/lib/dragChannel.ts`, which holds the item and notifies subscribers).
2. The drop target registers `pointermove` and `pointerup` listeners on `document` while a drag is in progress.
3. On `pointerup`, the target reads the drag state and applies the drop.

Drops into an entry's text use exactly one such listener per open entry (`useEditorPointerDrops`, mounted by `BlockStack`): it hit-tests the text blocks' editors and clears the drag whether or not one was hit. One listener per text block would let the first clear the drag before the block under the pointer saw it.

## Tabs and Workspace State

Browser-like tabs keep several pieces of content open at once. `uiStore` holds `tabs` and `activeTabId`; each tab carries an `ActiveView` (an entry, an altar, a library page or a top-level view). `setActiveView()` updates the active tab's view, opening in a new tab creates a tab with its own view, and selecting a tab restores its view into the main area. Tabs are the workspace; [navigation history](#navigation-history) is back/forward movement inside each tab.

Tab ids, `isContentView` and the history helpers live in `src/lib/tabs.ts`. `viewTypeForEntryType()` (`src/lib/modules.ts`, a reverse lookup over `MODULES` — see [Module Registry](modules.md#module-registry)) is the one place that translates the data model's `operation` (as carried by `task_links.target_type`, the drag payload and the internal-link mark) into `ActiveView`'s `operations`, named after the module.

Tabs and their histories persist in `localStorage` (`open-tabs`, `active-tab-id`), so the workspace survives a restart without database tables.

**What is remembered where.** Four places, each for one kind of thing:

- **Settings** — `settings.json` in the vault folder (`lib/vaultSettings.ts`), travels with backups.
- **Preferences** — per vault, in `localStorage` under `vault-prefs:<vaultId>` (`store/vaultPrefs.ts`): every `ListPrefs` field, the three Home sections, `tagsSort`, `altarShowPreview`, `altarLibraryPrefs`, `collapsedGroups` and `flags` (what `usePersistedFlag` toggles — collapsed sections such as the Altar's `altar-edit-*-open`, Tasks' "Show completed"). They live in `uiStore`; `loadVaultPrefs` fills them when a vault opens (boot, `openActiveVault`, a failed switch's rollback) and a store subscription writes changes back. Fields are validated on load. A vault without saved preferences starts from the store defaults plus the older app-wide keys (`altar-show-preview`, `altar-library-sort`/`-grouping`, raw flag keys). `forgetVaultPrefs` drops them with the vault.
- **Working state** — search, filters, the Trash selection: `useSessionState(key, initial)` (`store/sessionStore.ts`), keyed like `wiki.search`. Survives a module switch (which unmounts the view), not a restart; `closeAllTabs` clears it, so a vault switch or replace import starts clean.
- **Window layout** — tabs, the three sidebars' open state and widths, the Altar library strip's height: app-wide `localStorage`, whatever vault is open.

**Vault switches and a Replace-mode `.emeralddb` import reset the whole workspace.** `closeAllTabs()` clears `tabs` and `activeTabId`, resets `tablessHistory` to a fresh Home history and saves the empty tab list — every open tab and its history carry row ids that no longer exist. A Merge import only adds rows, so it keeps the tabs. Tabs are not remembered per vault. `openActiveVault()` (`vaultStore.ts`) calls `closeAllTabs()` on a switch and when the active vault is deleted, but not at startup, so relaunching restores the previous tabs.

Each tab's title and icon come from a per-tab `TabButton` (`TabBar.tsx`) that selects its own entity out of the relevant store (`s.entries.find(...)`, and so on per type) rather than through a stable getter like `getEntry`. A getter's identity never changes, so subscribing to it would not re-render on a rename; selecting the object re-renders just that tab when its entity changes.

Reordering uses Framer Motion (`LazyMotion`, `Reorder.Group`, `Reorder.Item`). `onReorder` passes the new id list to `uiStore.setTabsOrder(ids)`, which validates length and uniqueness before rebuilding and saving the array, so the order persists.

An overflowing tab bar scrolls horizontally on a vertical wheel. `TabBar` attaches a native `wheel` listener with `{ passive: false }` to the `Reorder.Group`'s `<ul>` — React's `onWheel` is passive, so `preventDefault()` there would not stop the page scrolling too. It acts only when the tabs overflow and `|deltaY| > |deltaX|` (so horizontal trackpad scrolling isn't redirected), then adds `deltaY` to `scrollLeft`.

Middle-click closes a tab via `onAuxClick`, but each tab also calls `preventDefault()` in `onMouseDown` for `button === 1`: Chromium enters native autoscroll on the middle `mousedown`, before `auxclick` fires, which made the close feel like it fought the pointer.

## Navigation History

Each tab has its own back/forward history; there is none for the whole window. `OpenTab.history` (`NavHistory` in `src/lib/tabs.ts`) is `{ views, index }`, maintained by helpers there:

- `pushHistory(history, view)` appends past the current index and drops whatever was ahead (a step after Back discards the old "future"), capped at `MAX_HISTORY_LENGTH` (50). The same page again (same `type` and `id`, e.g. switching read/edit mode) is not a new step.
- `stripSessionFlags(view)` drops `isNew` (see [Cancel](editing.md#cancel-discarding-new-entries-and-reverting-autosaved-edits)) before a view enters any history.
- `freshHistory(view)` starts a one-entry history — for a new tab (`addTab`, `openViewInNewTab`) and whenever a history can't be trusted (vault switch, invalid saved data).
- `normalizeSavedHistory(raw, view)` restores a saved history; a malformed shape, an unknown view type (`isViewId`) or an out-of-range index falls back to `freshHistory` at the tab's view.

`uiStore.tablessHistory` is used while no tab is open. `selectActiveHistory(state)` returns the active tab's history, or `tablessHistory` when `activeTabId` is null; everything that reads "the current history" (`TitleBar`'s Back/Forward, `navigateBack`/`navigateForward`) goes through it. `setActiveView` pushes onto the active history; selecting another tab is *not* a step.

The tab auto-created when a content view opens with no tabs inherits `tablessHistory`, so Back returns to where the view was opened from; `tablessHistory` then resets to fresh Home, as it does when the last tab closes, on `closeAllTabs()` and on a vault switch. Closing a tab drops its history.

`navigateBack`/`navigateForward` go through `stepHistory(state, delta)`, which moves the index and, with a tab active, writes the stepped view into the tab and saves it. Mouse back/forward buttons are caught by a macOS NSEvent monitor in `lib.rs`, which emits `navigate-back`/ `navigate-forward`; `AppShell` calls the store actions.

## Left Sidebar (Rail + Entry List)

The left sidebar is two independent components side by side in `AppShell`'s `app-sidebar-left` container.

**`LeftSidebarRail`** (`src/components/layout/LeftSidebarRail.tsx`) is a fixed 44px icon column (`RAIL_WIDTH`, exported for `AppShell` and `TitleBar`):

- Top group: Home, then the modules from `MODULE_LIST`, with Lexicon (an `AUX_VIEWS` entry, not a module) inserted before Altar (see [Module Registry](modules.md#module-registry)). Bottom group: Templates/Blocks/Categories/Tags/Trash, then Vault (opens `VaultModal`) and Settings.
- Every view button comes from `viewButton(type, meta)`, which marks the button of the open view `active` — the accent border `.sidebar-item.active` uses in the entry lists.
- The rail has no panel toggles: all three sidebars are toggled from the *View* menu (`useTitleBarMenus.ts` on Windows/Linux, native on macOS; `menu.rail`/`menu.entryList`/ `menu.properties`). Since Settings and Vault live only in the rail, hiding it hides them too.
- The update check (the dot on the gear) runs once per app start: its promise and "dot shown" flag are module-level, because the rail remounts when the Altar's full-window mode ends.
- Logo, back/forward and the search shortcut are in the title bar (see [Window Chrome](shell.md#window-chrome)), the logo centred in a `RAIL_WIDTH`-wide box above the rail.
- Home's target is not a content view (`isContentView` is false), so it overwrites the active tab instead of opening a new one.
- lucide's `Home` is an alias of `House`, so its SVG has the class `.lucide-house`, not `.lucide-home`.

**`LeftSidebarEntryList`** (`src/components/layout/LeftSidebarEntryList.tsx`) is the adjoining panel, shown while `uiStore.leftListOpen` is true. Which single list it shows — all modules together or one module — is the vault setting `leftList.list` (Settings → Sidebar). `TAB_LISTS` maps each `LeftListTabId` to a component: five per-module lists (`JournalList`, `TasksList`, `OperationsList`, `WikiList`, `AltarList`) and `AllList`, all five combined and sorted by `updated_at` descending.

Each per-module list is `<EntryListTab {...config} />` around a `use*Config()` hook returning `EntryListTabProps<T>`. `AllList` calls all five hooks and flattens them through `toAllRows()` into type-erased `AllRow`s, so the combined list reuses each module's real handlers (duplicate, delete-with-undo, rename, context menu, drag start).

`EntryListTab<T>` (`src/components/ui/EntryListTab.tsx`) owns search filtering, inline rename, drag-start wiring and the right-click `ContextMenu`; creating items is the dashboards' job. Callers supply accessors (`getId`/`getTitle`/`getEditTitle`/`getIcon`/`getDateStr`) and actions; `getTitle` returns the display title, `getEditTitle` the stored title renaming starts from. Tasks need a different row (a checkbox) and use the `renderRow` render prop, which can't survive `toAllRows()`'s type erasure — so in `AllList` tasks get the plain accessor row.

`AppShell` owns widths and resizing. The rail's width is fixed; the entry list's (`entry-list-width` in `localStorage`, min `ENTRY_LIST_MIN` = 180) is resizable with the same drag handle as the right sidebar, which renders only while the list is open. The `<aside>` is `(railOpen ? RAIL_WIDTH : 0) + (leftListOpen ? entryListWidth : 0)` wide; its right border is dropped when both are closed, or a 1px line would remain at zero width.

Hiding the rail slides it out with a negative `margin-left` on the container holding rail and list, so the list moves flush to the window edge, and animates a `padding-left` on `.app-sheet-frame` so the sheet gets its own left inset only once nothing sits beside it (see [Shell Layout](../design.md#shell-layout)). The rail stays mounted, `inert`/`aria-hidden` while hidden, so its effects aren't torn down and restarted on every toggle.

**Default widths.** `ENTRY_LIST_DEFAULT` is 226px, so list plus rail stay wider than the title bar's tool group on Windows/Linux (logo box, menu, three navigation buttons, Export/Import — about 238px) and the tabs start flush with the sheet below. `RIGHT_DEFAULT` is `RAIL_WIDTH + ENTRY_LIST_DEFAULT` (270px), matching the whole left side. Widths are written only on drag-end, so an installation that never resized follows the defaults.

**Open/close animation.** Both sidebars animate `width` (200ms) via `.app-sidebar-animated` in `index.css` — a class rather than an inline `transition`, so the `prefers-reduced-motion` override after it wins by source order. `AppShell`'s `resizing` state removes the class during a drag so the edge doesn't lag the pointer.

- Both asides are `overflow-hidden` and their content keeps its pixel width (left row `RAIL_WIDTH + entryListWidth`, right content `absolute right-0` at `rightWidth`), so content is clipped rather than squeezed mid-animation. The right sidebar's divider sits on that content, not the `<aside>`, or it would remain as a 1px stripe when collapsed.
- `useDeferredUnmount` keeps a panel mounted for the animation and drops it afterwards (a timeout, not `transitionend`, which never fires under `prefers-reduced-motion`) — `AllList` and `AltarSidebarPanel` run hooks, effects and drag listeners that shouldn't run while invisible.
- A closed but still-mounted panel's wrapper carries both `inert` and `aria-hidden`, since `inert` alone is a no-op on older WebKit.

**All three sidebars remember their open state.** `railOpen`, `leftListOpen` and `rightSidebarOpen` persist to `localStorage` (`rail-open`, `left-list-open`, `right-sidebar-open` via `loadOpenFlag`/`saveOpenFlag` in `uiStore.ts`; `'1'`/`'0'`, open when absent) and are restored before the first render. Only an explicit toggle writes the flag. `viewNeedsSidebar(view)` — Save/Cancel/Delete need the right sidebar, so edit mode must not leave it closed (see [Edit Mode Architecture](editing.md#edit-mode-architecture)) — also applies at startup: `rightSidebarOpen` starts as `loadOpenFlag(...) || viewNeedsSidebar(initialView)`, so a restored tab in edit mode (or a library page) opens the sidebar even if it was stored closed; that forced open is not written back.
