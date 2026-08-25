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
[`architecture.md`](architecture.md#theming-system).

---

## Binding Rules

### Colour

**Exactly one source: the theme CSS variables.** `--accent`, `--text-*`, `--border-*`,
`--bg-*`, `--panel-*`, `--menu-*`, `--search-*`. They are fully defined in both themes
(82 properties each) and are the only thing guaranteed to look right in both.

**Raw Tailwind colour utilities are a deviation.** `stone-*`, `jade-*`, `red-*` and
`amber-*` in a component only theme in Emerald Parchment for as long as someone maintains
a bridge override for them in `index.css`. Setting such a class silently takes on the
obligation to keep it in step across both themes — that is the mechanism the primary
colour's triple maintenance grew out of.

**Exactly one accent: jade.** `amber` is confined to the single documented case — the
`tone="amber"` mode for the edit action in row action bars — and is not extended. A third
accent tone needs a theme token in both files first.

**Red means destructive, nothing else.** Via `Button variant="danger"` or `tone="danger"`,
not via a per-site red treatment of its own.

### Typography

- **UI**: `font-sans` — Inter by default, switchable in settings.
- **Editor**: `font-serif` — Lora by default, configured separately.
- Applied through `data-ui-font`/`data-editor-font` on `<html>`, never through a direct
  `font-family` in a component.
- Eight selectable Google Fonts, loaded through a single `<link>` in `index.html`.
  A ninth font means `theme.ts` **and** the link — both or neither.
- `font-mono` is currently unusable, see [Open Points](#open-points).

### Border Radius

Four steps, each with a responsibility. Not chosen by feel:

| Step | For |
| --- | --- |
| `rounded-md` | small controls: inputs, chips, icon buttons, list rows, tiles |
| `rounded-lg` | buttons and **floating surfaces**: menu, popover, toast, dropdown |
| `rounded-xl` | surfaces that carry content: `.panel`, `.panel-interactive`, `.modal-card` |
| `rounded-full` | genuinely round elements only: dots, avatars, filter pills |

`rounded-sm` stays reserved for decorative miniature surfaces below ~16px (colour swatch,
resize handle, image thumbnail) — `rounded-md` would be visibly too round there. It is not
a general step.

The rule settles the case this used to snag on: `ContextMenu` and `UndoToast` are both
small floating overlays and therefore belong on the same step (`lg`). What decides is
**what an element is**, not how large it is.

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

**Two bar heights, no third:**

- `h-10` (40px) — window chrome: title bar, tab bar.
- `h-14` (56px) — content bars: entry list tabs, `RightSidebarActionBar`, dashboard topbar.

The split is deliberate: the title bar is window chrome, not a content header, and 56px
feels heavy for that. Because it sits *above* the three-column shell, this does not
collide with the 56px to its left and right below — the two sidebars must place their
bottom divider at the same height.

**Horizontal padding has exactly one source per column.** The column's outer container
sets it; the panels inside add no `px-*` of their own. In the right sidebar that is the
scrolling properties container (`p-3` in `RightSidebar.tsx`, with a comment in place) — if
a panel adds its own padding again, the summary rows end up visibly indented differently
from the button in the action bar above them.

There is no enforced spacing scale. Observed practice: `px-8` for toolbar strips in the
main area, `px-3`/`p-3` in the sidebars, `px-4 py-3` through `px-5 py-4` in modal headers
and bodies.

### States

**Focus must be visible in both themes.** A new focusable element without a
`:focus-visible` rule in *both* theme blocks is unfinished. `--focus-ring` exists for
exactly this.

**Disabled runs through the shared `:disabled` rule**
(`opacity-50 cursor-not-allowed pointer-events-none`), not through a colour of its own.
Where theme rules are more specific than `:disabled` — `.menu-item`, for instance — the
element is dimmed via `opacity`, because a colour declaration there would not get through.

**Active/inactive toggles use `Button`'s `tone` mode**, not a ternary in the `className`
template. The four base variants (`primary`/`secondary`/`ghost`/`danger`) have no active
state; `tone` does. Documented exceptions: `EditorToolbar`'s `ToolbarBtn` and
`AltarCanvas`'s drag handles — neither is a generic action button.

**Animations respect `prefers-reduced-motion`** and live as a class in the stylesheet,
never as an inline style: an inline style beats every rule in the stylesheet and with it
the opt-out.

---

## Open Points

Where the code contradicts the rules above today. No prioritisation — each point names the
rule, the violation, and what resolving it would cost.

**1. The primary colour is maintained independently in three places.**
The `jade` Tailwind scale (`tailwind.config.js`), the per-theme `--accent` variables, and
the bridge overrides in `index.css` that set yet another set of hex values for
`.btn-primary` and friends (`html[data-theme='emerald-noctis'] .btn-primary` from line
1190, Parchment from 1618). Noctis's `--accent: #00c47f` happens to be exactly `jade-600`;
Parchment's `#008a57` sits between no two steps of the scale.
*Cost: move the bridge overrides onto `var(--accent*)` and check that the layer ordering
still holds.*

**2. 1039 raw colour utilities across 49 `.tsx` files.** The largest single item, and the
reason point 1 exists at all. *Cost: not doable in one pass — sensible only file by file
or module by module, each verified in both themes.*

**3. `amber` is a second accent tone with no theme equivalent.** It comes from Tailwind's
default palette, not from an `--accent-*` variable and not from the `parchment` scale.
Emerald Parchment needs its own overrides on the underlying utility classes for it
(`.bg-amber-900\/30` and others).
*Cost: one token pair in both theme files, then switch `TONE_CLASSES` over.*

**4. The `parchment` Tailwind scale carries eleven steps for a single shade.**
It is used 19 times, without exception as `text-parchment-500/70` for date text in list
rows. The Parchment *theme* does not use it at all — that runs on its own CSS variables,
whose values do not map onto this scale. The name suggests a connection that does not
exist.
*Cost: move the 19 sites onto `--text-muted` or similar, then delete the scale.*

**5. Icon sizes sit off the scale in roughly a third of cases.** Around 100 occurrences at
13, 11, 15, 10, 9, 8 and 7px, in places inconsistent within a single file — `SettingsModal.tsx`
mixes 13 and 14 for section icons with no discernible pattern.
*Cost: mechanical but widely scattered; best done per file when it is touched anyway.*

**6. `UndoToast` carries `rounded-xl`** and is therefore the only known violation of the
radius rule — a floating overlay on the surface step. *Cost: one line.*

**7. `JetBrains Mono` is dead config.** Declared as `font-mono` in `tailwind.config.js:46`
but never loaded via a `<link>`. Every site using `font-mono` falls back to the system
monospace. *Cost: either load it or strike it from the config — the decision is open
because it is unclear whether `font-mono` is needed at all.*

**8. Emerald Noctis lacks the generic focus rule.** Parchment has
`html[data-theme='emerald-parchment'] button:focus-visible` (`index.css:1426`); Noctis has
`:focus-visible` only for individual classes (`.window-control`, `.titlebar-menu-trigger`,
`.menu-item`, `.link-picker-row`). Every button outside that list looks unfocused in
Noctis. It shows most on the `RightSidebarActionBar`, since that became the only home of
the entry actions. *Cost: one rule, mirrored from Parchment.*

**9. The entry actions live exclusively in a collapsible surface.**
Edit/Done/Delete/Cancel exist only in the right sidebar. Collapsing it mid-edit leaves no
visible way back; there is no keyboard fallback. *Switching* into edit mode expands it
automatically (`usesEditorSidebar` in `uiStore.ts`) — that covers entry, not later
collapsing. Mitigated, not fixed: both sidebars can also be reopened from the View menu.
*Cost: keyboard shortcuts for Edit/Done/Cancel, or a second home for the actions.*

**10. Tab strip and action bar do not always line up.** `LeftSidebarEntryList`'s tab strip
is `min-h-14` and wraps onto a second row below 226px panel width, while
`RightSidebarActionBar` stays `h-14`. **Deliberate:** growing the right bar too would mean
enlarging it for a reason that has nothing to do with its own content. The point is
recorded here so the deviation is not reported as a bug.

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
define the same 82 properties. Core values:

| Property | Emerald Noctis (dark) | Emerald Parchment (light) |
| --- | --- | --- |
| `--bg-app` | `#15110d` | `#f7efdf` |
| `--text-primary` | `#f5f5f4` | `#2c2014` |
| `--accent` | `#00c47f` | `#008a57` |
| `--accent-strong` | `#00a066` | `#006941` |
| `--focus-ring` | `rgba(0, 196, 127, 0.42)` | `rgba(0, 138, 87, 0.34)` |
| `--danger-text` | `#f87171` | `#b63f32` |
| `--panel-bg` | `rgba(38, 32, 27, 0.78)` | `#f7eddb` |
| `--menu-shadow` | `0 14px 36px rgba(0,0,0,0.35)` | `0 18px 36px rgba(96,63,30,0.2)` |
| `--titlebar-bg` | `rgba(24, 20, 16, 0.94)` | `#ecdec7` |
| `--tabbar-bg` | `rgba(28, 23, 19, 0.86)` | `rgba(240, 225, 201, 0.9)` |

`--titlebar-bg` is deliberately a little darker (respectively warmer) than `--tabbar-bg`,
so the two strips do not visually merge into one.

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

**2. Unlayered beats layered, regardless of specificity.** In Emerald Parchment a
`@layer base` rule sets `border-color` on virtually every element. Declarations from
`@layer components` — where `.panel` and most semantic classes live — lose against
unlayered rules even at higher specificity.

Consequence: a new "active" variant on a `.panel` card needs either its own **unlayered**
rule or must forgo `.panel` entirely. Both ways out are present in the code:

- `.vault-card*` forgoes `.panel` and rebuilds the look; the accent border colour of the
  active card deliberately sits outside any `@layer` block (`index.css:552`, with a
  comment in place) rather than with the other `.vault-*` classes in `@layer components`
  (from `index.css:384`).
- `.task-row-target` (`index.css:252`) marks the row a search hit points at using
  `outline` rather than `background`/`border`/`box-shadow` — all three would be
  overridden by `html[data-theme=…] .panel-interactive`.

Both `color-mix()` sites (`.search-match`, `.task-row-target`) carry an `rgba()` line as a
fallback ahead of them, for WebKit before 16.2 / WebKitGTK before 2.40.

### Overlays and Portals

**Everything floating hangs off `document.body` via `createPortal`** and positions itself
with `position: fixed` in viewport coordinates: `Modal`, `ContextMenu`, `EmojiPicker`,
`MenuDropdown`, `TitleBarSearchResults`.

The reason is the same for all of them: `.app-sidebar` and `.app-main` carry
`position: relative; z-index: 1` in both themes and are therefore **sibling stacking
contexts**. An overlay rendered inline in the sidebar loses against the later-painted main
area no matter how high its `z-index` number is. On top of that, the nearest ancestor with
`overflow` clips the popover — in the vault modal, for instance, the scrolling modal body.

The overlay layer is uniformly `z-[9999]`, one step above modals (`z-50`).

Two things follow that are easy to forget:

- **The outside-click handler must check trigger *and* popover** — as a portal child the
  popover is no longer a DOM descendant of the trigger.
- **Recalculate on `resize` and on `scroll` with `capture: true`**, so scrolling ancestors
  are caught too. Popovers flip upwards when there is too little room below, and shift
  away from the window edge. `ContextMenu` additionally clamps rather than only flipping:
  a menu taller than the click's Y offset used to get a negative `top`.

### Keyboard

**Escape is caught in the capture phase inside `EmojiPicker`, with `stopPropagation()`.**
`Modal` registers its own Escape handler on the document as well, but in the bubble phase,
and it is always already mounted when the picker mounts. Without the interception, an
Escape inside an open picker would always be won by the modal — closing the whole dialog
along with the edit in progress instead of just the picker.

**The outside-click listener of the search results list also sits in the capture phase.**
Tauri's `drag.js` attaches its own `mousedown` listener to `document` ahead of anything the
app registers, and calls `stopImmediatePropagation()` on every `data-tauri-drag-region`
element — which is exactly the gap to the left and right of the search field. In the bubble
phase a click there would have dragged the window and left the list standing open.

**The menu bar carries `role="menubar"` and honours the contract that comes with it:**
Left/Right move between menus, Down opens and enters, Up/Down move within, Right/Left open
and close submenus, Escape closes. Only a menu opened by keyboard pulls focus into the
panel — opened by mouse the focus stays put, otherwise the editor would lose its selection
and Cut/Copy would have nothing left to act on.

**Search field and results list form a combobox pattern** (`role="combobox"`,
`aria-expanded`, `aria-controls`, `aria-activedescendant`): focus stays in the field, the
arrow keys only move the highlight in the list beside it. Keyboard and mouse selection are
a single state (`aria-selected`), with no separate `:hover` alongside — otherwise two rows
could look selected at once.

### Shell Layout

**Title bar** (`TitleBar.tsx`, `h-10`). Flexbox, not a centring grid: the left column
(logo, menu bar, back/forward) and the right one (window buttons) are `flex-shrink-0`, the
middle one with the search field is `flex-1 min-w-0` — the only one that gives way.

Once the remaining space drops below 192px (`SEARCH_MIN_PX`), the four menus fold into a
single button with a menu icon. The switch point is **not a fixed window width** but is
computed via `ResizeObserver` from the menu bar's actually rendered width: it is 315px wide
in German against 203px in English, so a constant would serve one of the two languages
wrong. The expanded width is remembered in a ref and reused while collapsed, otherwise the
two states oscillate; a language change discards the cache. In altar focus mode the bar
never collapses — there is no search field to protect there. The window's minimum width is
720px.

The search pill is `h-7` (28px), not the ~34px of the entry list search: in a 40px bar a
34px field would nearly fill the bar.

**Window buttons** (`WindowControls.tsx`, Windows and Linux only): 46×40px, square, no
gap, flush into the window corner — the Windows Fluent geometry. The glyphs are inline SVG
on a 10×10 grid with a 1px stroke rather than lucide icons, because lucide has no correct
"restore" symbol (two offset squares, the rear one clipped).

**Left sidebar**: `LeftSidebarRail.tsx` (fixed 56px icon strip, its own `--shell-bg`
background, setting it apart from the entry list panel on `--sidebar-bg`) plus
`LeftSidebarEntryList.tsx` beside it. `RAIL_WIDTH` is exported by the rail and consumed by
`AppShell` instead of appearing a second time as `w-14` — the right sidebar's default width
derives from it, so a mismatch would produce a clipped rail *and* a wrong width on the
right.

`TabIconButton` carries `border border-transparent` in its base state, because the theme
rules give the active tab a 1px border: without the placeholder the active tab is 32px wide
and the inactive ones 30, the row jumps by 2px on every tab change, and the six tabs no
longer fit the entry list's default width derived from them.

**Showing and hiding either sidebar is animated** (200ms width transition). The content
keeps its pixel width and is clipped by the `<aside>` rather than shrinking along — otherwise
it would visibly squeeze together and the tab strip would wrap mid-transition. During a
resize drag `AppShell` removes the `.app-sidebar-animated` class, otherwise the edge lags
behind the pointer. The transition lives as a class in `index.css` (line 268), not as an
inline style: an inline style would beat the `prefers-reduced-motion` opt-out directly
below it (line 276), which wins on order at equal specificity.

**A non-dismissible modal leaves the title bar clear.** The backdrop is
`fixed inset-x-0 bottom-0` and starts at `top-10` instead of `top-0` as soon as
`usesCustomWindowControls` applies (Windows and Linux). Without that the backdrop would lie
over the app's own title bar, and with no X, Escape or backdrop click the only way out
would be Alt+F4. A dismissible modal keeps the full overlay — there the way out is the
modal itself.

### Emoji Picker Geometry

The measurements sit in unusual places, each for a concrete reason:

- **Width on the grid, not the frame.** `width`/`minWidth`/`maxWidth` are computed on the
  grid element in cell units (`cell * n + gap * (n-1)`), not on the padded border box
  outside — otherwise there was too little room left for 5 columns.
  `grid-template-columns: repeat(COLUMNS, minmax(0, 1fr))` forces the column count exactly
  instead of deriving it from available width via `auto-fill`. Max 5, min 3 columns; on too
  narrow a viewport (`maxWidth: calc(100vw - 3rem)`) the grid shrinks to the hard lower
  bound.
- **Scroll clipping on a wrapper of its own**, not on the grid
  (`max-h-56 overflow-y-auto overflow-x-hidden`). The global scrollbar rule produces a
  classic, space-consuming rather than an overlaying bar on every platform; an equally wide
  grid overflowed the wrapper on macOS. `overflow-x-hidden` suppresses the artefact, and the
  grid is a fixed `SCROLLBAR_GUTTER` (`0.5rem`) narrower than the wrapper via its own
  `gridStyle` object, so the vertical bar does not overlap the last column.
- **The search field gets the same explicit width as the grid**, no `w-full`:
  `AltarSidebarPanel`'s favicon picker is the one caller sitting in a block `<div>`, whose
  wrapper expands to 100% of the parent width — a `w-full` search bar would have inflated
  itself against that much wider wrapper there.
- **The emoji search set is loaded lazily.** `src/lib/emojiSearchData/{en,de,es,fr}.json`,
  around 1900 entries each, via dynamic `import()` on first open; Vite code-splits this
  automatically per language (~100–150 KB) and a module-level cache prevents repeat loads.
  Matches are capped at 150.

### Platform Quirks

- **`MIN_PANEL_REM = 24` instead of a px constant** for the minimum width of the search
  results list: WebKitGTK derives its root font size from the GTK text scaling, so a fixed
  px number would collapse to fewer than ten characters at a larger system font.
- **`.modal-card` has no `overflow-hidden` in its base class**, because individual modals
  have popover content that must leave the card bounds (the altar category emoji picker,
  for one). It is opted into per modal via `className`.
- **Platform-dependent looks branch in CSS through `html[data-platform]`**, never through a
  `navigator.userAgent` check in a component. Where the attribute comes from is covered in
  [`components.md`](components.md).

### Known Fault Line: `bg-stone-700/40` on the Search Fields

Both search pills (title bar and entry list) carry a raw `bg-stone-700/40` on top of the
`.sidebar-search-inner` class. In Emerald Parchment the theme override for that utility
class beats the class rule — so `--search-bg` does not apply there, the override value
does. Both fields still look the same, but the claim "runs on `--search-bg`" does not hold
in Parchment. Resolving it cleanly would mean removing `bg-stone-700/40` from both places
**together**.
