# Themes and Fonts

## Theming System

Emerald themes through CSS custom properties scoped to `html[data-theme]`. Two themes ship: **Emerald Noctis** (dark, default) and **Emerald Parchment** (light).

### Architecture

```
src/themes/
├── emerald-noctis.css      # Dark theme — :root and [data-theme='emerald-noctis']
├── emerald-parchment.css   # Light theme — [data-theme='emerald-parchment']
└── theme.ts                # ids, option lists, normalize* and apply* helpers
```

Each theme file defines the same set of custom properties, and components reference these instead of hardcoded colours. Noctis is attached to `:root` as well, so it is the visual default when no theme attribute is present.

### Token Strategy

| Tier | Prefix | Purpose | Examples |
|---|---|---|---|
| **Core surfaces** | `--bg-*` | App background, surface layers, elevated panels | `--bg-app`, `--bg-surface-1`, `--bg-surface-2`, `--bg-elevated` |
| **Text** | `--text-*` | Text hierarchy from primary to subtle | `--text-primary`, `--text-secondary`, `--text-muted`, `--text-subtle` |
| **Borders** | `--border-*` | Dividers and edges | `--border-soft`, `--border-strong` |
| **Interactive** | `--interactive-*` | Hover and active backgrounds | `--interactive-hover`, `--interactive-active` |
| **Accent** | `--accent*` | Primary action colour and contrast | `--accent`, `--accent-strong`, `--accent-contrast`, `--focus-ring` |
| **Component** | `--<component>-*` | Per-component tokens for complex UI | `--link-chip-*`, `--editor-*`, `--menu-*`, `--panel-*`, `--tab-*`, `--settings-*`, `--danger-*`, `--select-option-*`, `--linked-chip-*` |
| **Shell** | `--shell-*`, `--sheet-*` | The window frame and the rounded sheet on top of it | `--shell-bg`, `--sheet-bg`, `--sheet-border` |
| **Utility** | `--scrollbar`, `--code-bg` | Shared utility tokens | `--scrollbar`, `--scrollbar-hover`, `--code-bg` |

A new themed component defines its own tokens (e.g. `--my-component-bg`) in both theme files and references them from CSS — no hardcoded colours in component styles.

### Normalization Flow

Theme, fonts, interface size and editor text size are the open vault's **appearance settings** (`AppearanceSettings` in `src/lib/vaultSettings.ts`, see [Vault Settings](storage.md#vault-settings)). Each value is normalized before it is applied:

```
settings.json ('appearance.theme'), or the localStorage boot mirror before a vault is open
    ↓
normalizeThemeId(raw)
    ├─ raw is a valid ThemeId → return as-is
    ├─ raw === 'light'        → 'emerald-parchment' (value from before theme ids)
    └─ anything else          → DEFAULT_THEME_ID ('emerald-noctis')
    ↓
applyTheme(themeId)  →  document.documentElement.dataset.theme = themeId
```

`normalizeUIFontId`/`normalizeEditorFontId`/`normalizeUIScale`/`normalizeEditorFontSize` follow the same shape, the last two via the shared `oneOf(raw, options, fallback)` helper (`lib/helpers.ts`).

### Theme and appearance application

`applyAppearance(appearance)` in `store/settingsStore.ts` applies every appearance field the moment it changes — called from `loadForVault`, `update`, `clear` and `replaceSettings`, not from a `useEffect` in `App.tsx`:

```ts
// store/settingsStore.ts
async function applyAppearance(appearance: AppearanceSettings) {
  applyTheme(appearance.theme);
  applyUIFont(appearance.uiFont);
  applyEditorFont(appearance.editorFont);
  applyUIScale(appearance.uiScale);
  applyEditorFontSize(appearance.editorFontSize);
  // …mirrors into localStorage, then changeAppLanguage(appearance.language)
}
```

- `applyTheme` sets `data-theme`, which activates the matching `html[data-theme='…']` rules.
- `applyUIScale` calls `getCurrentWebview().setZoom(scale / 100)`; it is a no-op outside Tauri (`isTauri` from `lib/platform.ts`), where `getCurrentWebview()` would throw.
- `applyEditorFontSize` sets `--editor-font-size` on `documentElement.style` directly — a number, not a small closed set worth a `data-*` selector.

### Theme, font and size options

`ThemeId`, `FontId`, `UIScale`, `EditorFontSize` and their option lists (`THEME_OPTIONS`, `FONT_OPTIONS`, `UI_SCALE_OPTIONS` — 90/100/110/120 — and `EDITOR_FONT_SIZE_OPTIONS` — 14/15/16/17/18/20/22) live in `src/themes/theme.ts`. Settings → General renders every picker from these lists.

