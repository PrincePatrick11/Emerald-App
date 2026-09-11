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
| `DashboardItem` | `children` | everything inside the clickable frame — icon, title, meta, a sigil preview, an altar canvas; while renaming, a `RenameField` in place of the title |
| `InlineNameEditor` | the caller's row around it | the leading glyph (emoji picker, colour dot) and the placeholder that keeps it aligned with the read row |
| `EntryDetailFrame` | `children` plus the `breadcrumbMeta`/`topbarRight`/`aboveTitle`/`belowTitle` slots | everything below the shared topbar/title/tag shell — the entry's own body and per-module extras |
| `Button` | `className` is **appended**, not replaced | layout and spacing per call site |

The converse holds too: a shell you end up overriding completely is the wrong shell. If
`className` on a `Button` undoes half the variant, a variant is missing — and it belongs in
`Button`, not in the caller.

## Catalogue

### `src/components/ui/` — Shared Components

| Building block | For | Extension point |
| --- | --- | --- |
| `Button` | **every** action button. Four variants (`primary`/`secondary`/`ghost`/`danger`) plus a separate tinted row-action mode (`tone`: `jade`/`amber`/`danger`/`neutral`) | `className` (appended), `compact`, `small` (tone mode only — 24px instead of 30px, for dense rows like category headers where a 30px button would inflate the text line; its icon belongs on the 12px step), `fill`, `active` |
| `Modal` | overlay, card, header with close X, `createPortal`, escape-to-close | `children`; `dismissible={false}` removes all three ways to close at once; `className`/`bodyClassName`/`widthClassName`/`maxHeightClassName` |
| `ContextMenu` | right-click menu. Portal, edge logic, closes on click and Escape in the capture phase — so a menu opened above a `Modal` doesn't also close the modal underneath, whose own Escape handler otherwise hangs off the same `document`. A row's `onMouseDown` cancels default as well as stopping propagation, so an existing text selection survives the click (needed for `EditContextMenu`'s Cut/Copy) | `actions: ContextMenuAction[]`, each with `icon`, `danger`, `disabled` (dimmed via opacity, same meaning as `MenuDropdown`'s) |
| `EmojiPicker` | emoji popover: open/close, portal, search across the full localised emoji set, outside click, Escape in the capture phase | `trigger` render prop, `emojis` (default: `DEFAULT_EMOJI_PICKER_EMOJIS`), `align`, `size` |
| `Dashboard` | chrome of the overview screens — the six modules plus Blocks, Home and Categories (both through `grouping: 'custom'`, for the header alone) and Tags (`category` mode, one group per tag): toolbar, filter, grouping, empty state. Its whole header lives only in the right sidebar, portalled there via `SidebarPortal` whenever it's open — no inline rendering at all; closing the sidebar removes the header along with it rather than falling back above the list — see [Architecture → List Header Portal](architecture.md#list-header-portal). `title`/`titleIcon`/`titleCount` build the title row through the exported `DashboardTitle`; `headerLeft` replaces the whole row for a head that needs more than that (Trash: `DashboardTitle` plus its "select all" toggle, passed as `children`) | `renderItem`, `grouping` (`flat`/`timeline`/`category`/`custom`), category mode's `isGroupCollapsed` (a collapsed group renders only its header — the chevron itself lives in the caller's `renderGroupHeader`); category mode drops empty groups centrally now — every `DashboardGroup` with no items is filtered out before rendering (Tasks still filters in its own custom-mode render, for the same reason, since `Dashboard`'s central grouping logic doesn't run there); `keepEmptyGroups` opts out, for groups that are something in their own right rather than a global list's bucket — Tags, where an unused tag must stay visible to be managed, and whose caller has already decided which groups stand; `renderEmptyGroup` is only ever reached with `keepEmptyGroups` (Wiki/Operations' copies never rendered and were removed); `sortModes` (passed to `ListToolbar`) narrows or extends the sort choice; `groupBy` (`{ value: GroupingMode, onChange, label? }`) adds the grouping axis to the toolbar, independent of `sort`; `headerLeft`/`headerRight` (replaces the header's action slot — `headerRight` renders in the scrollable column below the title row, where a wide slot can wrap), `view`/`sort`/`onView`/`onSort` are optional, so a view with neither axis (`CategoriesView`, whose order is hand-dragged) gets a toolbar holding only its search; `primaryAction` (a labelled jade button on its own full-width row above the toolbar, since next to the title in that narrow column nothing readable was left of it), `extraActions` (compact icon-only `neutral`-tone buttons right of `primaryAction` on the same row — the labelled button fills the row and these keep their square size beside it; label always in a tooltip — for a secondary area of the same module rather than the module's own primary action, e.g. Altar's "add item" next to "New altar"), `contentHeader` (renders above the content, including in the empty and no-results states — a collapsible heading for the main list itself, e.g. Altar's "Altars" divider above its own cards), `contentFooter` (renders below the content, likewise always — a second area of the same module below the main list, e.g. the Altar library section under the altar cards), `cardsClassName`/`wideCardsClassName` (the grid for `cards` respectively `cards_wide` — separate props rather than one varying by view, since a module may fill the wide card differently, e.g. Altar's taller preview). The exported `GroupDivider` (label, optional `count`/`collapsed`/`onToggleCollapse`) is the timeline groups' own divider-with-heading, reused both as the collapsible section heading above `contentFooter` content and, via `contentHeader`, above the main list itself |
| `EntryListTab` | rows of the sidebar lists: search, empty state, inline rename, drag start, context menu, "+" quick create | accessors `getId`/`getTitle`/`getIcon`/`getDateStr`, `contextMenuActions`, `renderRow`. `onDragStart` is all-or-nothing per config now (no per-item `canDrag` gate) — every module, Tasks and Altar included, now supplies one, since all five are link targets |
| `ListToolbar` | view/sort/grouping/search column for `Dashboard`'s sidebar-portalled header. All three axes are optional: without `onView`/`onSort`/`groupBy` the row is left out, so a list whose order the user drags by hand (`CategoriesView`) can bring nothing but a search field | `viewOptions` (now four: List/Cards/Cards-wide/Timeline — `StretchHorizontal` icon for the wide-card mode); `sortModes` (which `SortMode`s to offer, in order — default the four date/alpha modes; `count_desc`, "most used first" with the `ArrowDown10` icon, is offered only by Tags); `groupBy` (`DashboardGroupBy`, see `Dashboard` above) renders a third icon-toggle row for the grouping axis, greyed out in Timeline view (`GroupingMode`'s `grouped`/`flat`, icons `Layers`/`Grid3x3`, exported as `GROUPING_ICONS`) the same way the timeline already greys out A→Z/Z→A sorting; `SORT_ICONS` is exported too — the Altar library's own sort/grouping row (in `AltarView`, next to this toolbar in the same sidebar header) reuses both icon maps via `IconToggleGroup` directly, rather than through this component, so its smaller, differently-scoped sort list (no "category", since it groups instead) still looks identical. There is only this one, column presentation — no horizontal-strip variant, no `Dropdown`s, and no filter-toggle button (the `FilterPanel` next to it is always visible instead); search sits on its own full-width row above the icon-toggle rows. `extraActions` was removed earlier — Tasks' priority filter moved into `FilterPanel` instead |
| `IconToggleGroup` | a bordered row of icon buttons standing in for a `Dropdown` in `Dashboard`'s sidebar header — one segment per option, active one filled, no visible label (aria-label only) (own file, `src/components/ui/IconToggleGroup.tsx` — pulled out of `ListToolbar` once the Altar library's own sort/grouping row needed the same segment look in the same header) | `options`, `icons: Record<T, LucideIcon>`, `value`/`onChange`, `isDisabled(v)`/`disabledHint` (greys out an option that has no effect in the current combination, e.g. Timeline's blocked sort/grouping modes, rather than hiding it so the row doesn't jump) |
| `FilterPanel` | chip filter column under `ListToolbar` in `Dashboard`'s sidebar header, always visible (no toggle button anywhere shows or hides it) | `FilterPanelProps` is exported and passed through by `Dashboard` as `filters.panelProps`; `onAllChips` renders a leading "All" chip (active when the selection is empty, click clears it); `displayExtras` renders a separate "Display" chip group ahead of the category chips, for toggles that are a view preference rather than a filter (Tasks' "Show completed", Altar's canvas-preview toggle) and therefore should not count in `activeFilterCount` or reset with "Clear all"; `statusChips`' group heading is customisable via `statusLabel` (Tasks reuses the group for its priority chips, replacing the removed `extraPanelContent` slot); `FilterChip.icon` renders a leading Lucide icon before a chip's label (Tasks' priority chips), alongside the existing `emoji`; `extraGroups` (`{ label, content }[]`) renders further labelled groups after the category chips, for controls that are neither filters nor chips — Altar hangs its library's sort/grouping row here, so it lands in the same panel as the rest of the dashboard header instead of in the content; `onClearAll` is now optional, for a panel with no real filter to clear (Altar's is just a display toggle, so `activeFilterCount` never leaves zero and the button that calls it is never rendered). Group headings use `label-xs`, matching the Properties panels in the same sidebar. The "Only with entries" chip (`nonEmptyOnly`/`onNonEmptyToggle`) is gone — `Dashboard` now drops empty category/phase groups centrally (only `keepEmptyGroups` opts out), see above |
| `RailButton` | icon buttons of the left rail and the title bar navigation. Thin wrapper around `.btn-ghost` | full `ButtonHTMLAttributes` |
| `TabIconButton` | active/idle toggle of the tab icons in both sidebars, and of `IconToggleGroup`'s segments | `active`, `compact` (26px instead of 30px, for the denser sidebar icon-toggle rows), `disabled` (with `title` — used for Timeline's blocked sort/grouping options) |
| `UndoToast` | global undo toast, rendered once in `AppShell`, fed from `undoStore` | none — do not add it per view |
| `ImportDestinationModal` | destination picker on import, likewise once globally in `AppShell` | none |
| `FilterChipButton` | the filter-pill toggle (same file as `FilterPanel`) — used by the panel's own chips and the Settings backup include-lists | `active`, `onClick`, `children` |
| `VaultLocationRow` | choose-folder button plus the folder a new vault will land in, path shown in full on its own wrapping line (lives in `layout/VaultModal.tsx`, like `VaultGlyph`) — used by the vault modal's create row and the Settings add-vault import | `dense` (flatter button for the settings panel) |
| `Dropdown` | generic themed dropdown menu — originally extracted from `ListToolbar`'s private copy, which has since moved to `IconToggleGroup` and no longer uses it. Backs `HomeView`'s own per-section toolbar, `CategorySelect` below, and `TaskRow`'s priority menu (previously its own hand-rolled menu with its own CSS classes) | `trigger` render prop (`EmojiPicker` convention: one popover, per-context trigger), `portal` (fixed-position, opens upward when short on room below — needed inside `RightSidebar`'s overflow container), `label`, option `emoji`/`icon`/`className` (a leading icon and a per-row class, e.g. a priority colour on the active row), option `disabled`/`title` (Timeline's blocked A→Z/Z→A/Category sort options), `align` |
| `CollapsibleGroupHeader` | the **one** group header — chevron, fixed `w-5` emoji column, label, `count`/`meta`/`actions` slots, and a jade "+" that creates an entry directly in that group. Used for category groups in Wiki/Operations/Tasks/Altar, for their "Uncategorized" buckets (no backing category row, and no "+" — there is nothing to create in a category that has been trashed), for Journal's moon-phase groups and for the tag groups in `TagsView`. It absorbed the former `CategoryHeaderRow` when category *management* moved to `CategoriesView`: without the pencil and the delete-confirm, that component was this one plus a "+". It manages nothing itself — `TagsView`, which *is* the tag management, hands its colour dot and rename/delete buttons in through `leading`/`actions` | `onToggleCollapse` (omit to render a non-collapsible header), `collapsed`, `emoji`, `leading` (a node in place of the emoji, same `w-5` column — Tags' colour dot), `count` (renders the "(n)" counter centrally — replaces a `meta={<span>...}` counter span repeated at every call site), `add` (`{ title, onClick }` — the jade "+", `Button`'s tone-coded mode in the `small` 24px variant, sized to fit the header's text line; one prop rather than two, so the icon button cannot be rendered without an accessible name), `meta`, `actions` |
| `DashboardItem` | a clickable item inside a `Dashboard`: the `panel-interactive` frame (`layout: 'row'` or `'card'`), click opens `view` via `setActiveView`, middle-click opens it via `openViewInNewTab`. With `editing` it renders the same frame as a plain `div` without its handlers (click, middle-click, context menu), for in-place renaming with `RenameField` inside. Used by `renderItem` in Journal, Wiki, Operations, Tags and Blocks and by `AltarCard`/`AltarListRow` — the hand-written copies had drifted (Journal and Altar had no middle-click). `.panel-interactive` carries its own `:focus-visible` ring in both theme blocks for it. **Open:** `HomeView`'s six section buttons still hand-write the frame — the three list rows match `row` (their content sits in an inner flex block that would have to be unwrapped), the three cards are denser (`px-3 py-3`) than `card`; Home has neither middle-click nor an "Open in new tab" entry until they move over | `view`, `layout`, `onContextMenu`, `editing`, `children` |
| `InlineConfirm` | the "Sure? Yes, delete / Cancel" confirmation in place of a row's actions — `danger`/`neutral` tone buttons, question in `--text-muted`. When it shows stays the caller's (a `confirming…` state the trigger button sets; `onConfirm` only executes). Used by Categories, Tags, Trash (rows, cards, bulk delete, empty trash), `AltarItemModal` and the Blocks page's "Update all" — Trash had drifted to `variant` buttons with hand-tuned padding, Categories had no question | `message` (default "Sure?"), `confirmLabel` (Trash's bulk delete keeps the count on it), `tone` (default `danger`; `jade` for a confirmation that changes rather than deletes — the Blocks page's "Update all"), `small` (24px buttons for dense headers), `wrap` (question and buttons may wrap — for the right sidebar's narrow header column; rows keep it off so the confirmation doesn't shrink), `variant: 'banner'` (a full-width strip on the `--danger-bg`/`--danger-border` tokens with `.text-danger`, for dialogs — `tone` is `inline`-only, a banner is always a delete) |
| `SidebarColumn` | the shell of a right-sidebar column: a `bar` (usually a `SidebarActionBar`) on top, the scrolling `p-3` body below. The one place the column's horizontal inset is set — a panel adding its own `px-*` would misalign its rows against the bar's `px-3` above it. Used by `RightSidebar` (an entry's Properties), `Dashboard`'s header and the Blocks page | `bar`, `bodyClassName` (appended to the body — `Dashboard`'s `space-y-4` between its header groups) |
| `SidebarActionBar` / `EditActionBar` | the 56px bar at the top of a `SidebarColumn` (own file, `src/components/ui/SidebarColumn.tsx`). `SidebarActionBar` is the bare 56px/`px-3` row; `EditActionBar` is Done/Delete/Cancel inside one, used by `RightSidebar`'s edit-mode action bar and the Blocks page — previously two hand-written copies of the same three buttons | `SidebarActionBar`: `children`. `EditActionBar`: `onDone`, `onDelete` (omit for no Delete button), `onCancel`, `busy` (disables Done while saving) |
| `SidebarPortal` | renders into `uiStore.listHeaderHost` — the right sidebar's portal target — or nothing if the sidebar is closed, same rule as `Dashboard`'s header. Read by `Dashboard` (its header) and the Blocks page (Done/Delete/Cancel, icon, display rules, usage); `MainArea` renders one view at a time, so never more than one of the two is mounted — see [Architecture → List Header Portal](architecture.md#list-header-portal) | `children` |
| `RenameField` | the in-place rename input: Enter and blur commit, Escape cancels. The content of a `DashboardItem` with `editing` in Journal, Wiki, Operations and the altar cards (moved out of `altar/` when those three stopped hand-writing it). `EntryListTab`, `LeftSidebarEntryList` and `TaskRow` still carry their own copy | `value`/`onChange`, `onCommit`/`onCancel`, `className` (the caller's type styles, so the field looks like the title it replaces) |
| `InlineNameEditor` | the body of a one-line name editor: input (Enter saves, Escape cancels), error text, jade Save and neutral Cancel icon buttons. A bare fragment — `CategoryEditRow` and `TagEditRow` wrap it in their own row with their own leading glyph | `value`/`onChange`, `error`, `onSave`/`onCancel`, `placeholder` |
| `ModuleCounts` | the per-module usage counters — module icon plus number, dimmed at 0, module name in the tooltip. Used by `CategoriesView`'s rows and `TagsView`'s group headers | `modules` (column order, fixed so the numbers line up), `counts` |
| `CollapseChevron` | the one collapse/expand arrow icon — used by `CollapsibleGroupHeader` and the Tasks subtask row's own expand chevron | `collapsed`, `onToggle` |
| `CategorySelect` | themed category-assignment picker built on `Dropdown`, replacing two native `<select>`s (Wiki/Operations properties panels) and `TaskRow`'s hand-rolled menu; also used by the altar library's `AltarItemModal` (add/edit item dialog), replacing a row of category chips. Its list opens with an "Uncategorized" entry — since v39 a real value (`null`; `value`/`onChange` are nullable), not just the trigger's text for a category that no longer resolves: it is what a new entry carries, and picking it again clears an assignment | `variant` (`field` for properties panels and `AltarItemModal` — portals; `chip` for `TaskRow`), `align`, `title`. The former `placeholder` is gone — the empty state has a name now |
| `EntryDetailFrame` | the detail-view frame of Journal, Wiki and Operations: topbar with breadcrumb and editing marker, title block (input ↔ `h1`, Untitled from the module registry), optional read-only tag row, body container, which scrolls (the `body: 'editor' | 'scroll'` switch is gone — every body scrolls in the frame now, since `BlockStack`'s sticky toolbar needs the frame to be the scroll container). Edit mode is entered exclusively via the right sidebar's Edit button — the frame has no double-click gesture and no `onEnterEditMode` prop | `breadcrumbMeta`, `aboveTitle`, `belowTitle` slots |
| `EmeraldMark` | the app's static brand mark (the loading screen's gem, standing still) — the title bar's logo (20px) and the Settings "About" card's header (30px). Colours are class names resolved in `src/index.css` (`.emerald-mark*`), not `var()` on the SVG element — a presentation-attribute `var()` silently falls back to black on engines that don't substitute it, the same trap `public/splash.css` avoids for the loading screen's own gem. The shape's coordinates are deliberately kept identical to the loading screen's and to the two `src-tauri/icons/source/*.svg` templates, none of which can import this component (raw `index.html`, build-time SVGs) — changing the cut means updating all four by hand | `size` (required), `className` |
| `EditContextMenu` | the app's own right-click menu for text, replacing the WebView's native one everywhere it applies: Cut/Copy/Paste/Select all in an editable field, Copy on selected read-only text elsewhere. Built on `ContextMenu`. Two exceptions keep the native menu: the rich-text editor (spell-check suggestions can't be reproduced from JS) and any element whose own handler already called `preventDefault`. Rendered once in `App.tsx`, alongside `AppShell` rather than inside it — `AppShell` returns early for the first-run vault-setup screen, and the menu has to reach that screen's fields too. Reuses the title bar's `editCommands.ts` and the shared `menu.*` i18n keys | none |
| `SettingsSection` | a Settings page's section heading — icon plus title, on `.label-xs` (lives in `layout/settings/`, used by every settings page) | `icon`, `title`, `children` |
| `SettingsChoiceButton` | the Settings choice-button state chain (`.settings-choice-btn*`, values for both themes in the stylesheet) — backs the theme picker, the language picker, and the import-mode cards (lives in `layout/settings/`) | `active`; padding and shape stay with the caller (narrow chips for theme/language, full-width two-line cards for import mode) |

`Button` is the building block most likely to be bypassed. A raw `<button>` is only right
when it is not an action button at all: menu entries, list rows, chips, tabs and nav items
are structurally something else and have classes of their own. An action button with a
hand-written Tailwind chain, by contrast, is always a mistake — it only themes in Emerald
Parchment for as long as someone remembers to maintain an override for it.

### `src/components/blocks/` — Content Blocks

See [`architecture.md` → Content Blocks](architecture.md#content-blocks) for the stored format.

| Building block | For | Extension point |
| --- | --- | --- |
| `BlockStack` | an entry's body as a stack of blocks — Journal, Wiki, Operations. Owns everything that may exist only once per open entry: the sticky `EditorToolbar` for the focused text block, `LinkPickerModal`, the `lib/links.ts` link requests, chip navigation, file and pointer drops, the drag ghost | `initialContent` (initial value only — remount via `key`), `isEditing`, `placeholder` (first text block), `onChange(content)` |
| `BlockFrame` | a block's shell: invisible in read mode; in edit mode a subtle frame with grip, type label and "…" menu, plus a "Newer version" pill on an outdated copy of a user-built block. Keeps its body at one tree position across modes, so a mode switch never remounts a block | `icon`, `label`, `outdated`, `onGripPointerDown`, `onOpenMenu`, `children` |
| `blockViews.ts` | type → component (`BLOCK_VIEWS`): `TextBlock`, `FieldsBlock`, the three sigil blocks. Every view gets `block`, `isEditing`, `onHtmlChange`/`onBlockChange`/`onPersist` and the entry's `sigil` state. Imported only by `BlockStack` — the text block pulls in TipTap | new block types register here, their metadata in `lib/blocks/blockTypes.ts` |
| `UnknownBlock` | fallback for a type this version can't render: its inner HTML through DOMPurify with a tight tag allowlist (no `style`/`class`/forms), links opened via `openUrl` only for http(s), read-only | — |
| `BlockErrorBoundary` | wraps every block's view in `BlockStack`: a block whose render throws (broken imported data, a bug in a type) falls back to `UnknownBlock` instead of blanking the app — which would otherwise repeat on every start, since the open tab is restored. Retries when the block is replaced | `block`, `children` |
| `BlockSidebarArea` | the right sidebar's block manager for the open entry, fed by `blockSessionStore` (see [`architecture.md` → Content Blocks](architecture.md#content-blocks)): reorderable rows (same look as the altar's `PlacedElementRow`) with eye, rename, "show title in read mode", duplicate, remove, "+ Add block"; a jump-to outline in read mode | — |
| `blockSidebarViews.ts` | type → `{ Read?, Edit? }` sidebar sections a block type brings along, looked up by the *resolved* type (a too-new data version gets no view); empty so far. Only `Edit` receives `setAttr`. Must not import TipTap (the sidebar is eager) | new types register their sections here |
| `FieldsBlock` | the fields block (`core.fields`): read mode a quiet label/value list in the editor font, edit mode an input per element kind (text/number/date inputs, `Dropdown` for choice and moon phase, a yes/no switch, checklist, link via `LinkedEntryPicker`, image via `saveImage`). Controlled — reads the block every render, writes through `onBlockChange`/`onPersist` | — |
| `FieldsSidebarEdit` | the fields block's sidebar section (edit mode): per-element label, options for a choice, "hide in read mode when empty"; "fully read-only" for the block | — |
| `useFieldFallbackText` | the localized texts `serializeFields` writes the readable fallback with — one source for block and sidebar section | — |
| `blockActions.tsx` | the context-menu entries stack and sidebar share: `addBlockActions` (one per preset, then the user's own blocks from `blockDefinitionStore`) and `commonBlockActions` (duplicate — not for unknown types — and remove) | each menu prepends its own entries |
| `BlockGlyph` | a block's icon: a lucide icon, or a user-built block's own icon (emoji or image) in the same box — frame, manager rows, add menu and the Blocks list/page show it alike | `icon` (`GlyphSource` from `presets.ts`), `size` |
| `BlockCheckbox` | label + `.block-checkbox` (theme accent) + optional hint line — the settings of the block sidebar sections and the Blocks view's builder | `checked`, `onChange`, `label`, `hint`, `disabled` |
| `BlockLink` | `LinkEditor` (chosen entry with ×, else the search) and `LinkTarget` (a live chip that opens the entry) for a link stored as a chip in a block's markup — shared by the fields block's link element and the sigil charge's charging technique | `slot`/`onChange`, `target`/`onRemove` |
| `SigilCalcBlock` | the sigil calculator: intention, manual/automatic reduction to the letter bank, implemented letters; read-only while charged, hidden while concealed | — |
| `SigilCanvasBlock` | the sigil drawing: `SigilDrawingCanvas` with pen/eraser, brush, colours, undo/redo/clear (history in memory); each stroke saved as an image file, the block keeps only the name; read mode an `<img>` | — |
| `SigilChargeBlock` | the charge: reveal date, charging technique (`BlockLink`), lock scope; in read mode load (optional timer) and unload, each with an inline confirmation, written through `onPersist` | — |
| `SigilDrawingCanvas` | the 1200×800 drawing surface (from the former sigil view); reports a data URL after each stroke. `initialData` must be a data URL — an `emerald-img:` image would taint it | `initialData`, `mode`, `brushColor`, `brushSize`, `clearVersion`, `editable`, `onChange` |
| `SigilConcealed` | the quiet "hidden until …" line calculator and drawing show while concealed | `revealDate` |
| `OptionsEditor` | a choice element's options (rename, remove, add; values store the option id) — shared by `FieldsSidebarEdit` and the Blocks view's builder | `options`, `onChange` |
| `BlockDefinitionEditor` | the builder of a user-built block in `views/BlocksView.tsx`: emoji, name, description, fields (add by kind, label, reorder by grip, remove — archived once saved, restorable), display rules; edits a draft that only "Save" writes (so the revision rises once per save, not per keystroke) — `BlocksView` keeps an unsaved draft per block while the view is open, so switching blocks loses nothing; usage with "Update all" (`blockCopies.updateAllCopies`) and the two-step delete modal (keep copies by default; "also remove from N entries" needs a second confirmation) | — |

The editor helpers `BlockStack` composes live in `src/components/editor/`: `editorCommands.ts`
(`appendEntryLink`/`removeEntryLink`/`revealEntryLink`/`findEntryLinkPos`,
`insertImageFromDataUrl`, `insertInternalLinkChip`), `useEditorFileDrop`,
`useEditorPointerDrops`, `useInternalLinkNavigation`, `DragGhost`, `ImageFormatErrorModal`.
`RichEditor` is a text block's writing surface only; its `onEditorReady` reports the instance to
the stack.

### `src/components/sidebar/fields/` — Property Panel Building Blocks

| Building block | For | Extension point |
| --- | --- | --- |
| `SidebarSectionHeader` | the collapsible section heading of the right sidebar — chevron plus small uppercase label on `.sidebar-section-title` (theme variables, focus ring; `PropertySummarySectionTitle` shares the class). Controlled, because callers keep open state differently (the altar per altar in one localStorage object, the block manager via `usePersistedFlag`). Replaced six hand-written copies in `AltarSidebarPanel` | `label`, `open`, `onToggle`, `className` (spacing only — the wrapper stays the caller's) |
| `PropertiesReadView` | layout shell of read mode (section title, footnote) | `children` |
| `PropertiesEditView` | layout shell of edit mode | `children` |
| `PropertySummaryRow` | a single label/value row in read mode | `value: ReactNode`, `badge` (`jade`/`muted`) |
| `IconCoverField` | icon and cover image under one heading ("Icon + Cover Image") and one wrapping button row, for the two modules that have both (Wiki, Operations) — composes `Favicon` and `Banner`; in read mode it shows the "None" fallback itself, once, only when neither is set | `readOnly` |
| `Favicon` | emoji-or-image picker including upload, in edit and read-only mode. Renders as a fragment — no heading, no wrapper, no "None" fallback — so every caller supplies those: `IconCoverField` for Wiki/Operations, `AltarSidebarPanel` directly under its own collapsible icon header | `readOnly` |
| `Banner` | cover image picker including upload, likewise a bare fragment — used only inside `IconCoverField` | `readOnly` |
| `SelectField` | the properties panels' native category-field select — label row, `op-prop-select` styling, empty option, `'' ↔ null` conversion. Used by Operations (Charging Technique); Journal's Paradigm/Bannung/Meditation fields were retired with migration v37. Deliberately native, not `CategorySelect`: these are small fixed article lists with no builtin/custom distinction — the themed picker is for categories only | `getId`/`getLabel` accessors, `noneLabel` |
| `LinkedEntryPicker` | the shared chrome behind all three link-picker fields below: search input, portalled `fixed`/`z-9999` result menu at `document.body` (the fields live in the right sidebar's `overflow-y-auto`, where an absolutely-positioned menu would be clipped), outside-click, empty-state, flip-up when short on room below. `chips` is a plain `ReactNode` slot above the search input — the picker no longer wraps it in a row; each caller owns that layout (`LinkedOpsInput`/`LinkedWikiInput` bring their own single wrapping `flex flex-wrap` row, `LinkedEntriesField` brings category-grouped ones, see below). Exports `LinkedEntryChip` (the chip itself — `onClick` makes the label jump to it, `onRemove` adds the "×") and `LINK_RESULT_LIMIT` (8 — for the two single-module id fields; `LinkedEntriesField` sets its own 50, because it searches all five modules at once) | `chips`, `results`/`resultKey`/`renderResult`, `inputCls` |
| `LinkItemIcon` | a link target's icon in chips and result rows — image (altar), emoji, or the type's default (same file as `LinkedEntryPicker`; used by `LinkedEntriesField` and the fields block's link element) | `item` |
| `LinkedEntriesField` | Journal/Wiki/Operations' "Linked entries" sidebar field. Reads what the entry links out of its own `content` (`extractInternalLinks`) across all five entry types, rather than an id array; in edit mode, picking a result appends a link block into the editor and removing one asks the editor to delete it — both via the `lib/links.ts` event protocol, since the field has no reference to the TipTap instance. Chips are grouped by `categoryLabel`, each group under its own small uppercase heading (entries with no category trail at the end, unheaded); the suggestion list is sorted by `SuggestionItem.updatedAt` descending rather than module order, so an empty search doesn't just show whichever module `buildLinkItems` happens to list first | `content`, `legacyIds` (read-only bridge for entries a pre-v36 backup restored into the old `linked_operation_ids`/`linked_wiki_ids` columns — see [`database.md`](database.md#journal_entries)), `editable`, `inputCls` |
| `LinkedWikiInput` / `LinkedOpsInput` | id-array editors built on `LinkedEntryPicker`, used only by `RoutinesPanel`'s routine templates (a routine's own `operation_ids`/`wiki_ids` fields, not an entry's links) | `inputCls` |
| `PlacedElementRow` | row of a placed altar element including its row actions | the callbacks (`onToggleLocked`, `onDuplicate`, …) |
| `PlacedElementInspector` | the inline X/Y/Rot/Scale inspector under a selected placed-element row (same file as `PlacedElementRow`) | — |
| `PropertySummarySectionTitle` | the small uppercase section title above summary rows (same file as `PropertySummaryRow`) | — |
| `FaviconGlyph` | just the emoji-or-image glyph of `Favicon`, without the picker (same file). Default 20px, the size of a row's meta text; `className` overrides it for a caller that shows the icon large — the Altar dashboard card, standing in for the canvas preview when it's turned off | `value`, `className` |
| `AltarReadingSummary` | the altar's summary block in read mode | — |

**Horizontal padding has exactly one source in the right sidebar** — the scrolling
container in `RightSidebar.tsx`. No panel and no field here adds a `px-*` of its own
(the read view's footnote carries a cosmetic `px-1`, which is alignment, not padding); see
[`design.md`](design.md#heights-and-spacing).

### `src/hooks/` and `src/lib/` — Shared Logic

| Building block | For |
| --- | --- |
| `useEntryEditor` | the editor lifecycle — debounced auto-save, save-on-navigate, save-on-unmount — parameterised over `buildPatch()`/`update()`. Used by JournalView, WikiView and OperationsView, which each held their own drifting copy before |
| `useEditActions` | registers a view's Save/Cancel/Delete into the right sidebar's action bar for as long as `active` is true, ref-latched so the sidebar never calls a stale closure. Used by JournalView, WikiView, OperationsView and AltarView, which each carried their own copy of the same effect before |
| `useDeepLink` | the global search's deep link for a view without a detail page: `{ type, id }` runs the caller's `onOpen(target)` once (clear search/filters, expand groups), then scrolls the row carrying `rowAttribute` into view a frame later. Latches on the `activeView` object (a fresh one per navigation, so the same hit works twice) and remembers the handled one, so `items` can be a dependency — a link that finds an empty store fires once the list arrives — without later mutations resetting the user's filters. `onOpen` is ref-latched like `useEditActions`. Returns `scrollTo(id)` for a scroll without a deep link (Tags' newly created tag). Used by TasksView (`block: 'center'`), CategoriesView (whose 2s highlight stays in the view) and TagsView |
| `useOutsideClick` | the mousedown-outside(-plus-Escape) dismiss pattern for menus and popovers. Takes the "inside" ref(s) (`refs`, plural — a portalled popover is no longer a DOM descendant of its trigger), `escape` (`true`, or `'capture'` to stop a surrounding `Modal`'s own Escape handler from winning), `capture` (needed where Tauri's `drag.js` calls `stopImmediatePropagation()` on a drag region before bubble listeners ever see the click), and `delay` (skip the opening mousedown itself, e.g. `ContextMenu`'s 50ms). Replaces eight separately written effects: `Dropdown`, `EmojiPicker`, `ContextMenu`, `TitleBarMenuBar`, `TitleBarSearchResults`, `LinkedEntryPicker` (now the one place backing all three link-picker fields — `LinkedOpsInput`/`LinkedWikiInput` no longer wire it themselves), `TagInput` |
| `useLinkItems` | the store-subscribed half of `buildLinkItems` (below) — assembles every linkable entry across all five modules into one memoised list. Backs the `[[` suggestion list, `LinkPickerModal`, and `LinkedEntriesField` |
| `useGlobalSearch` | assembles the search corpus from the stores and runs the query; backs the title bar's search field |
| `usePersistedFlag(key, fallback?)` | an on/off flag that survives a restart — raw `'1'`/`'0'` in `localStorage` under `key`, returned as `[value, toggle]`. For preferences (which Altar dashboard section stays collapsed, whether its canvas preview is on), not for session-only working state — that stays on `useCollapsedSet`/`uiStore` deliberately, as those two already were |
| `useCollapsedSet(scope, { defaultCollapsed? })` | collapse state for a group list — `isCollapsed(id)`, `toggle(id)`, `expand(...ids)` (used to open a group for the global search's deep-link navigation). `defaultCollapsed` makes every group start closed (Tags, where the list of headers is the overview); the stored set then holds the *opened* ids, which `isCollapsed`/`expand` hide. Lives in `uiStore.collapsedGroups`, keyed by `scope: 'journal' \| 'wiki' \| 'operations' \| 'tasks' \| 'altar-library' \| 'tags'`, rather than view-local state — `MainArea` unmounts the views on module switch, so a `useState` reopened every group on the way back. Still deliberately not persisted (a restart reopens everything); `closeAllTabs` resets it too, since a vault switch leaves category ids pointing at the old vault. Backs the category groups in Wiki, Operations and Tasks, Journal's moon-phase groups, and the category groups inside the Altar dashboard's library section (`'altar-library'` — distinct from the section's own collapse state, which *is* persisted; see [`architecture.md` → Altar UI Composition](architecture.md#altar-ui-composition)) |
| `lib/modules.ts` | the module registry — one source of truth for "which modules exist and what belongs to each": `ENTRY_MODULE_IDS`/`EntryModuleId`, `ViewId`, `LeftListTabId`, `MODULES` (icon, nav label key, untitled key, `entryType`, `usesEditorSidebar`), `AUX_VIEWS`, `TRASH_KINDS`/`TRASH_KIND_ICONS`, `isViewId`, `moduleMeta`, `DEFAULT_ENTRY_EMOJI` (per-type emoji fallback for a link target with neither its own icon nor a category emoji — one truth for the chip node view, editor lookups, the link picker, export, and migration v36; lives here rather than at its original home in `SuggestionList` because `lib/` modules down to `db.ts` need it too, and nothing under `lib/` may import a component — `SuggestionList` re-exports it for callers that already import it from there), and `viewTypeForEntryType` (moved here from `lib/tabs.ts` — the one place translating the data model's `operation` into `ActiveView`'s `operations`, now a reverse lookup over `MODULES` instead of its own mapping). Import rule: lucide-react and types only — no stores, no components; `store/moduleWiring.ts` wires the stores and `components/layout/moduleViews.ts` wires the lazy views, specifically to keep this file import-cycle-free and out of every bundle that doesn't need a view chunk |
| `store/moduleWiring.ts` | the store-layer half of the registry: `moduleWiring` (each module's store reload), `trashWiring` (restore/permanently-delete per `TrashKind`, including `category` → `categoryStore`), and `reloadAllStores`/`reloadModules` (the startup/vault-switch/import reload sequence — tags and the one `categories` list together, then content, replacing three hand-maintained lists in `vaultStore`, `dbBackup`, and `AppShell`). Import rule: content stores only, never `uiStore`/`vaultStore`/`trashStore` |
| `lib/linkItems.ts` | `buildLinkItems(sources, t)` — the one source of a link target's icon, label and category across all five modules, as `SuggestionItem[]`; `linkItemKey`/`linkItemsByKey` (the `entryType:id` lookup key for a link target). Used by the `[[` suggestion list, `LinkPickerModal`, and `LinkedEntriesField` (all three via `useLinkItems`), and by `emeraldFormat.ts`'s import/export, which needs the same mapping without React and calls it directly with a `getState()` snapshot of every store — the `LinkItemSources` interface is the extension point that makes that possible. Lives in `lib/`, not with `SuggestionList` where `SuggestionItem` used to be defined, for the same reason as `DEFAULT_ENTRY_EMOJI` above |
| `lib/internalLinkHtml.ts` | reading and writing the stored HTML of an internal link chip, kept deliberately DOM-optional: `extractInternalLinks` (regex-based, no `DOMParser` — runs on the database path, in migration v36 and in the schema-check Node harness, where there is no browser) and `remapInternalLinks`/`internalLinkChipHtml`/`internalLinkBlockHtml` (need a real DOM, used by the backup merge-importer, `.emerald` import/export, and the editor's own append/remove logic). `internalLinkBlockHtml` is the one definition of an appended link block — a divider, the target's category as a heading, then the chip — shared by `editorCommands.ts`'s `appendEntryLink`, migration v36, and `.emerald`/Markdown import's legacy-column bridge |
| `lib/blocks/` | the pure half of the content-block registry: `types.ts` (`BlockInstance`, `TEXT_BLOCK_TYPE`), `blockTypes.ts` (`resolveBlockType` — `undefined` for an unknown type or too-new data version), `blockHtml.ts` (`parseBlocks`/`serializeBlocks`/`createTextBlock`, `DOMParser`-free, tested by `npm run check:blocks`), `blockAttrs.ts` (`isBlockHidden`, `customBlockTitle`, `showsTitleInRead`, `withBlockAttr`, `showTitleAttrValue`, `hiddenAttrValue`, `blockLabel`/`blockTypeLabel`/`elementLabel` — the instance-attribute and naming rules for stack, sidebar and export), `exportRender.ts` (`renderBlocksForExport` — one export serializer per block type, by the read-mode rules), `fields.ts` (the fields block: `parseFields`/`serializeFields`/`createFieldsBlock`, `isElementEmpty`/`isHiddenInRead`, `linkFromSlot`/`imageFromSlot`), `presets.ts` (`BLOCK_PRESETS` — what "add block" offers —, `createFromPreset` including `def:<id>` for user-built blocks, `ELEMENT_KIND_ICONS`, `blockIcon`), `definitions.ts` (user-built blocks: `BlockDefinition`, `instantiateDefinition`, `blockOrigin`, `isOutdatedCopy`, `updateInstanceToDefinition`, `updateCopiesInContent`/`removeCopiesFromContent`), `entrySummary.ts` (`entryBlockSummary` — copies and their field values per entry plus the sigil summary for cards, sidebar and menu, cached per content and day; the base for later list filters), `sigil.ts` (the three sigil blocks, `extractUniqueLetters`, `sigilState`, `withoutConcealed`, `withChargeUnloaded`, `todayIso`), `legacyStatus.ts` (the v40 status converter), `layouts.ts` (`defaultBlocksFor` — the sigil set for new operations in "Sigils"; the docking point for the later templates dashboard). Import rule: types, `lucide-react` and pure `lib` only |
| `store/blockSessionStore.ts` | the bridge from the open entry's `BlockStack` to the sidebar block manager: current block structure plus a stable `BlockStackApi`. In memory only; `clear(api)` only removes the caller's own session |
| `store/blockDefinitionStore.ts` | the user-built blocks (`block_definitions`): create, update (raises `revision` when name, icon, elements or display change), soft-delete/restore/purge, `importDefinitions` (by id, never overwriting). Touches no entry |
| `store/blockCopies.ts` | what happens to the copies in entries, only on explicit request: `copyUsage` (entries / outdated per definition), `updateAllCopies`, `removeAllCopies` — through the three stores' `update*`, skipping the entry open in edit mode |
| `lib/links.ts` | `syncLinks`/`fetchBacklinks` (see [`architecture.md` → Internal Links](architecture.md#internal-links)) plus the event protocol behind the "Linked entries" field: `isValidLinkTarget` (one shared check for all three events below, replacing three separately written copies), and `requestEntryLinkAppend`/`requestEntryLinkReveal`/`requestEntryLinkRemove` with `subscribeEntryLinkRequest` — `document`-level custom events, since the sidebar field has no reference to the TipTap instance of whichever view is open. A request resolves to `true` only if an editable, listening editor accepted it (`preventDefault`); the field falls back accordingly (e.g. `reveal` navigates to the target instead of jumping to it in text when nothing was listening) |
| `lib/categories.ts` | `categoryLabel(t, cat, fallback)` — the one builtin-vs-custom display-name rule for all four categorized modules since v38 (a builtin is named via `categories.builtin.<id>`, everything else via its stored name), replacing what used to be a separate `categoryLabel`/`altarCategoryLabel` pair (Altar categories carried no `is_builtin` flag pre-v38 and were matched against their seed name instead — moot now that there is one table with one flag). `categoriesUsedBy(all, items)` — the categories a view should render as chips/groups/tabs: everything at least one item points at, plus the fallback. A just-created category is deliberately not among them: it is managed in `CategoriesView` and reaches a module only once an entry points at it. `categoryUsageCounts(sources)`/`dominantCategoryModule(usage)` — how many entries per module point at each category, and which module that is most; one truth for `CategoriesView`'s count columns and the global search's module hint. `hasUncategorized(all, items)` — whether an "Uncategorized" chip is worth offering at all: true once at least one item's `category_id` no longer resolves against `all` (its category was moved to Trash). The same question `categoriesUsedBy` answers, upside down. Used by the views, the properties panels, `TrashView`, and `useGlobalSearch`. The file's remaining exports (`legacyCategoryLabel`, `legacyBuiltinLabelKey`, `legacyDisplayName`, `legacyWikiCategoryEmoji`) exist only for migrations v36–v38 and for importing pre-v38 files/backups — nothing in the live UI reads them |
| `lib/formatDate.ts` | `formatEntryDate`/`formatEntryDateLong`/`formatMonthGroup`/`formatDayHeading`/`formatTimeDistance` — the app's only source of locale-aware date formatting, wired into `changeAppLanguage` (date-fns locales lazy-load per language, same pattern as the i18n bundles). `lib/export.ts` and `lib/emeraldFormat.ts` deliberately do not use it — file exports stay locale-independent |
| `lib/sortItems.ts` | the one `SortMode` comparator for every dashboard — date/title getters plus an optional tiebreak. `SortMode` no longer has a `'category'` value; grouping is `GroupingMode`, a separate axis handled by `groupBy.ts`/`Dashboard` instead (see below and [`architecture.md`](architecture.md)). `title` is required only when the item type has no `title` field of its own (`TitleOption<T>`, a conditional type) — the Altar library sorts by `name` and must pass one; every other caller can omit it and fall back to `item.title`. An optional `count` getter backs `count_desc` ("most used first" — only Tags offers it, sorting its tags by usage). Replaces seven per-view copies |
| `lib/groupBy.ts` | `groupBy(items, keyFn)` → `DashboardGroup[]`, `groupByMonth` (keyed by the localized month via `formatMonthGroup`), and `groupByCategory(items, categories, categoryId, label, uncategorizedLabel)` — one group per category (empty ones included; `Dashboard` drops them centrally at render time, see above) plus a trailing `UNCATEGORIZED_KEY` group, only when there actually are orphans, for items whose category id no longer resolves to any of the ones passed in (its category was moved to Trash). Used by Wiki and Operations; Journal reuses it too, passing the eight moon phases in as synthetic `{id: phase}` category-like objects so the same orphan-bucket logic groups entries with no phase; Tasks builds its groups from its own pre-existing category map but shares the same `UNCATEGORIZED_KEY` constant. Replaces five month-grouping loops plus two category remaps and two Trash category maps |
| `lib/serialize.ts` | `serialized(serialKey(domain, id), task)` — chains same-key async tasks so a content store's read-snapshot/merge/write-whole-row update never runs against a stale snapshot from an overlapping update of the same entity. `drainSerialized()` awaits every currently-queued chain (used on vault switch and replace/add-vault import). See [`architecture.md`](architecture.md#store-write-serialization) |
| `lib/reveal.ts` | `scrollIntoViewCentered(el)` (reduced-motion aware) and `flashReveal(el, className, ms)` — the "here it is" scroll-and-flash shared by the link chip (`revealEntryLink`) and the block stack's jump-to; one element per class at a time |
| `lib/motion.ts` | `REORDER_SPRING` — the one spring for framer-motion `Reorder` lists (tab bar, block stack, block manager) |
| `lib/dragChannel.ts` | `createDragChannel<T>()` — the module-level set/get/subscribe pub-sub behind `dragState`/`altarDragState`/`routineDragState`, each now a thin named-export adapter over one instance of it |
| `lib/thumbnail.ts` | `canvasToCappedThumbnail` (WebP quality ladder under the shared `THUMBNAIL_MAX_BYTES` cap, JPEG or PNG fallback) — used by the altar cards. `THUMBNAIL_W` (640px) is their render width. (Sigil cards used it too until v41; they now show the drawing's image file directly.) |
| `lib/styleClasses.ts` | repeated Tailwind chains. **The established home for them** — extend it rather than bypassing it |
| `lib/platform.ts` | `isMacOS`, `isWindows`, `platformName`, `isTauri`, `usesCustomWindowControls`, `usesHtmlMenuBar`. The **only** permitted source of platform detection; everything else branches through `html[data-platform]` in CSS, never through scattered `navigator.userAgent` checks |
| `lib/tabs.ts` | tab IDs and `isContentView` only now — `viewTypeForEntryType` moved to `lib/modules.ts` (see above) |
| `lib/helpers.ts` | `generateId`, `nowIso`, `isImageIcon`, `isValidHexColor`, `hexToRgb`, `formatBytes`, `ACCEPTED_IMAGE_MIME`, `isAcceptedImageFile`, `readFileAsDataUrl` |
| `lib/altarConstants.ts` | altar defaults and geometry, notably `getAltarBackgroundStyle` and `resolveResolutionPixels` as sole sources of truth |
| `lib/viewMode.ts` | `isCardView(view)` (`'cards'` or `'cards_wide'`) and `isWideCardView(view)` — the one place that knows the two card `ViewMode`s share a tile and only the grid around them differs. Views branching their item rendering on the view mode check `isCardView` instead of `view === 'cards'`, so `cards_wide` falls into the same branch everywhere rather than silently landing on the list branch in each view separately |

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
| `.linked-entry-chip`, `.linked-entry-menu*` | the "Linked entries" field's chips and result menu (`LinkedEntryPicker`) |
| `.internal-link-chip`, `.internal-link-label` | an internal link chip as rendered inline in editor content (`InternalLinkExtension`'s node view) — `.is-revealed` is the short-lived highlight class the field's chip-click applies |

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
right-click that opened it, and knows disabled entries but no submenus. The menu bar needs
submenus too, plus `role="menubar"` with its full keyboard contract.

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
   portal) runs through `Modal`; the search field still uses raw `stone-*` utilities, and its
   six icon-only tabs are a hand-written toggle button duplicating `TabIconButton` rather than
   using it — `TabIconButton`'s active state is wired to the sidebars' stone tone, and the
   picker needs jade instead, which the component has no variant for yet (see
   [design.md Open Points #11](design.md#open-points)).
4. **`AltarItemTile`** (the library tile, shared by the editor's `AltarLibraryStrip` and the
   dashboard's `AltarLibrarySection`) rebuilds the panel look raw
   (`rounded-md border border-stone-700/60 bg-stone-900/40`) instead of using `.panel` —
   unlike the vault picker, without a technical reason. No longer duplicated across two
   render paths now that both places share the one component; the raw chain itself is still
   open.
5. **The emoji empty-result message** in `EmojiPicker` uses a raw `text-stone-500` instead
   of `--text-muted`; the one unthemed remainder in an otherwise fully CSS-variable-based
   component.
6. **`AltarReadingSummary` rebuilds `PropertySummaryRow` raw.** Its local `BackgroundRow`
   repeats the row's exact class chain (`flex items-center gap-2 px-3 py-2 rounded-lg
   bg-stone-900/45 border border-stone-700/60`) instead of using the component.
7. **The altar's ratio and overlay-colour toggles** hand-write an active/inactive class
   chain as raw Tailwind (`AltarSidebarPanel`, mirrored in `PlacedElementRow`), in a file
   that imports and uses `Button` a few lines above. It is not a copy of one tone: the
   inactive half is `neutral` and the active half is jade, so what it shadows is `Button`'s
   `tone` mode with `active` — off by a step in several values (`border-jade-600/70` against
   `/60`, `border-stone-700/60` against `border-stone-600/70`). Whether they belong in
   `Button` at all is open: they are selection toggles, structurally closer to a chip than
   to an action button. The background picker's change/remove/upload buttons, once part of
   this item, now run through `Button`'s tone mode.
8. **A third dropdown row class** exists besides `.menu-item`/`.context-menu-item-*`:
   `linked-entry-menu-item`, with its own raw chain. Now defined in one place
   (`LinkedEntryPicker`, shared by `LinkedEntriesField`, `LinkedOpsInput` and
   `LinkedWikiInput`) rather than two drifting copies.
9. **Three separate "emoji or image" glyph components.** `BlockGlyph` (a block's own icon) and
   `FaviconGlyph` (`sidebar/fields/Favicon.tsx`, Wiki/Operations/Altar icons) both branch on
   the shared `isImageIcon` (`lib/helpers.ts`: `data:image/`, `blob:`, or a bare `/` path) but
   each hand-writes its own `<img>` markup — different rounding, border and `object-contain`
   vs. `-cover`. `TabBar`'s private `renderIconValue` duplicates the check itself rather than
   calling `isImageIcon` (its own version also accepts `http`, for an altar's `imageSrc`
   result) and hand-writes a third `<img>`. `BlockGlyph` gained the image branch this cycle (a
   user-built block can now carry an image icon) by copying the pattern rather than reaching
   for either existing glyph, since none of the three currently render at the same size or
   with the same framing as another.
   *Cost: one glyph component parameterised on size/framing, `renderIconValue` switched onto
   `isImageIcon`, then the two smaller components retired in favour of it.*

Whoever touches one of these places anyway clears it up along the way. New entries in this
list need a reason why resolving it was not possible right away.
