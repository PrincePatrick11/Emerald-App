# Components

The app's shared building blocks and the rules for when to use them. This file is a
**specification**, not an inventory — it answers "does this already exist?" and "may I
deviate here?".

For the *look* of these building blocks (colour values, radius, icon sizes, theme classes)
see [`design.md`](design.md). For their place in the module tree see
[`architecture.md`](architecture.md). What is recorded here is the contract only: what a
building block encapsulates and what the caller supplies.

## Rule

**Search first, then build.** Before every new component, every new Tailwind class-chain
recipe and every new utility function: check the catalogue below.

**A deviation needs a reason in the code.** Not in a commit message and not in this file,
but as a comment at the place that deviates. Whoever trips over it in a year reads the
code, not the history. The sections [When Deviating Is Right](#when-deviating-is-right) and
[Known Duplication](#known-duplication) are the exceptions that already have this scrutiny
behind them.

**A third copy means centralise.** Two similar places are not yet duplication — at the
third it is established that this is a pattern and not a coincidence. Abstracting earlier
produces a component that fits nobody.

## Chrome Principle

Every shared building block here standardises **the shell, not the content**: frame,
surface, position, open/close, keyboard behaviour. What goes inside stays the caller's
business.

The escape hatch is therefore **part of the contract, not a loophole**. Using it does not
bypass the component — it uses it as intended:

| Building block | Escape hatch | Intended for |
| --- | --- | --- |
| `Modal` | `children` | the entire dialog content |
| `EmojiPicker` | `trigger` render prop | the trigger looks completely different per context |
| `Dashboard` | `renderItem`, `grouping.mode='custom'` | item look, respectively a structure that cannot be grouped |
| `EntryListTab` | `renderRow` | a row that is not an icon row (Tasks' checkbox) |
| `EntryDetailFrame` | `children` plus the `breadcrumbMeta`/`topbarRight`/`aboveTitle`/`belowTitle` slots | everything below the shared topbar/title/tag shell — the entry's own body and per-module extras |
| `Button` | `className` is **appended**, not replaced | layout and spacing per call site |

The converse holds too: a shell you end up overriding completely is the wrong shell. If
`className` on a `Button` undoes half the variant, a variant is missing — and it belongs in
`Button`, not in the caller.

## Catalogue

### `src/components/ui/` — Shared Components

| Building block | For | Extension point |
| --- | --- | --- |
| `Button` | **every** action button. Four variants (`primary`/`secondary`/`ghost`/`danger`) plus a separate tinted row-action mode (`tone`: `jade`/`amber`/`danger`/`neutral`) | `className` (appended), `compact`, `fill`, `active` |
| `Modal` | overlay, card, header with close X, `createPortal`, escape-to-close | `children`; `dismissible={false}` removes all three ways to close at once; `className`/`bodyClassName`/`widthClassName`/`maxHeightClassName` |
| `ContextMenu` | right-click menu. Portal, edge logic, closes on click and Escape | `actions: ContextMenuAction[]`, each with `icon` and `danger` |
| `EmojiPicker` | emoji popover: open/close, portal, search across the full localised emoji set, outside click, Escape in the capture phase | `trigger` render prop, `emojis` (default: `DEFAULT_EMOJI_PICKER_EMOJIS`), `align`, `size` |
| `Dashboard` | chrome of the six module overview screens: topbar, toolbar, filter, grouping, empty state | `renderItem`, `grouping` (`flat`/`timeline`/`category`/`custom`), category mode's `isGroupCollapsed` (a collapsed group renders only its header — the chevron itself lives in the caller's `renderGroupHeader`), `headerLeft`/`headerRight`, `toolbarExtraActions` |
| `EntryListTab` | rows of the sidebar lists: search, empty state, inline rename, drag start, context menu, "+" quick create | accessors `getId`/`getTitle`/`getIcon`/`getDateStr`, `canDrag`, `contextMenuActions`, `renderRow` |
| `ListToolbar` | view/sort/search/filter toggle above a list | `viewOptions`, `extraActions` |
| `FilterPanel` | chip filter surface below the toolbar | `FilterPanelProps` is exported and passed through by `Dashboard` as `filters.panelProps`; `onAllChips` renders a leading "All" chip (active when the selection is empty, click clears it) |
| `RailButton` | icon buttons of the left rail and the title bar navigation. Thin wrapper around `.btn-ghost` | full `ButtonHTMLAttributes` |
| `TabIconButton` | active/idle toggle of the tab icons in both sidebars | `active` |
| `UndoToast` | global undo toast, rendered once in `AppShell`, fed from `undoStore` | none — do not add it per view |
| `ImportDestinationModal` | destination picker on import, likewise once globally in `AppShell` | none |
| `FilterChipButton` | the filter-pill toggle (same file as `FilterPanel`) — used by the panel's own chips and the Settings backup include-lists | `active`, `onClick`, `children` |
| `VaultLocationRow` | choose-folder button plus the folder a new vault will land in, path shown in full on its own wrapping line (lives in `layout/VaultModal.tsx`, like `VaultGlyph`) — used by the vault modal's create row and the Settings add-vault import | `dense` (flatter button for the settings panel) |
| `Dropdown` | generic themed dropdown menu — extracted from `ListToolbar`'s private copy; `HomeView`'s near-verbatim clone was deleted in the same pass. Backs `ListToolbar`'s own chips, `CategorySelect` below, and `TaskRow`'s priority menu (previously its own hand-rolled menu with its own CSS classes) | `trigger` render prop (`EmojiPicker` convention: one popover, per-context trigger), `portal` (fixed-position, opens upward when short on room below — needed inside `RightSidebar`'s overflow container), `label`, option `emoji`/`icon`/`className` (a leading icon and a per-row class, e.g. a priority colour on the active row), `align` |
| `CategoryHeaderRow` | category-group header in Wiki/Operations/Tasks: read mode, edit mode, delete-confirm, all driven by `useCategoryEditor`. Composes `CollapsibleGroupHeader` (below) for its read-mode row | `collapsed`/`onToggleCollapse` (all three views now, not just Tasks), slots `meta`/`actions` (count badge, Tasks' per-category add-task button), `canDelete` |
| `CollapsibleGroupHeader` | the read-only shell of a collapsible group header — chevron, fixed `w-5` emoji column, label, `meta`/`actions` slots. `CategoryHeaderRow` composes it for real categories; the "Uncategorized" headers in Tasks/Wiki/Operations (no backing category row, so no rename/delete) use it directly | `onToggleCollapse` (omit to render a non-collapsible header), `collapsed`, `emoji`, `meta`, `actions` |
| `CollapseChevron` | the one collapse/expand arrow icon — used by `CollapsibleGroupHeader` and the Tasks subtask row's own expand chevron | `collapsed`, `onToggle` |
| `CategoryAddRow` | the "add category" row paired with it: collapsed plus-button, expanded emoji + input + save/cancel | — |
| `CategorySelect` | themed category-assignment picker built on `Dropdown`, replacing two native `<select>`s (Wiki/Operations properties panels) and `TaskRow`'s hand-rolled menu | `variant` (`field` for properties panels — portals; `chip` for `TaskRow`), `align`, `title`, `placeholder` |
| `EntryDetailFrame` | the detail-view frame of Journal, Wiki, Operations and the Sigil view: topbar with breadcrumb and editing marker, title block (input ↔ `h1`, Untitled from the module registry), optional read-only tag row, body container (`'editor'` overflow-hidden + double-click-to-edit, or `'scroll'` for Sigil) | `breadcrumbMeta`, `topbarRight`, `aboveTitle`, `belowTitle` slots; `body` |

`Button` is the building block most likely to be bypassed. A raw `<button>` is only right
when it is not an action button at all: menu entries, list rows, chips, tabs and nav items
are structurally something else and have classes of their own. An action button with a
hand-written Tailwind chain, by contrast, is always a mistake — it only themes in Emerald
Parchment for as long as someone remembers to maintain an override for it.

### `src/components/sidebar/fields/` — Property Panel Building Blocks

| Building block | For | Extension point |
| --- | --- | --- |
| `PropertiesReadView` | layout shell of read mode (section title, footnote) | `children` |
| `PropertiesEditView` | layout shell of edit mode | `children` |
| `PropertySummaryRow` | a single label/value row in read mode | `value: ReactNode`, `badge` (`jade`/`muted`) |
| `Favicon` | emoji-or-image picker including upload, with a `readOnly` variant | `label`, `readOnly` |
| `Banner` | cover image picker including upload, with a `readOnly` variant | `label`, `readOnly` |
| `SelectField` | the properties panels' native category-field select — label row, `op-prop-select` styling, empty option, `'' ↔ null` conversion. Used by Journal (Paradigm/Bannung/Meditation) and Operations (Charging Technique). Deliberately native, not `CategorySelect`: these are small fixed article lists with no builtin/custom distinction — the themed picker is for categories only | `getId`/`getLabel` accessors, `noneLabel` |
| `LinkedWikiInput` / `LinkedOpsInput` | link chips onto wiki respectively operations entries | `inputCls` |
| `PlacedElementRow` | row of a placed altar element including its row actions | the callbacks (`onToggleLocked`, `onDuplicate`, …) |
| `PlacedElementInspector` | the inline X/Y/Rot/Scale inspector under a selected placed-element row (same file as `PlacedElementRow`) | — |
| `PropertySummarySectionTitle` | the small uppercase section title above summary rows (same file as `PropertySummaryRow`) | — |
| `FaviconGlyph` | just the emoji-or-image glyph of `Favicon`, without the picker (same file) | `icon`, `size` |
| `AltarReadingSummary` | the altar's summary block in read mode | — |

**Horizontal padding has exactly one source in the right sidebar** — the scrolling
container in `RightSidebar.tsx`. No panel and no field here adds a `px-*` of its own
(the read view's footnote carries a cosmetic `px-1`, which is alignment, not padding); see
[`design.md`](design.md#heights-and-spacing).

### `src/hooks/` and `src/lib/` — Shared Logic

| Building block | For |
| --- | --- |
| `useCategoryEditor` | category CRUD with confirmation and undo. Generic over the store — used by Tasks, Wiki and Operations, paired with `CategoryHeaderRow`/`CategoryAddRow` for the UI. `AltarLibraryStrip` implements its own category CRUD in its `CategoryModal` instead — undocumented deviation, worth folding in when touched. Exports `CategoryLike`/`CategoryEditorApi` for the two row components above |
| `useEntryEditor` | the editor lifecycle — debounced auto-save, save-on-navigate, save-on-unmount — parameterised over `buildPatch()`/`update()`. Used by JournalView, WikiView and OperationsView, which each held their own drifting copy before |
| `useEditActions` | registers a view's Save/Cancel/Delete into the right sidebar's action bar for as long as `active` is true, ref-latched so the sidebar never calls a stale closure. Used by JournalView, WikiView, OperationsView, AltarView and OperationSigilView, which each carried their own copy of the same effect before |
| `useOutsideClick` | the mousedown-outside(-plus-Escape) dismiss pattern for menus and popovers. Takes the "inside" ref(s) (`refs`, plural — a portalled popover is no longer a DOM descendant of its trigger), `escape` (`true`, or `'capture'` to stop a surrounding `Modal`'s own Escape handler from winning), `capture` (needed where Tauri's `drag.js` calls `stopImmediatePropagation()` on a drag region before bubble listeners ever see the click), and `delay` (skip the opening mousedown itself, e.g. `ContextMenu`'s 50ms). Replaces eight separately written effects: `Dropdown`, `EmojiPicker`, `ContextMenu`, `TitleBarMenuBar`, `TitleBarSearchResults`, `LinkedOpsInput`, `LinkedWikiInput`, `TagInput` |
| `useGlobalSearch` | assembles the search corpus from the stores and runs the query; backs the title bar's search field |
| `useCollapsedSet` | session-local (not persisted) collapse state for a group list — `collapsed` set, `toggle(id)`, `expand(...ids)` (used to open a group for the global search's deep-link navigation). Backs the category groups in Tasks, Wiki and Operations |
| `lib/modules.ts` | the module registry — one source of truth for "which modules exist and what belongs to each": `ENTRY_MODULE_IDS`/`EntryModuleId`, `ViewId`, `LeftListTabId`, `MODULES` (icon, nav label key, untitled key, `entryType`, `usesEditorSidebar`), `AUX_VIEWS`, `TRASH_KINDS`/`TRASH_KIND_ICONS`, `isViewId`, `moduleMeta`, and `viewTypeForEntryType` (moved here from `lib/tabs.ts` — the one place translating the data model's `operation` into `ActiveView`'s `operations`, now a reverse lookup over `MODULES` instead of its own mapping). Import rule: lucide-react and types only — no stores, no components; `store/moduleWiring.ts` wires the stores and `components/layout/moduleViews.ts` wires the lazy views, specifically to keep this file import-cycle-free and out of every bundle that doesn't need a view chunk |
| `store/moduleWiring.ts` | the store-layer half of the registry: `moduleWiring` (each module's store reload), `trashWiring` (restore/permanently-delete per `TrashKind`), and `reloadAllStores`/`reloadModules` (the startup/vault-switch/import reload sequence — tags, then categories, then content, replacing three hand-maintained lists in `vaultStore`, `dbBackup`, and `AppShell`). Import rule: content stores only, never `uiStore`/`vaultStore`/`trashStore` |
| `lib/categories.ts` | `categoryLabel(t, module, cat, fallback)` — builtin-vs-custom display name for Wiki/Operations categories, replacing repeated inline `is_builtin ?` ternaries; `altarCategoryLabel(t, cat)` — the same for Altar categories, which carry no `is_builtin` flag and are matched against their seed name instead. Used by the views, the properties panels, `TrashView`, and `useGlobalSearch` (so Altar's built-in categories are searchable under their translated name too) |
| `lib/formatDate.ts` | `formatEntryDate`/`formatEntryDateLong`/`formatMonthGroup`/`formatDayHeading`/`formatTimeDistance` — the app's only source of locale-aware date formatting, wired into `changeAppLanguage` (date-fns locales lazy-load per language, same pattern as the i18n bundles). `lib/export.ts` and `lib/emeraldFormat.ts` deliberately do not use it — file exports stay locale-independent |
| `lib/sortItems.ts` | the one `SortMode` comparator for every dashboard — date/title/category getters plus an optional tiebreak; `'category'` without a category getter falls back to `date_desc` (Altar, Trash, Home). Replaces seven per-view copies |
| `lib/groupBy.ts` | `groupBy(items, keyFn)` → `DashboardGroup[]`, `groupByMonth` (keyed by the localized month via `formatMonthGroup`), and `groupByCategory(items, categories, categoryId, label, uncategorizedLabel)` — one group per category (including empty ones) plus, only when needed, a trailing `UNCATEGORIZED_KEY` group for items whose category id no longer resolves to any of the ones passed in (its category was moved to Trash). Used by Wiki and Operations; Tasks builds its groups from its own pre-existing category map but shares the same `UNCATEGORIZED_KEY` constant. Replaces five month-grouping loops plus two category remaps and two Trash category maps |
| `lib/serialize.ts` | `serialized(serialKey(domain, id), task)` — chains same-key async tasks so a content store's read-snapshot/merge/write-whole-row update never runs against a stale snapshot from an overlapping update of the same entity. `drainSerialized()` awaits every currently-queued chain (used on vault switch and replace/add-vault import). See [`architecture.md`](architecture.md#store-write-serialization) |
| `lib/dragChannel.ts` | `createDragChannel<T>()` — the module-level set/get/subscribe pub-sub behind `dragState`/`altarDragState`/`routineDragState`, each now a thin named-export adapter over one instance of it |
| `lib/thumbnail.ts` | `canvasToCappedThumbnail` (WebP quality ladder under the shared `THUMBNAIL_MAX_BYTES` cap, JPEG or PNG fallback) — used by the altar cards and the sigil list thumbnails. `THUMBNAIL_W` (640px) is the altar cards' render width only; `OperationSigilView` scales to its own narrower 320px before calling the shared encoder |
| `lib/styleClasses.ts` | repeated Tailwind chains. **The established home for them** — extend it rather than bypassing it |
| `lib/platform.ts` | `isMacOS`, `isWindows`, `platformName`, `isTauri`, `usesCustomWindowControls`, `usesHtmlMenuBar`. The **only** permitted source of platform detection; everything else branches through `html[data-platform]` in CSS, never through scattered `navigator.userAgent` checks |
| `lib/tabs.ts` | tab IDs and `isContentView` only now — `viewTypeForEntryType` moved to `lib/modules.ts` (see above) |
| `lib/helpers.ts` | `generateId`, `nowIso`, `isImageIcon`, `isValidHexColor`, `hexToRgb`, `formatBytes`, `ACCEPTED_IMAGE_MIME`, `isAcceptedImageFile`, `readFileAsDataUrl` |
| `lib/altarConstants.ts` | altar defaults and geometry, notably `getAltarBackgroundStyle` and `resolveResolutionPixels` as sole sources of truth |

The Zustand stores and the hooks are the shared state and behaviour layer. Holding data in
a component that two views need means the wrong place was chosen.

### Semantic CSS Classes in `src/index.css`

They exist so that raw Tailwind chains do not get copied around. A new class here is the
right move as soon as the same chain shows up for the third time.

| Class group | For |
| --- | --- |
| `.btn-primary` / `-secondary` / `-ghost` / `-danger` | buttons — normally through `Button`, not directly |
| `.panel` / `.panel-interactive` | content-carrying cards and tiles |
| `.modal-card` | the dialog surface itself (through `Modal`) |
| `.menu-surface` / `.menu-item` / `.menu-separator` | menu bar dropdowns |
| `.context-menu*` | context menu (its own class set, see [Known Duplication](#known-duplication)) |
| `.input-field` | small text inputs |
| `.emoji-picker-*` | popover, search field and tiles of the emoji picker |
| `.list-toolbar-*` | toolbar chips, menus and search field |
| `.search-result-*` / `.search-match` | results list of the global search |
| `.vault-*` | vault picker (a deliberate deviation, see below) |
| `.sidebar-item` | **a list row, not navigation.** The name suggests the opposite; the class is the row styling of the entry lists |
| `.titlebar`, `.left-sidebar-rail`, `.rail-divider`, `.window-control*` | window chrome |

## When Deviating Is Right

Three cases that have been examined and settled. They are not sloppiness and should not be
"tidied up".

**`.vault-card` instead of `.panel`.** The vault picker deliberately rebuilds the panel
look, because `.panel` demonstrably does not work here: theme overrides beat modifier
classes, and unlayered beats layered. Both traps are described in
[`design.md`](design.md#specificity-traps) — they hit **every** new "active" variant on an
existing `.panel` card, not just the vault picker.

**`MenuDropdown` alongside `ContextMenu`.** Two dropdown implementations, on purpose.
`ContextMenu` positions itself at a cursor coordinate, has a timing trick to survive the
right-click that opened it, and knows neither disabled entries nor submenus. The menu bar
needs exactly those, plus `role="menubar"` with its full keyboard contract.

**The `EmojiPicker`'s trigger stays free.** A large image/emoji button with a label in the
altar item dialog and a bare emoji glyph in a category row have nothing in common but their
function. What is unified is the popover, not the trigger.

What is **not** a valid deviation: "it was faster this way", "just this one place", "looks
almost the same". What the three cases above have in common is that the shared variant
*would not have worked technically* or is *structurally something else*.

## Known Duplication

Open, deliberately recorded, and not an excuse for further copies.

1. **Two surface class sets for dropdowns.** `.menu-surface`/`.menu-item`/
   `.menu-separator` for the menu bar, `.context-menu*` for the context menu. They are
   unified in colour — `.menu-item` sits in the same selector groups as
   `.context-menu-item-default` in both themes — and the row height matches. The structural
   classes are still doubled.
2. **`ContextMenu` uses raw values instead of theme variables**
   (`border-stone-700/60`, `shadow-2xl` instead of `--menu-border`/`--menu-shadow`).
   Resolving 1 and 2 is the same job: reduce `ContextMenu` to `.menu-surface`/`.menu-item`
   plus its `danger` variant.
3. **`LinkPickerModal` is raw on the inside.** Only the outer shell (overlay, card, header,
   portal) runs through `Modal`; the search field and tab text colours still use raw
   `stone-*` utilities.
4. **`AltarLibraryStrip`'s item tiles** rebuild the panel look raw
   (`rounded-md border border-stone-700/60 bg-stone-900/40`) instead of using `.panel` —
   unlike the vault picker, without a technical reason.
5. **The emoji empty-result message** in `EmojiPicker` uses a raw `text-stone-500` instead
   of `--text-muted`; the one unthemed remainder in an otherwise fully CSS-variable-based
   component.
6. **`AltarReadingSummary` rebuilds `PropertySummaryRow` raw.** Its local `BackgroundRow`
   repeats the row's exact class chain (`flex items-center gap-2 px-3 py-2 rounded-lg
   bg-stone-900/45 border border-stone-700/60`) instead of using the component.
7. **Two hand-written buttons in `AltarSidebarPanel`** carry the full `Button
   tone="neutral"` class chain as raw Tailwind, in a file that imports and uses `Button`
   a few lines above.
8. **A third dropdown row class** exists besides `.menu-item`/`.context-menu-item-*`:
   `linked-entry-menu-item` in `LinkedOpsInput`/`LinkedWikiInput`, with its own raw chain.

Whoever touches one of these places anyway clears it up along the way. New entries in this
list need a reason why resolving it was not possible right away.