### Tailwind bridge

Many components use Tailwind utilities with hardcoded stone/jade colours, so `src/index.css` has a large bridge section that overrides those classes under each `html[data-theme='…']` selector (`.bg-stone-900`, `.text-stone-100`, `.border-stone-700`, …). Both themes need it — Noctis for jade accent adjustments and component refinements, Parchment for the full light-mode mapping.

The Parchment bridge is organised into feature-scoped comment blocks at the end of `src/index.css`. The Altar block covers the sidebar control buttons, danger buttons (mapped to `--danger-*`), the jade CTA/fullscreen buttons, the slider track, the format-picker hover, the `AltarReadingSummary` preview background, the `from-stone-900` fade overlays, and `.altar-cat-scroll-fade` (wider, `3.5rem`, in Parchment). New Altar controls with hardcoded Tailwind classes add their overrides to that block rather than scattering them through the file.

### Adding a new theme

1. Create `src/themes/emerald-<name>.css` with all required custom properties (copy an existing file).
2. Add the id to the `ThemeId` union in `src/themes/theme.ts`.
3. Register it in `THEME_OPTIONS`, and add any legacy mapping to `normalizeThemeId`.
4. Import the CSS file from `src/main.tsx`.
5. Add Tailwind bridge overrides in `src/index.css` under `html[data-theme='emerald-<name>']`.
6. Extend the inline boot script in `index.html`, which maps the stored theme id itself (see [Loading Screen and Boot Order](shell.md#loading-screen-and-boot-order)).

### Shared style constants

Repeated Tailwind class chains go into **`src/lib/styleClasses.ts`** (currently `OP_PROP_SELECT_CLASSES`) — extend it rather than copying a chain again (see [`components.md`](../components.md)). The altar's background presets, defaults and resolution helpers live in **`src/lib/altarConstants.ts`**, described under [Altar constants](altar.md#altar-constants).

## Font System

Two independent font selections plus an editor text size, applied through CSS custom properties on `html`:

```
src/themes/theme.ts          # FONT_OPTIONS, DEFAULT_UI_FONT_ID, DEFAULT_EDITOR_FONT_ID,
                             # EDITOR_FONT_SIZE_OPTIONS, DEFAULT_EDITOR_FONT_SIZE,
                             # normalize*/apply* for fonts and size
src/index.css                # --font-ui, --font-editor, --editor-font-size defaults;
                             # html[data-ui-font='…'] and html[data-editor-font='…'] selectors
src/fonts.css                # @font-face rules (generated, see below)
src/lib/vaultSettings.ts     # uiFont, editorFont, editorFontSize in AppearanceSettings
```

**Application flow.** `applyAppearance()` (see [Theme and appearance application](#theme-and-appearance-application)) calls `applyUIFont`/`applyEditorFont`, which set `dataset.uiFont`/`dataset.editorFont` on `documentElement` and so activate the matching rules in `src/index.css`, and `applyEditorFontSize`, which sets `--editor-font-size` directly.

**The font files ship with the app.** The eight typefaces come from `@fontsource` packages, never from the network, so the CSP names no remote origin (see [`security.md`](../security.md#content-security-policy)). `src/fonts.css` holds their `@font-face` rules and is imported in `src/main.tsx`; Vite bundles the `woff2` files (about 1.7 MB, `latin` and `latin-ext` only, `font-display: swap`).

The file is generated: `npm run fonts` runs `scripts/make-fonts-css.mjs`, whose `FONTS` map lists package and weights. The packages' per-subset stylesheets carry no `unicode-range`, so two side by side would cover each other; the script takes the rules from the complete files and keeps the two subsets. A new typeface or weight means `FONTS`, the package, `npm run fonts`, and `FONT_OPTIONS` in `theme.ts`.

**CSS variable mapping.** Each font id defines a `--font-<id>` variable with the full stack; `data-ui-font` sets `--font-ui`, `data-editor-font` sets `--font-editor`.

- `--font-ui` is applied to `body` (all UI chrome).
- `--font-editor` is applied to `.tiptap`, `.entry-view-title`, `.entry-view-body` and block text — the editor, entry titles in every detail view, and read-mode body text. There is no separate heading font.
- `--editor-font-size` is applied wherever editor and field text should track the setting, independent of the font.

**Defaults.** UI font **Inter**, editor font **Lora**, editor text size **17px**. Invalid or missing values fall back to these via `normalizeUIFontId()`/`normalizeEditorFontId()`/`normalizeEditorFontSize()`.
