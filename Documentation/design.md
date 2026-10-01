# Design

**This file is a specification, not an inventory.** [Binding Rules](#binding-rules)
applies to new and touched code. [Open Points](#open-points) lists where today's code
still contradicts those rules — the code still wins there, but the direction is settled.
The [Appendix](#appendix-inventory-and-traps) records the actual values and the traps of
the theming system.

Deviations are allowed. They need a comment at the deviating place in the code, not an
addition to this file.

For the *components* (which shared building blocks exist, when to use them) see
[`components.md`](components.md). For the *architecture* of the theming system
(CSS custom property tiers, normalisation flow, Tailwind bridge) see
[`architecture.md`](architecture/appearance.md#theming-system).

---

## Binding Rules

### Colour

**Exactly one source: the theme CSS variables.** `--accent`, `--text-*`, `--border-*`,
`--bg-*`, `--panel-*`, `--menu-*`, `--search-*` and the rest. Both theme files define the
same set of properties, and they are the only thing guaranteed to look right in both
themes.

**Raw Tailwind colour utilities are a deviation.** `stone-*`, `jade-*`, `red-*` and
`amber-*` in a component only theme in Emerald Parchment for as long as someone maintains
a bridge override for them in `index.css`. Setting such a class silently takes on the
obligation to keep it in step across both themes — that is the mechanism behind the primary
colour's triple maintenance ([Open Point 1](#open-points)).

**Exactly one accent: jade.** `amber` is confined to the single documented case — the
`tone="amber"` mode for the edit action in row action bars — and not extended (stragglers:
[Open Point 3](#open-points)). A third accent tone needs a theme token in both files first.

**Red means destructive, nothing else.** Via `Button variant="danger"` or `tone="danger"`,
not via a per-site red treatment of its own.

### Typography

- **UI**: `font-sans` — Inter by default, switchable in settings.
- **Editor**: `font-serif` — Lora by default, configured separately.
- Applied through `data-ui-font`/`data-editor-font` on `<html>`, never through a direct
  `font-family` in a component.
- Eight selectable fonts ship with the app — nothing is fetched from the network.
  `src/fonts.css` is **generated** (`npm run fonts`) and never edited by hand; another font
  or weight means the `FONTS` list in `scripts/make-fonts-css.mjs`, the package in
  `package.json`, **and** `FONT_OPTIONS` in `src/themes/theme.ts` — all three or none. See
  [Font System](architecture/appearance.md#font-system).
- `public/splash.css` (the loading screen's styles, see
  [Loading Screen and Boot Order](architecture/shell.md#loading-screen-and-boot-order))
  holds hand-kept copies: `--splash-bg` / `--splash-gem` / `--splash-text` mirror
  `--shell-bg` / `--accent` / `--text-subtle` from `src/themes/*.css` — change one, update
  the other. `--splash-bg` is copied once more as `backgroundColor` in
  `src-tauri/tauri.conf.json` and the three `tauri.{windows,macos,linux}.conf.json` (never
  `tauri.dev.conf.json` — see the traps in `CLAUDE.md`), so the window's pre-paint frame is
  dark instead of white.
- `font-mono` does not resolve to its configured font, see [Open Points](#open-points).

### Border Radius

Four steps, each with a responsibility. Not chosen by feel:

| Step | For |
| --- | --- |
| `rounded-md` | small controls: inputs, chips, icon buttons, list rows, tiles |
| `rounded-lg` | buttons and **floating surfaces**: menu, popover, toast, dropdown |
| `rounded-xl` | surfaces that carry content: `.panel`, `.panel-interactive`, `.modal-card` |
| `rounded-full` | genuinely round elements only: dots, avatars, the track and thumb of a `Switch` |

`rounded-sm` stays reserved for decorative miniature surfaces below ~16px (colour swatch,
resize handle, image thumbnail) — `rounded-md` would be visibly too round there. It is not
a general step.

What decides is **what an element is**, not how large it is: `ContextMenu` and `UndoToast`
are both small floating overlays and therefore belong on the same step (`lg`).

### Icon Sizes

Four steps for UI icons (lucide-react `size` prop):

| px | Level |
| --- | --- |
| `18` | rail and title bar — navigation level |
| `16` | modal headers, primary actions |
| `14` | default: lists, buttons, panels |
| `12` | dense meta rows, chips, badges |

Nothing is interpolated in between — 13 and 11 are not steps. Large icons in empty states
and illustrations (32–40px) are decorative and exempt from the scale.

Colour is inherited from the surrounding text colour, not set through a `color` prop on
the icon.

### Heights and Spacing

**Bar heights:**

- `h-10` (40px) — window chrome: the title bar, which also holds the tab strip.
- `h-14` (56px) — content bars: the entry list's search row and the right sidebar's
  `SidebarActionBar`.

The split is deliberate: the title bar is window chrome, not a content header, and 56px
feels heavy for that. Because it sits *above* the frame-and-sheet shell, it does not
collide with the 56px bars below — the two sidebars must place their bottom divider at the
same height.

Size tokens in both theme files: `--tab-pill-h` (30px, `TabBar`), `--control-h` (30px,
the edit bar's buttons), and `--content-bar-h` (56px) / `--control-h-sm` (24px), which
mirror `h-14` and the small `Button` but are not wired up yet. `RailButton` is 32×32 (18px
icon, `p-1.5`, a 1px frame holding room for the active accent); in the shorter title bar,
`.titlebar .rail-button` is 30×30 with a 16px icon.

**Tab bar** (`TabBar.tsx`), inside the title bar and flush with the sheet's left edge,
with no divider — the title bar is part of the frame:

- Tabs are `--tab-pill-h` pills, `rounded-md`, `flex-[0_1_180px]` — 180px until the strip
  is full, then shrinking together to a 96px floor before the list scrolls. No edges: idle
  tabs have no surface (`--text-subtle`, `--tab-pill-hover` on hover), the active tab a
  light one (`--tab-pill-active`, `--text-primary`), no accent edge. The × is always
  visible on the active tab, on hover for the rest. The "+" is a pill-height square of the
  same kind.
- The space before the tabs and the trailing filler stay free to drag the window; the gaps
  between pills deliberately do not, since a click there right after a tab click would
  count as a double-click and maximise the window.
- `Reorder.Item`'s layout animation is active only while a tab is being dragged (plus
  `REORDER_SETTLE_MS`) — otherwise every tab would spring whenever the strip itself shifts.
- Focus rings sit *inset*, since the scrolling list clips anything beyond a pill.

**Horizontal padding has exactly one source per column.** The column's outer container
sets it; the panels inside add no `px-*` of their own. In the right sidebar that is
`SidebarColumn`'s scrolling body (`p-3`, with a comment in place) — if a panel adds its own
padding again, its rows end up visibly indented differently from the button in the action
bar above them.

There is no enforced spacing scale. Observed practice: `px-8` for main-area content columns
(`Dashboard`'s content, `EntryDetailFrame`), `px-3`/`p-3` in the sidebars, `px-4 py-3`
through `px-5 py-4` in modal headers and bodies.

### States

**Focus must be visible in both themes.** A new focusable element without a
`:focus-visible` rule in *both* theme blocks is unfinished. `--focus-ring` exists for
exactly this.

**Disabled runs through the shared `:disabled` rule**
(`opacity-50 cursor-not-allowed pointer-events-none`), not through a colour of its own.
Where theme rules are more specific than `:disabled` — `.menu-item`, for instance — the
element is dimmed via `opacity`, because a colour declaration there would not get through.

**A tooltip for a disabled control sits on a wrapper.** A disabled `Button` carries
`pointer-events-none`, so a `title` on the element itself never shows. When the reason is
the point — the sigil-locked Edit button — the tooltip belongs on a wrapping `<span>`. (A
hand-written button without that class, like the altar's snap buttons, can keep its own
`title`.) A group of inputs locked as a whole (a locked placement's inspector, the
read-only settings of a copy of one of your own blocks) is a disabled `<fieldset>` dimmed to
`opacity-50` with its hint above or as its tooltip.

**Active/inactive toggles use `Button`'s `tone` mode**, not a ternary in the `className`
template. The base variants (`primary`/`secondary`/`ghost`/`danger`) have no active state;
`tone` does. Documented exceptions: `EditorToolbar`'s `ToolbarBtn` and `AltarCanvas`'s drag
handles — neither is a generic action button.

**Animations respect `prefers-reduced-motion`** and live as a class in the stylesheet,
never as an inline style: an inline style beats every rule in the stylesheet and with it
the opt-out.

---

## Open Points

Where the code contradicts the rules above today. No prioritisation — each point names the
rule, the violation, and what resolving it would cost.

**1. The primary colour is maintained independently in three places.**
The `jade` Tailwind scale (`tailwind.config.js`), the per-theme `--accent` variables, and
the bridge overrides in `index.css` that set yet another set of values for `.btn-primary`
and friends (the `html[data-theme='emerald-noctis'] .btn-primary` and
`html[data-theme='emerald-parchment'] .btn-primary` rule groups). Noctis's
`--accent: #00c47f` happens to be exactly `jade-600`; Parchment's `#008a57` sits between no
two steps of the scale.
*Cost: move the bridge overrides onto `var(--accent*)` and check that the layer ordering
still holds.*

**2. Roughly 530 raw colour utilities across ~67 `.tsx` files** (grep over
`src/**/*.tsx` for a colour-utility prefix — `bg-`, `text-`, `border-`, `ring-`, … — followed
by `stone|jade|red|amber|parchment` and a step). The largest single item, and the reason
point 1 exists at all.
*Cost: not doable in one pass — sensible only file by file or module by module, each
verified in both themes.*

**3. `amber` is a second accent tone with no theme equivalent.** It comes from Tailwind's
default palette, not from an `--accent-*` variable and not from the `parchment` scale.
Emerald Parchment needs its own overrides on the underlying utility classes
(`.bg-amber-900\/30` and others). Uses beyond the edit action, without a deviation comment:
the lock indicator in `PlacedElementRow` (`text-amber-400`), and `tone="amber"` on the
Storage page's scan button and the Updates page's check button.
*Cost: one token pair in both theme files, then switch `TONE_CLASSES` over.*

**4. The `parchment` Tailwind scale carries eleven steps for a single shade.**
It is used 9 times in 5 files, always as `text-parchment-500/70` for date text in list
rows. The Parchment *theme* does not use it — it runs on its own CSS variables, whose
values do not map onto this scale. The name suggests a connection that does not exist.
*Cost: move those sites onto `--text-muted` or similar, then delete the scale.*

**5. Icon sizes off the scale.** About 30 of ~365 `size={n}` props, in 13 files, sit at 13,
11, 10, 15, 8 or 7px.
*Cost: mechanical but scattered; best done per file when it is touched anyway.*

**6. Radius-rule violations.** `UndoToast` carries `rounded-xl` (a floating overlay on the
surface step); `.sidebar-item` in `index.css` is a list row on `rounded-lg` instead of
`rounded-md`. *Cost: one line each.*

**7. `JetBrains Mono` is dead config.** Declared as `font-mono` in `tailwind.config.js`
(`theme.extend.fontFamily.mono`) but not among the bundled fonts (`src/fonts.css`). The one
site using `font-mono` — inline code in the editor (`.tiptap code`) — falls back to the
system monospace. *Cost: either load it or strike it from the config — open because it is
unclear whether a dedicated monospace font is needed.*

**8. Emerald Noctis lacks the generic focus rule.** Parchment has
`html[data-theme='emerald-parchment'] button:focus-visible`; Noctis only has per-class
patches (e.g. `.window-control`, `.rail-button`, `.menu-item`, and the shared group
starting at `.filter-row:focus-visible` in `@layer components`). The base `Button`
variants and any plain `<button>` written directly in a view still look unfocused in
Noctis.
*Cost: one rule, mirrored from Parchment.*

**9. The entry actions live exclusively in a collapsible surface.**
Edit/Done/Delete/Cancel exist only in the right sidebar. Collapsing it mid-edit leaves no
visible way back; there is no keyboard fallback. *Switching* into edit mode expands it
automatically (`uiStore.ts`, driven by the registry's `usesEditorSidebar`) — that covers
entry, not later collapsing. Mitigated, not fixed: both sidebars can also be reopened from
the View menu.
*Cost: keyboard shortcuts for Edit/Done/Cancel, or a second home for the actions.*

**10. `LinkPickerModal`'s six tabs are a hand-written button, not `TabIconButton`.**
`TabIconButton`'s active state is wired to the stone tone the sidebars use; the picker
needs the jade tone the modal is themed in, and the component has no tone variant for that
yet. The deviation is commented at the definition (`LinkPickerModal.tsx`).
*Cost: add a `tone` prop to `TabIconButton`, then switch the picker over.*

---

## Appendix: Inventory and Traps

### Colour Values

**Tailwind scales** (`tailwind.config.js`):

| Scale | 300 | 500 | 600 | 800 | 950 |
| --- | --- | --- | --- | --- | --- |
| `jade` | `#70ffca` | `#00e699` (primary bright) | `#00c47f` (buttons/links) | `#007a4d` (borders) | `#002e1d` |
| `parchment` | `#ecc685` | `#d98c34` | `#c97229` | `#874824` | `#3b1d0f` |
| `stone` | Tailwind default, only `950: #0f0e0c` overridden | | | | |

**Theme variables** (`src/themes/emerald-noctis.css`, `emerald-parchment.css`). Both files
define the same 97 properties, including the edit sidebar's `--field-*`, `--primary-solid-*`
and `--danger-soft-*` tokens. Core values:

| Property | Emerald Noctis (dark) | Emerald Parchment (light) |
| --- | --- | --- |
| `--bg-app` | `#15110d` | `#f7efdf` |
| `--text-primary` | `#f5f5f4` | `#2c2014` |
| `--accent` | `#00c47f` | `#008a57` |
| `--accent-strong` | `#00a066` | `#006941` |
| `--focus-ring` | `rgba(0, 196, 127, 0.42)` | `rgba(0, 138, 87, 0.34)` |
| `--warning-text` | `#e2a854` | `#c97229` |
| `--danger-text` | `#f87171` | `#b63f32` |
| `--panel-bg` | `rgba(38, 32, 27, 0.78)` | `#f7eddb` |
| `--menu-shadow` | `0 14px 36px rgba(0,0,0,0.35)` | `0 18px 36px rgba(96,63,30,0.2)` |
| `--shell-bg` | `#100d0a` | `#ecdec7` |
| `--sheet-bg` | `#1c1712` | `#faf3e6` |
| `--sheet-border` | `rgba(87, 83, 78, 0.35)` | `rgba(145, 108, 70, 0.28)` |

The tab strip has no background of its own — it lies on the frame (`--shell-bg`), like the
title bar, the rail and the left sidebar (see [Shell Layout](#shell-layout)).

Deliberately **not** tokenised: the Fluent red of the close button (`#c42b1c`, active
`#b2231a`). It is identical in both themes — a token would only be a second place to
maintain the same value.

### Specificity Traps

Two traps of the theming system, both verified through computed styles in both themes.
They hit **every** new state variant on an existing class, not just the places where they
were discovered.

**1. Theme overrides beat modifier classes.** `html[data-theme=…] .panel` has specificity
0-2-1. A single-class modifier rule such as `.panel.vault-card-active` (0-2-0) loses
against it regardless of declaration order.

**2. Unlayered rules come later in the output.** Tailwind 3's `@layer` is not a native
CSS cascade layer: it only moves its rules to where the matching `@tailwind` directive
sits, at the top of `index.css`. Every rule written outside a `@layer` block — all the
`html[data-theme=…]` overrides further down — therefore comes *after* `@layer components`
and wins at equal specificity. Specificity itself still decides as usual: a layered rule
with a higher specificity does win (measured with `getComputedStyle` in both themes). A
review finding of the form "layered loses against unlayered" has to be measured before
anything is moved.

Consequence: a new "active" variant on a `.panel` card needs either a selector that
outranks the theme override, a rule placed after it outside any `@layer` block, or must
forgo `.panel` entirely. The vault picker shows two of these:

- `.vault-card*` forgoes `.panel` and rebuilds the look; the active card's accent border
  (`.vault-card.vault-card-active`) deliberately sits outside any `@layer` block, with a
  comment in place, rather than with the other `.vault-*` classes in `@layer components`.
- `.task-row-target` marks the row a search hit points at using `outline` rather than
  `background`/`border`/`box-shadow` — all three would be overridden by
  `html[data-theme=…] .panel-interactive`.

`.search-match` and `.task-row-target` carry an `rgba()` fallback line ahead of their
`color-mix()`, for WebKit before 16.2 / WebKitGTK before 2.40. The other `color-mix()`
sites (vault cards, emoji-picker search, `.input-field`, …) have none yet.

### Overlays and Portals

**Everything floating hangs off `document.body` via `createPortal`** and positions itself
with `position: fixed` in viewport coordinates: `Modal` (global search's
`SearchModal`/`SearchResultList` render inside its body rather than portalling separately),
`ContextMenu`, `EmojiPicker`, and `AltarCanvas`'s floating controls. `MenuDropdown` is the
deliberate exception: it renders in place with `absolute` + `z-[9999]`, which works because
the title bar sits above both stacking contexts described below.

The reason is the same for all of them: `.app-sidebar` and `.app-main` carry
`position: relative; z-index: 1` in both themes and are therefore **sibling stacking
contexts**. An overlay rendered inline in the sidebar loses against the later-painted main
area no matter how high its `z-index`. On top of that, the nearest ancestor with `overflow`
clips the popover — in the vault modal, for instance, the scrolling modal body.

The overlay layer is uniformly `z-[9999]`, one step above modals (`z-50`).

Two things follow that are easy to forget:

- **The outside-click handler must check trigger *and* popover** — as a portal child the
  popover is no longer a DOM descendant of the trigger.
- **Recalculate on `resize` and on `scroll` with `capture: true`**, so scrolling ancestors
  are caught too. Popovers flip upwards when there is too little room below, and shift
  away from the window edge. `ContextMenu` additionally clamps rather than only flipping, so
  a menu taller than the click's Y offset never gets a negative `top`.

### Keyboard

**Escape is caught in the capture phase inside `EmojiPicker`, with `stopPropagation()`.**
`Modal` registers its own Escape handler on the document as well, but in the bubble phase,
and it is always already mounted when the picker mounts. Without the interception, an
Escape inside an open picker would always be won by the modal — closing the whole dialog
along with the edit in progress instead of just the picker.

**Global search has no outside-click listener of its own.** `SearchModal` is a plain
`Modal`, so dismissal is `Modal`'s job; there is no drag region inside the modal for
Tauri's `drag.js` to race against, so no capture-phase `mousedown` trick is needed.

**Each title-bar menu button owns its own `MenuDropdown`** (no shared `role="menubar"`):
click or Down opens it, Up/Down move within it, Right/Left open and close submenus, Escape
or an outside click closes it. Only a menu opened by keyboard pulls focus into the panel —
opened by mouse the focus stays put, otherwise the editor would lose its selection and
Cut/Copy would have nothing left to act on.

**Search field and results list form a combobox pattern** (`role="combobox"`,
`aria-expanded`, `aria-controls`, `aria-activedescendant`): focus stays in the field, the
arrow keys only move the highlight in the list. Keyboard and mouse selection are a single
state (`aria-selected`), with no separate `:hover` alongside — otherwise two rows could look
selected at once.

### Shell Layout

**Frame and sheet.** The title bar, the rail and the left entry list all sit on
`--shell-bg` with no dividers between them and no gradients — together they read as one
frame. The main content area and the right sidebar together form a rounded "sheet"
(`--sheet-bg`, `--sheet-border`, `--sheet-radius: 10px`) on top of that frame, inset by
`--sheet-inset` (6px) on the right and bottom. The radius is one step under `rounded-xl`
on purpose: the sheet is window surface, not a panel sitting on one, and a softer radius
would balloon the corners against the frame.

- `.app-sheet-main`/`.app-sheet-side` carry the sheet's background and border;
  `.app-sheet-main-joined` drops the main area's right border and radius when the right
  sidebar sits next to it, so the two read as one surface split only by the sidebar's own
  divider.
- The left inset applies only when nothing sits left of the sheet — once the rail and the
  entry list are both collapsed (`.app-sheet-frame-free-left`); otherwise the frame's own
  left edge provides it.
- The splash and pre-paint colours match `--shell-bg` (see [Typography](#typography)), so
  the loading screen hands off to the frame without a visible seam.

**Title bar** (`TitleBar.tsx`, `h-10`; structure in
[Window Chrome](architecture/shell.md#window-chrome)). Flexbox, not a centring grid: the
left and right groups are `flex-shrink-0`, the space between holds the tab strip. Every
trigger is an icon-only `.titlebar .rail-button`, so nothing has to fold or be measured as
the window narrows — no `ResizeObserver`, no language-dependent breakpoint. The logo sits
centred in a box exactly `RAIL_WIDTH` wide, lining up with the rail's icon column; the menu
button follows with its own left margin rather than a shared `gap`, so its icon lines up
with the entry list's icons below.

Global search opens as `SearchModal` (`w-[560px]`, fixed `h-[70vh]`, matching
`LinkPickerModal`'s geometry). Its field is the bordered pill `.sidebar-search-inner`; it
shares only `.sidebar-search-input` with the entry list's borderless search field.

**Window buttons** (`WindowControls.tsx`, Windows and Linux only): 46×40px, square, no
gap, flush into the window corner — the Windows Fluent geometry. The glyphs are inline SVG
on a 10×10 grid with a 1px stroke rather than lucide icons, because lucide has no correct
"restore" symbol (two offset squares, the rear one clipped).

**Left sidebar** (see [Left Sidebar](architecture/navigation.md#left-sidebar-rail--entry-list)):
the 44px rail is part of the frame, with no divider against the entry list. `RAIL_WIDTH`
is exported by the rail and never repeated as a literal — the right sidebar's default width
and the title bar's logo box derive from it, so a mismatch would produce a clipped rail
*and* wrong widths elsewhere. `.app-sidebar-left-with-rail` trims the entry list's left
padding next to the rail, which already carries 6px of breathing room; otherwise the list's
icons would sit further from the rail's icons than the title bar's alignment suggests.

**Showing and hiding the sidebars is animated** (200ms). The content keeps its pixel width
and is clipped by the `<aside>` rather than squeezing together mid-transition; the
transition is a class (`.app-sidebar-animated`), not an inline style, so the
`prefers-reduced-motion` opt-out after it still wins; `AppShell` removes the class during a
resize drag so the edge doesn't lag the pointer.

**A non-dismissible modal leaves the title bar clear.** The backdrop is
`fixed inset-x-0 bottom-0` and starts at `top-10` instead of `top-0` as soon as
`usesCustomWindowControls` applies (Windows and Linux). Otherwise the backdrop would lie
over the app's own title bar, and with no X, Escape or backdrop click the only way out
would be Alt+F4. A dismissible modal keeps the full overlay — there the way out is the
modal itself.

### Emoji Picker Geometry

The measurements sit in unusual places, each for a concrete reason:

- **Width on the grid, not the frame.** `width`/`minWidth`/`maxWidth` are computed on the
  grid in cell units (`cell * n + gap * (n-1)`), not on the padded border box — otherwise
  there is too little room for 5 columns. `repeat(COLUMNS, minmax(0, 1fr))` forces the
  column count instead of `auto-fill`; 5 columns, down to 3 on a narrow viewport.
- **Scroll clipping on a wrapper of its own** (`max-h-56 overflow-y-auto
  overflow-x-hidden`), not on the grid: the global scrollbar rule produces a
  space-consuming bar on every platform, and an equally wide grid overflowed the wrapper on
  macOS. The grid is `SCROLLBAR_GUTTER` narrower than the wrapper, so the bar does not
  overlap the last column.
- **The search field gets the same explicit width as the grid**, no `w-full`: the altar
  sidebar's favicon picker sits in a block `<div>` whose wrapper spans the parent, where a
  `w-full` search bar would inflate itself.
- **The emoji search set loads lazily** (`src/lib/emojiSearchData/<lang>.json`, ~1900
  entries each, dynamic `import()` on first open, module-level cache); matches are capped at
  150.

### Platform Quirks

- **`.modal-card` has no `overflow-hidden` in its base class**, because individual modals
  have popover content that must leave the card bounds (the altar category emoji picker,
  for one). It is opted into per modal via `className`.
- **Platform-dependent looks branch in CSS through `html[data-platform]`**, never through a
  `navigator.userAgent` check in a component. `src/main.tsx` sets the attribute from
  `lib/platform.ts`'s `platformName`.

### Known Fault Line: `bg-stone-700/40` on the Search Fields

Global search's `SearchModal` carries a raw `bg-stone-700/40` on top of its
`.sidebar-search-inner` class. In Emerald Parchment the theme override for that utility
beats the class rule — so `--search-bg` does not apply there, the override value does. The
field still looks right, but the claim "runs on `--search-bg`" does not hold in Parchment.
Resolving it means removing `bg-stone-700/40` and checking the field in Parchment (a
comment at the site says so).
