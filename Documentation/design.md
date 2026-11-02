# Design

**This file is a specification, not an inventory.** [Binding Rules](#binding-rules) applies to new and touched code. [Open Points](#open-points) lists where today's code still contradicts those rules — the code still wins there, but the direction is settled. The [Appendix](#appendix-inventory-and-traps) records the actual values and the traps of the theming system.

Deviations are allowed. They need a comment at the deviating place in the code, not an addition to this file.

For the *components* (which shared building blocks exist, when to use them) see [`components.md`](components.md). For the *architecture* of the theming system (CSS custom property tiers, normalisation flow, Tailwind bridge) see [`architecture.md`](architecture/appearance.md#theming-system).

---

## Binding Rules

### Colour

**Exactly one source: the theme CSS variables.** `--accent`, `--text-*`, `--border-*`, `--bg-*`, `--panel-*`, `--menu-*`, `--search-*` and the rest. Both theme files define the same set of properties, and they are the only thing guaranteed to look right in both themes.

**Raw Tailwind palette classes are not allowed.** `npm run check:colors` fails on them. `tailwind.config.js` maps semantic names to the tokens: `text-primary`, `text-secondary`, `text-soft`, `text-muted`, `text-subtle`, `text-raise`, `text-accent`, `text-on-accent`, `bg-well*`, `bg-accent-*`, `border-edge*`, `border-accent-edge`, `shadow-menu`. A colour that fits none of them gets a token in all theme files first.

**Exactly one accent: jade.** `tone="amber"` is for the edit action in row action bars only. A further accent tone needs a theme token first.

**Red means destructive, nothing else.** Via `Button variant="danger"` or `tone="danger"`, not via a per-site red treatment of its own.

**Text holds 4.5:1 against its surface, in both themes.** Icons, control borders and focus rings that carry meaning hold 3:1. Remaining exceptions are [Open Point 5](#open-points). Parchment's solid jade (`#159165`) with its light text is 3.84:1, kept deliberately: a darker green looked worse, and the labels on it are short.

**A new component adds its tokens to both theme files in the same commit.** It uses the general tokens first and adds its own only where a value really differs. New rules in `index.css` take tokens, not hex literals; the older per-theme rules there still hold some ([Open Point 2](#open-points)).

**Tokens are the contract with a theme.** A [custom theme](themes.md) sets colours only. Spacing, layout, radius and fonts stay fixed, so that any theme still works and still reads as Emerald. A new colour token needs a derivation in `src/themes/customTheme.ts`. `tools/themes/test-garish.css` is the check for this: anything still brown, grey or jade under it is not coming from a token.

### Typography

- **UI**: `font-sans` — Inter by default, switchable in settings.
- **Editor**: `font-serif` — Lora by default, configured separately.
- Applied through `data-ui-font`/`data-editor-font` on `<html>`, never through a direct `font-family` in a component.
- Eight selectable fonts ship with the app — nothing is fetched from the network. `src/fonts.css` is **generated** (`npm run fonts`) and never edited by hand; another font or weight means the `FONTS` list in `scripts/make-fonts-css.mjs`, the package in `package.json`, **and** `FONT_OPTIONS` in `src/themes/theme.ts` — all three or none. See [Font System](architecture/appearance.md#font-system).
- `public/splash.css` (the loading screen's styles, see [Loading Screen and Boot Order](architecture/shell.md#loading-screen-and-boot-order)) holds hand-kept copies: `--splash-bg` / `--splash-gem` mirror `--shell-bg` / `--accent` from `src/themes/*.css` — change one, update the other. `--splash-bg` is copied once more as `backgroundColor` in `src-tauri/tauri.conf.json` and the three `tauri.{windows,macos,linux}.conf.json` (never `tauri.dev.conf.json` — see [Per-platform Tauri configs](build.md#per-platform-tauri-configs)), so the window's pre-paint frame is dark instead of white.
- `font-mono` is the system's monospace, for inline code and recovery keys only. No monospace font is bundled.

Size is a fixed scale. 11px is the floor; weights are 400, 500 and 600, and bold is for headings and `.label-xs`, not for emphasis in running UI text. Digits that line up in columns get `tabular-nums`.

| Style | Size / line | Weight | Font | For |
| --- | --- | --- | --- | --- |
| `text-2xl` | 24 / 32 | 600 | editor | entry and dashboard titles (`.entry-view-title`) |
| `text-lg` | 18 / 28 | 600 | editor | empty-state title |
| `text-sm` | 14 / 20 | 400 | UI | list rows, modal text |
| `text-[13px]` | 13 / 18 | 400 | UI | sidebar values, empty-state sentence |
| `text-xs` | 12 / 16 | 400–500 | UI | buttons and menu items (500), dates and counts (400) |
| `.label-xs` | 12 / 16 | 600 | UI | uppercase section headings |
| `text-[11px]` | 11 / 14 | 600 | UI | `tone` buttons, dense meta rows |

Editor text is 17px by default (14–22 in settings) with `leading-relaxed`; its headings are `em`-sized so they grow with it.

### Border Radius

Four steps, each with a responsibility. Not chosen by feel:

| Step | For |
| --- | --- |
| `rounded-md` | small controls: inputs, chips, icon buttons, list rows, tiles |
| `rounded-lg` | buttons and **floating surfaces**: menu, popover, toast, dropdown |
| `rounded-xl` | surfaces that carry content: `.panel`, `.panel-interactive`, `.modal-card` |
| `rounded-full` | genuinely round elements only: dots, avatars, the track and thumb of a `Switch` |

`rounded-sm` stays reserved for decorative miniature surfaces below ~16px (colour swatch, resize handle, image thumbnail) — `rounded-md` would be visibly too round there. It is not a general step.

What decides is **what an element is**, not how large it is: `ContextMenu` and `UndoToast` are both small floating overlays and therefore belong on the same step (`lg`).

Bare `rounded` (4px) is not a step; it becomes `rounded-md`.

### Depth

Four levels. Only what floats casts a shadow.

| Level | What | Surface | Shadow |
| --- | --- | --- | --- |
| 0 | frame | `--shell-bg` | none |
| 1 | sheet and panels | `--sheet-bg`, `--panel-bg`, with an edge | none |
| 2 | menu, popover, toast | `--menu-bg`, with an edge | `--menu-shadow` |
| 3 | modal | `--shell-bg` with `--menu-border`, holding a sheet (`--sheet-bg`, `--sheet-border`) | `shadow-2xl` |

Stacking is `z-10` within a column, `z-50` for modals and `z-[9999]` for overlays, nothing else.

### Icon Sizes

Four steps for UI icons (lucide-react `size` prop):

| px | Level |
| --- | --- |
| `18` | rail — navigation level |
| `16` | title bar, modal headers, primary actions |
| `14` | default: lists, buttons, panels |
| `12` | dense meta rows, chips, badges |

Nothing is interpolated in between — 13 and 11 are not steps. Large icons in empty states and illustrations (32–40px) are decorative and exempt from the scale.

Colour is inherited from the surrounding text colour, not set through a `color` prop on the icon.

### Heights and Spacing

**Bar heights:**

- `h-10` (40px) — window chrome: the title bar, which also holds the tab strip.
- `h-14` (56px) — content bars: the right sidebar's `SidebarActionBar`.

The split is deliberate: the title bar is window chrome, not a content header, and 56px feels heavy for that. Because it sits *above* the frame-and-sheet shell, it does not collide with the 56px bar below.

The frame beside the sheet has no bar: the entry list's search field and the rail's first button start at the sheet's top edge, on one centre line.

Size tokens in both theme files: `--tab-pill-h` (30px, `TabBar`) and `--control-h` (30px, the edit bar's buttons). `RailButton` is 32×32 (18px icon, `p-1.5`, a 1px frame holding room for the active accent); in the shorter title bar, `.titlebar .rail-button` is 30×30 with a 16px icon.

**Tab bar** (`TabBar.tsx`), inside the title bar and flush with the sheet's left edge, with no divider — the title bar is part of the frame:

- Tabs are `--tab-pill-h` pills, `rounded-md`, `flex-[0_1_180px]` — 180px until the strip is full, then shrinking together to a 96px floor before the list scrolls. No edges: idle tabs have no surface (`--text-subtle`, `--tab-pill-hover` on hover), the active tab a light one (`--tab-pill-active`, `--text-primary`), no accent edge. The × is always visible on the active tab, on hover for the rest. The "+" is a pill-height square of the same kind.
- The space before the tabs and the trailing filler stay free to drag the window; the gaps between pills deliberately do not, since a click there right after a tab click would count as a double-click and maximise the window.
- `Reorder.Item`'s layout animation is active only while a tab is being dragged (plus `REORDER_SETTLE_MS`) — otherwise every tab would spring whenever the strip itself shifts.
- Focus rings sit *inset*, since the scrolling list clips anything beyond a pill.

**Dashboards share one structure.** Whatever a dashboard lists, the same four rules apply:

- **One row:** symbol and name on the left, metadata on the right, 44px tall (`h-11`, `DashboardItem`/`DashboardRow` with `RowContent`), 6px apart. A row's second line does not exist; what would go there is metadata.
- **One group heading:** `CollapsibleGroupHeader`, 24px, for a category, a month and a whole section alike.
- **Actions in the context menu:** rename, duplicate, delete. No row carries a permanently visible amber or red button. A permanent delete asks in the row (`InlineConfirm`).
- **One sidebar order:** action, view, sort, grouping, filter. What a dashboard does not have falls away; preferences of the view (`displayToggles`) belong to the view section.

The exceptions, each for a reason:

- **Home** keeps view, sort and length in its section headings, because it has three lists and the sidebar has room for one. Its title is the date over the moon phase.
- **Tasks** have no layout choice, since subtasks and inline editing have no card to live on; the view section holds only "Show completed". The checkbox and the subtask chevron come before the name. Add subtask, category, link and priority appear on hover, because a task is worked on from its row; rename and delete stay in the menu.
- **Categories** have a drag handle, because their order is the hand-dragged one, and no view or sort for the same reason. **Tags** have a chevron and a colour dot, because a tag opens in place and its colour is its value.
- **Trash** rows carry a checkbox and select on click, and a jade Restore button, since restoring is what the page is for. Deleting for good stays in the menu.
- **Altar** rows show the preview (32px) as their symbol, wider than the column; it fits the row. The Altar's sidebar has a second sort and grouping for its library, after the altars' own.
- **Built-in blocks** are rows without hover, since nothing opens from them.
- The **"+"** in a group heading stays visible: it is jade, creates rather than alters, and belongs to the group.

**Horizontal padding has exactly one source per column.** The column's outer container sets it; the panels inside add no `px-*` of their own. In the right sidebar that is `SidebarColumn`'s scrolling body (`p-3`, with a comment in place) — if a panel adds its own padding again, its rows end up visibly indented differently from the button in the action bar above them.

**Spacing scale:** 2, 4, 6, 8, 10, 12, 16, 20, 24 and 32px (Tailwind `0.5`, `1`, `1.5`, `2`, `2.5`, `3`, `4`, `5`, `6`, `8`). `2.5` is for icon-to-label in menu and list rows. An arbitrary value needs a comment. Usual places: `px-8` for main-area content columns (`Dashboard`'s content, `EntryDetailFrame`), `px-3`/`p-3` in the sidebars, `px-5 py-2.5` in modal bars (`.modal-header`, `.modal-footer`), `.modal-body` (`px-3.5 py-4`) in modal bodies.

### States

**Focus must be visible in both themes.** A new focusable element without a `:focus-visible` rule in *both* theme blocks is unfinished. `--focus-ring` exists for exactly this.

**Disabled runs through the shared `:disabled` rule** (`opacity-50 cursor-not-allowed pointer-events-none`), not through a colour of its own. A menu row is dimmed the same way, through `opacity`, rather than given a colour.

**A tooltip for a disabled control sits on a wrapper.** A disabled `Button` carries `pointer-events-none`, so a `title` on the element itself never shows. When the reason is the point — the sigil-locked Edit button — the tooltip belongs on a wrapping `<span>`. (A hand-written button without that class, like the altar's snap buttons, can keep its own `title`.) A group of inputs locked as a whole (a locked placement's inspector, the read-only settings of a copy of one of your own blocks) is a disabled `<fieldset>` dimmed to `opacity-50` with its hint above or as its tooltip.

**Active/inactive toggles use `Button`'s `tone` mode**, not a ternary in the `className` template. The base variants (`primary`/`secondary`/`ghost`/`danger`) have no active state; `tone` does. Documented exceptions: `EditorToolbar`'s `ToolbarBtn` and `AltarCanvas`'s drag handles — neither is a generic action button.

**Hover changes the surface, active also changes the meaning.** Active shows jade; something merely hovered stays neutral (`--interactive-hover`). This holds for menu rows too: a hovered row is neutral (`--menu-item-hover-*`), the chosen one — the current emoji, the selected option — is jade (`--menu-item-active-*`).

**Motion:** 150ms for colour changes and hover (`transition-colors duration-150`), 200ms for what changes the room, such as sidebars and fades. Nothing bounces or blinks for attention; dragging tabs is the exception.

**Animations respect `prefers-reduced-motion`** and live as a class in the stylesheet, never as an inline style: an inline style beats every rule in the stylesheet and with it the opt-out.

---

## Open Points

Where the code contradicts the rules above today. No prioritisation — each point names the rule, the violation, and what resolving it would cost.

**1. Icon sizes 7 and 8.** Three tiny indicators sit below the scale. *Cost: decide each one; they may be genuine exceptions needing a comment.*

**2. Per-theme component rules with hex values.** `index.css` still has about 210 `html[data-theme=…]` rules for individual components with literal colours. They keep Noctis and Parchment as they are; a third theme falls back to the token-based base rules, so nothing breaks. *Cost: move them onto tokens when a component is touched.*

**3. The entry actions live exclusively in a collapsible surface.** Edit/Done/Delete/Cancel exist only in the right sidebar. Collapsing it mid-edit leaves no visible way back; there is no keyboard fallback. *Switching* into edit mode expands it automatically (`uiStore.ts`, driven by the registry's `usesEditorSidebar`) — that covers entry, not later collapsing. Mitigated, not fixed: both sidebars can also be reopened from the View menu. *Cost: keyboard shortcuts for Edit/Done/Cancel, or a second home for the actions.*

**4. `LinkPickerModal`'s six tabs are a hand-written button, not `TabIconButton`.** `TabIconButton`'s active state is wired to the stone tone the sidebars use; the picker needs the jade tone the modal is themed in, and the component has no tone variant for that yet. The deviation is commented at the definition (`LinkPickerModal.tsx`). *Cost: add a `tone` prop to `TabIconButton`, then switch the picker over.*

**5. Contrast of `--accent` as a fill mark.** `--accent` itself stays `#008a57` in Parchment (3.99:1 against the sheet), which holds 3:1 for icons and marks. Text uses `--accent-text`. *Cost: none unless it gets used for text again.*

---

## Appendix: Inventory and Traps

### Colour Values

**Theme variables** (`src/themes/emerald-noctis.css`, `emerald-parchment.css`). Both files define the same 163 properties, including the edit sidebar's `--field-*`, `--primary-solid-*` and `--danger-soft-*` tokens `Button`'s `--tone-*` and the Settings' `--choice-*`. Core values:

| Property | Emerald Noctis (dark) | Emerald Parchment (light) |
| --- | --- | --- |
| `--bg-app` | `#15110d` | `#f7efdf` |
| `--text-primary` | `#f5f5f4` | `#2c2014` |
| `--text-subtle` | `#8a837d` | `#775c41` |
| `--accent` | `#00c47f` | `#008a57` |
| `--accent-strong` | `#00a066` | `#006941` |
| `--focus-ring` | `rgba(0, 196, 127, 0.42)` | `rgba(0, 138, 87, 0.34)` |
| `--warning-text` | `#e2a854` | `#a75924` |
| `--danger-text` | `#f87171` | `#b63f32` |
| `--panel-bg` | `rgba(38, 32, 27, 0.78)` | `#f7eddb` |
| `--menu-shadow` | `0 14px 36px rgba(0,0,0,0.35)` | `0 18px 36px rgba(96,63,30,0.2)` |
| `--shell-bg` | `#100d0a` | `#ecdec7` |
| `--sheet-bg` | `#1c1712` | `#faf3e6` |
| `--sheet-border` | `rgba(87, 83, 78, 0.35)` | `rgba(145, 108, 70, 0.28)` |

The tab strip has no background of its own — it lies on the frame (`--shell-bg`), like the title bar, the rail and the left sidebar (see [Shell Layout](#shell-layout)).

Deliberately **not** tokenised: the Fluent red of the close button (`#c42b1c`, active `#b2231a`). It is identical in both themes — a token would only be a second place to maintain the same value.

### Specificity Traps

Two traps of the theming system, both verified through computed styles in both themes. They hit **every** new state variant on an existing class, not just the places where they were discovered.

**1. Theme overrides beat modifier classes.** `html[data-theme=…] .panel` has specificity 0-2-1. A single-class modifier rule such as `.panel.vault-card-active` (0-2-0) loses against it regardless of declaration order.

**2. Unlayered rules come later in the output.** Tailwind 3's `@layer` is not a native CSS cascade layer: it only moves its rules to where the matching `@tailwind` directive sits, at the top of `index.css`. Every rule written outside a `@layer` block — all the `html[data-theme=…]` overrides further down — therefore comes *after* `@layer components` and wins at equal specificity. Specificity itself still decides as usual: a layered rule with a higher specificity does win (measured with `getComputedStyle` in both themes). A review finding of the form "layered loses against unlayered" has to be measured before anything is moved.

Consequence: a new "active" variant on a `.panel` card needs either a selector that outranks the theme override, a rule placed after it outside any `@layer` block, or must forgo `.panel` entirely. The vault picker shows two of these:

- `.vault-card*` forgoes `.panel` and rebuilds the look; the active card's accent border (`.vault-card.vault-card-active`) deliberately sits outside any `@layer` block, with a comment in place, rather than with the other `.vault-*` classes in `@layer components`.
- `.task-row-target` marks the row a search hit points at using `outline` rather than `background`/`border`/`box-shadow` — all three would be overridden by `html[data-theme=…] .panel-interactive`.

`.search-match` and `.task-row-target` carry an `rgba()` fallback with their `color-mix()` behind `@supports`, for WebKitGTK before 2.40. The other `color-mix()` sites (vault cards, `.input-field`, …) have none yet.

### Overlays and Portals

**Everything floating that can sit inside a sidebar or scroller hangs off `document.body` via `createPortal`** and positions itself with `position: fixed` in viewport coordinates: `Modal` (global search's `SearchModal`/`SearchResultList` render inside its body rather than portalling separately), `ContextMenu`, `EmojiPicker`, and `AltarCanvas`'s floating controls. `Dropdown` does so only with its `portal` prop, and `UndoToast`, which is global, renders in place with `position: fixed`. `MenuDropdown` is the deliberate exception: it renders in place with `absolute` + `z-[9999]`, which works because the title bar sits above both stacking contexts described below.

The reason is the same for all of them: `.app-sidebar` and `.app-main` carry `position: relative; z-index: 1` in both themes and are therefore **sibling stacking contexts**. An overlay rendered inline in the sidebar loses against the later-painted main area no matter how high its `z-index`. On top of that, the nearest ancestor with `overflow` clips the popover — in the vault modal, for instance, the scrolling modal body.

The overlay layer is uniformly `z-[9999]`, one step above modals (`z-50`).

Two things follow that are easy to forget:

- **The outside-click handler must check trigger *and* popover** — as a portal child the popover is no longer a DOM descendant of the trigger.
- **Recalculate on `resize` and on `scroll` with `capture: true`**, so scrolling ancestors are caught too. Popovers flip upwards when there is too little room below, and shift away from the window edge. `ContextMenu` additionally clamps rather than only flipping, so a menu taller than the click's Y offset never gets a negative `top`.

### Keyboard

**Escape is caught in the capture phase inside `EmojiPicker`, with `stopPropagation()`.** `Modal` registers its own Escape handler on the document as well, but in the bubble phase, and it is always already mounted when the picker mounts. Without the interception, an Escape inside an open picker would always be won by the modal — closing the whole dialog along with the edit in progress instead of just the picker.

**Global search has no outside-click listener of its own.** `SearchModal` is a plain `Modal`, so dismissal is `Modal`'s job; there is no drag region inside the modal for Tauri's `drag.js` to race against, so no capture-phase `mousedown` trick is needed.

**Each title-bar menu button owns its own `MenuDropdown`** (no shared `role="menubar"`): click or Down opens it, Up/Down move within it, Right/Left open and close submenus, Escape or an outside click closes it. Only a menu opened by keyboard pulls focus into the panel — opened by mouse the focus stays put, otherwise the editor would lose its selection and Cut/Copy would have nothing left to act on.

**Search field and results list form a combobox pattern** (`role="combobox"`, `aria-expanded`, `aria-controls`, `aria-activedescendant`): focus stays in the field, the arrow keys only move the highlight in the list. Keyboard and mouse selection are a single state (`aria-selected`), with no separate `:hover` alongside — otherwise two rows could look selected at once.

### Shell Layout

**Frame and sheet.** The title bar, the rail and the left entry list all sit on `--shell-bg` with no dividers between them and no gradients — together they read as one frame. The main content area and the right sidebar together form a rounded "sheet" (`--sheet-bg`, `--sheet-border`, `--sheet-radius: 10px`) on top of that frame, inset by `--sheet-inset` (6px) on the right and bottom. The radius is one step under `rounded-xl` on purpose: the sheet is window surface, not a panel sitting on one, and a softer radius would balloon the corners against the frame.

- `.app-sheet-main`/`.app-sheet-side` carry the sheet's background and border; `.app-sheet-main-joined` drops the main area's right border and radius when the right sidebar sits next to it, so the two read as one surface split only by the sidebar's own divider.
- The left inset applies only when nothing sits left of the sheet — once the rail and the entry list are both collapsed (`.app-sheet-frame-free-left`); otherwise the frame's own left edge provides it.
- The splash and pre-paint colours match `--shell-bg` (see [Typography](#typography)), so the loading screen hands off to the frame without a visible seam.

**Title bar** (`TitleBar.tsx`, `h-10`; structure in [Window Chrome](architecture/shell.md#window-chrome)). Flexbox, not a centring grid: the left and right groups are `flex-shrink-0`, the space between holds the tab strip. Every trigger is an icon-only `.titlebar .rail-button`, so nothing has to fold or be measured as the window narrows — no `ResizeObserver`, no language-dependent breakpoint. The logo sits centred in a box exactly `RAIL_WIDTH` wide, lining up with the rail's icon column; the menu button follows with its own left margin rather than a shared `gap`, so its icon lines up with the entry list's icons below.

Global search opens as `SearchModal` (`w-[560px]`, fixed `h-[70vh]`, matching `LinkPickerModal`'s geometry). Its field is `SearchField`, the bordered pill `.sidebar-search-inner`; it shares only `.sidebar-search-input` with the entry list's borderless search field.

**Window buttons** (`WindowControls.tsx`, Windows and Linux only): 46×40px, square, no gap, flush into the window corner — the Windows Fluent geometry. The glyphs are inline SVG on a 10×10 grid with a 1px stroke rather than lucide icons, because lucide has no correct "restore" symbol (two offset squares, the rear one clipped).

**Left sidebar** (see [Left Sidebar](architecture/navigation.md#left-sidebar-rail--entry-list)): the 44px rail is part of the frame, with no divider against the entry list. `RAIL_WIDTH` is exported by the rail and never repeated as a literal — the right sidebar's default width and the title bar's logo box derive from it, so a mismatch would produce a clipped rail *and* wrong widths elsewhere. `.app-sidebar-left-with-rail` trims the entry list's left padding next to the rail, which already carries 6px of breathing room; otherwise the list's icons would sit further from the rail's icons than the title bar's alignment suggests.

**Resizing a sidebar.** Its drag handle (`.sidebar-resize-handle`) is an 8px grab area in the frame that shows on hover a rounded 4px strip in `--accent-wash-strong`, stopping short of the sheet's corners. The left one lies mostly on the sheet; the right one grabs on the sidebar's side only, so the main area's scrollbar stays usable, while its strip still reaches over onto the main area.

**Showing and hiding the sidebars is animated** (200ms). The content keeps its pixel width and is clipped by the `<aside>` rather than squeezing together mid-transition; the transition is a class (`.app-sidebar-animated`), not an inline style, so the `prefers-reduced-motion` opt-out after it still wins; `AppShell` removes the class during a resize drag so the edge doesn't lag the pointer.

**A modal repeats frame and sheet.** Title and actions lie on `--shell-bg` with no dividers, the content on `.modal-sheet`, inset by `--sheet-inset` and rounded by `--sheet-radius`. Its bodies take `.modal-body` (`px-3.5`), off the spacing scale on purpose: 14px plus the 6px inset puts the content under the 20px of the title. Behind it the scrim (`--modal-scrim`) blurs the app (`backdrop-blur-sm`). The sheet clips, so a popover from inside it portals.

**A modal moves by its header,** with the window as the limit: dragging, shrinking the window and a growing card all clamp it back inside. It is offset by `left`/`top`, not a transform, which would become the containing block of a `position: fixed` inside it. The position is not remembered.

**A non-dismissible modal leaves the title bar clear.** The backdrop is `fixed inset-x-0 bottom-0` and starts at `top-10` instead of `top-0` as soon as `usesCustomWindowControls` applies (Windows and Linux). Otherwise the backdrop would lie over the app's own title bar, and with no X, Escape or backdrop click the only way out would be Alt+F4. A dismissible modal keeps the full overlay — there the way out is the modal itself.

### Emoji Picker Geometry

The measurements sit in unusual places, each for a concrete reason:

- **Width on the grid, not the frame.** `width`/`minWidth`/`maxWidth` are computed on the grid in cell units (`cell * n + gap * (n-1)`), not on the padded border box — otherwise there is too little room for 5 columns. `repeat(COLUMNS, minmax(0, 1fr))` forces the column count instead of `auto-fill`; 5 columns, down to 3 on a narrow viewport.
- **Scroll clipping on a wrapper of its own** (`max-h-56 overflow-y-auto overflow-x-hidden`), not on the grid: the global scrollbar rule produces a space-consuming bar on every platform, and an equally wide grid overflowed the wrapper on macOS. The grid is `SCROLLBAR_GUTTER` narrower than the wrapper, so the bar does not overlap the last column.
- **The search field gets the same explicit width as the grid**, no `w-full`: the altar sidebar's favicon picker sits in a block `<div>` whose wrapper spans the parent, where a `w-full` search bar would inflate itself.
- **The emoji search set loads lazily** (`src/lib/emojiSearchData/<lang>.json`, ~1900 entries each, dynamic `import()` on first open, module-level cache); matches are capped at 150.

### Platform Quirks

- **`.modal-card` has no `overflow-hidden` in its base class**, because individual modals have popover content that must leave the card bounds (the altar category emoji picker, for one). It is opted into per modal via `className`.
- **Platform-dependent looks branch in CSS through `html[data-platform]`**, never through a `navigator.userAgent` check in a component. `src/main.tsx` sets the attribute from `lib/platform.ts`'s `platformName`.
