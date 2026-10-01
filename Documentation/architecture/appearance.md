# Themes and Fonts

## Theming System

Emerald uses CSS custom properties scoped to `html[data-theme]` for all visual theming. Two named themes ship with the app: **Emerald Noctis** (dark, default) and **Emerald Parchment** (light).

### Architecture

```
src/themes/
├── emerald-noctis.css      # Dark theme — applied to :root and [data-theme='emerald-noctis']
├── emerald-parchment.css   # Light theme — applied to [data-theme='emerald-parchment']
└── theme.ts                # Theme helpers: DEFAULT_THEME_ID, THEME_OPTIONS, normalizeThemeId, applyTheme
```

Each theme file defines the same set of CSS custom properties. Components reference these variables rather than hardcoded colours. The Noctis theme is attached to both `:root` and its `data-theme` selector, making it the visual default when no theme attribute is present. Parchment is scoped only to its `data-theme` selector.

### Token Strategy

CSS custom properties follow a tiered naming convention:

| Tier | Prefix | Purpose | Examples |
|---|---|---|---|
| **Core surfaces** | `--bg-*` | App background, surface layers, elevated panels | `--bg-app`, `--bg-surface-1`, `--bg-surface-2`, `--bg-elevated` |
| **Text** | `--text-*` | Text colour hierarchy from primary to subtle | `--text-primary`, `--text-secondary`, `--text-muted`, `--text-subtle` |
| **Borders** | `--border-*` | Divider and edge styling | `--border-soft`, `--border-strong` |
| **Interactive** | `--interactive-*` | Hover and active state backgrounds | `--interactive-hover`, `--interactive-active` |
| **Accent** | `--accent*` | Primary action colour and contrast | `--accent`, `--accent-strong`, `--accent-contrast`, `--focus-ring` |
| **Component** | `--<component>-*` | Per-component tokens for complex UI | `--link-chip-*`, `--editor-*`, `--menu-*`, `--panel-*`, `--tab-*`, `--settings-*`, `--danger-*`, `--select-option-*`, `--linked-chip-*` |
| **Shell** | `--shell-*`, `--sheet-*` | Top-level layout backgrounds — the frame (`--shell-bg`) and the rounded sheet on top of it | `--shell-bg`, `--sheet-bg`, `--sheet-border` |
| **Utility** | `--scrollbar`, `--code-bg` | Shared utility tokens | `--scrollbar`, `--scrollbar-hover`, `--code-bg` |

When adding a new themed component, define component-scoped tokens (e.g. `--my-component-bg`) in both theme files and reference them from CSS. Avoid adding hardcoded colours to component stylesheets.

### Normalization Flow

Theme, font, interface size and editor text size are all part of the open vault's **appearance settings** now (`AppearanceSettings` in `src/lib/vaultSettings.ts` — see [Vault Settings](storage.md#vault-settings) below), not standalone `uiStore` fields. Each still normalizes the same way `theme.ts` always did:

```
vault's settings.json ('appearance.theme'), or the localStorage boot mirror before a vault is open
    ↓
normalizeThemeId(raw)
    ├─ raw is a valid ThemeId → return as-is
    ├─ raw === 'light'        → return 'emerald-parchment' (pre-ThemeId legacy value)
    └─ anything else          → return DEFAULT_THEME_ID ('emerald-noctis')
    ↓
applyTheme(themeId)
    ↓
document.documentElement.dataset.theme = themeId
```

`normalizeUIFontId`/`normalizeEditorFontId`/`normalizeUIScale`/`normalizeEditorFontSize` follow the same shape, the last two via the shared `oneOf(raw, options, fallback)` helper (`lib/helpers.ts`) rather than a bespoke switch each.

### Theme and appearance application

`store/settingsStore.ts`'s `applyAppearance(appearance)` — not a `useEffect` subscription in `App.tsx` — applies every appearance field the moment it changes, called from `loadForVault`, `update`, `clear`, and `replaceSettings`:

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

`applyTheme` sets `document.documentElement.dataset.theme = themeId`, which activates the matching `html[data-theme='…']` CSS rules. `applyUIScale` (new) calls `getCurrentWebview().setZoom(scale / 100)` — a no-op outside Tauri, since `getCurrentWebview()` throws synchronously in a plain browser tab (checked via `lib/platform.ts`'s `isTauri`). `applyEditorFontSize` (new) sets `--editor-font-size` on `documentElement.style` directly, the one appearance value with no CSS `data-*` attribute selector — the size is a number, not a small closed set worth branching CSS on.

### Theme, font and size options

`ThemeId`/`FontId`/`UIScale`/`EditorFontSize` and their option lists (`THEME_OPTIONS`, `FONT_OPTIONS`, `UI_SCALE_OPTIONS` — 90/100/110/120 — `EDITOR_FONT_SIZE_OPTIONS` — 14/15/16/17/18/20/22) all live in `src/themes/theme.ts`, which no longer imports `ThemeId`/`FontId` from `uiStore` — it defines them itself, since `uiStore` no longer carries theme/font state at all (see [Vault Settings](storage.md#vault-settings) below). Settings → General renders every picker from these option lists.

### Tailwind bridge

Because the app uses many Tailwind utility classes with hardcoded stone/jade colours, `src/index.css` contains a large Tailwind bridge section that overrides those classes under each `html[data-theme='…']` selector. This ensures that classes like `.bg-stone-900`, `.text-stone-100`, and `.border-stone-700` map to the correct theme variables. Both themes require bridge overrides — Noctis for jade accent adjustments and component-specific refinements, Parchment for the full light-mode colour mapping.

The Parchment bridge is organised into feature-scoped comment blocks at the end of `src/index.css`. The Altar module has its own block covering: sidebar control button backgrounds and borders, danger-button colours (mapped to `--danger-*` variables), jade CTA/fullscreen buttons (solid green), the slider track colour (warm translucent brown), the format-picker hover state, the `AltarReadingSummary` item-preview area background, the `from-stone-900` gradient-from colour used by category scroll-fade overlays, and the `.altar-cat-scroll-fade` utility class which sets a wider fade width (`3.5rem`) in Parchment. When new Altar controls are added that use hardcoded Tailwind classes, append their overrides to this Altar block rather than scattering them through the file.

### Adding a new theme

1. Create `src/themes/emerald-<name>.css` with all required custom properties (copy an existing file as a template).
2. Add the theme ID to the `ThemeId` union in `src/themes/theme.ts`.
3. Register it in `THEME_OPTIONS` and add any legacy mapping in `normalizeThemeId` in `src/themes/theme.ts`.
4. Import the new CSS file from `src/main.tsx` (or add it to `index.html`).
5. Add Tailwind bridge overrides in `src/index.css` under `html[data-theme='emerald-<name>']` for any hardcoded utility classes the theme needs to override.

### Shared style constants

Two modules centralise reusable Tailwind class strings to avoid duplication across components. `styleClasses.ts` is the established home for a repeated Tailwind chain — extend it rather than copying the chain again (see [`components.md`](../components.md)):

- **`src/lib/styleClasses.ts`** — Shared select class string for operation properties (`OP_PROP_SELECT_CLASSES`). The former `CUSTOM_PROP_INPUT_CLASSES`/`CUSTOM_PROP_SMALL_INPUT_CLASSES` were removed along with Custom Properties.
- **`src/lib/altarConstants.ts`** — Altar background presets (`ALTAR_BACKGROUND_PRESETS`, `ALTAR_BACKGROUND_STYLES`), photographic image presets (`ALTAR_IMAGE_PRESETS` — a readonly tuple of 16 preset names; `AltarImagePresetName` type), the default background (`DEFAULT_ALTAR_BACKGROUND`), canonical grid defaults (`DEFAULT_GRID_SIZE`, `DEFAULT_GRID_OPACITY`, `DEFAULT_GRID_COLOR`), the background overlay defaults (`DEFAULT_BACKGROUND_OVERLAY` = `0.2`; `DEFAULT_OVERLAY_COLOR` = `'dark'`), and the resolution system: `DEFAULT_ALTAR_RESOLUTION` (`'1920x1080'`), `BASE_RESOLUTION_WIDTH` (1920), `MAX_ALTAR_RESOLUTION_W` (7680), `MAX_ALTAR_RESOLUTION_H` (4320), `ALTAR_RATIOS`, `ALTAR_SIZE_KEYS`, `ALTAR_RESOLUTION_MAP`, `sizeAndRatioFromResolution`, `parseResolution`, `resolveResolutionPixels`, `isRatioFormat`, and `ratioFromResolution`. `resolveResolutionPixels(res)` is the preferred helper when the input may be either a ratio string or a pixel string: ratio inputs are mapped to their `ALTAR_RESOLUTION_MAP.lg` canonical pixel size first, then passed through `parseResolution`; pixel inputs go straight to `parseResolution`. All dashboard-facing code (`AltarCard`, `AltarCardPreview`, `AltarCanvas` thumbnail renderer) must use `resolveResolutionPixels` rather than calling `parseResolution` directly on `altar.resolution`. Also exports `getAltarBackgroundStyle(altar, imageSrc)` — the **single source of truth** for constructing the altar CSS background object; it accepts the altar record (to read `background_overlay` and `background_overlay_color`) and prepends a `buildOverlayGradient(opacity, color)` layer when the overlay value is greater than 0. The overlay layer is applied to **all** background types: custom images, image presets, gradient-color presets, and legacy colour presets. For custom image-backed backgrounds it interpolates `backgroundSrc` into CSS whenever it is non-empty — that value has to come from `imageSrc()`, which is what narrows it to a stored image or an inline source; for image presets it constructs a `url("/backgrounds/{name}.webp")` CSS background; for gradient presets it prepends the overlay to the `generateGradientStyle(hex)` result; for colour presets it prepends the overlay to the value from `ALTAR_BACKGROUND_STYLES`. Unknown preset values fall back to `DEFAULT_ALTAR_BACKGROUND`. All components that need a background style must call this function rather than constructing the CSS inline. Gradient-colour preset helpers: `GRADIENT_PRESET_COLORS` (readonly tuple of 7 dark hex values used as colour-gradient presets), `LEGACY_GRADIENT_COLORS` (maps each preset name to its base hex value), `isGradientPreset(preset)` (returns true when the preset string matches one of the gradient preset names), `getGradientColor(preset)` (returns the hex string for a gradient preset or `null` for unknown inputs), and `generateGradientStyle(hex)` (builds the radial-gradient CSS string from a hex colour). These are used internally by `getAltarBackgroundStyle` and by `AltarSidebarPanel` to render the gradient swatch buttons. The category list altar items draw from is the shared `categories` table (see [Categories](modules.md#categories) above), read via `useCategoryStore` — not anything in this file. `isCandleEmoji(emoji)`, added here in v38, is the one Altar-specific category-adjacent helper left: whether a placed item should flicker like a candle used to depend on the builtin Altar category `candle`; since that category became an ordinary, renameable/deletable row, it now depends on the item's own emoji (`🕯️`, matched with or without the variation selector `U+FE0F`) instead. Since v51 these defaults are what `parseAltarSettings` (`src/lib/altarSettings.ts`) fills into an altar's `settings` JSON for a missing or invalid key; the column itself defaults to `'{}'`. `parseResolution` validates the input string against `/^\d+x\d+$/` and clamps both dimensions before returning `{ w, h }`. `isRatioFormat` tests whether a string is a ratio (e.g. `"16:9"`). `ratioFromResolution` returns the matching `AltarRatio` for either format.

## Font System

Emerald supports two independent font selections, plus an independent editor text size, applied via CSS custom properties on `html`:

```
src/themes/theme.ts          # DEFAULT_UI_FONT_ID, DEFAULT_EDITOR_FONT_ID,
                             # FONT_OPTIONS, normalizeUIFontId, normalizeEditorFontId,
                             # applyUIFont, applyEditorFont,
                             # EDITOR_FONT_SIZE_OPTIONS, DEFAULT_EDITOR_FONT_SIZE,
                             # normalizeEditorFontSize, applyEditorFontSize
src/index.css                # --font-ui and --font-editor variable definitions,
                             # html[data-ui-font='…'] and html[data-editor-font='…'] selectors,
                             # --editor-font-size (set directly, no data-* selector)
src/lib/vaultSettings.ts     # uiFont, editorFont, editorFontSize fields of AppearanceSettings
src/store/settingsStore.ts   # applyAppearance() calls applyUIFont/applyEditorFont/applyEditorFontSize
                             # on loadForVault/update/clear/replaceSettings — see Vault Settings below
```

**Application flow.** `settingsStore`'s `applyAppearance()` calls `applyUIFont()` / `applyEditorFont()` / `applyEditorFontSize()` whenever the open vault's appearance settings load or change — not a `useEffect` subscription in `App.tsx` (see [Theme and appearance application](#theme-and-appearance-application) above). `applyUIFont`/`applyEditorFont` set `document.documentElement.dataset.uiFont` and `dataset.editorFont`, which activate the matching CSS rules in `src/index.css`; `applyEditorFontSize` sets `--editor-font-size` on `documentElement.style` directly.

**The font files ship with the app.** The eight typefaces come from `@fontsource` packages (`package.json`), never from the network. `src/fonts.css` holds their `@font-face` rules and is imported in `src/main.tsx` next to the theme files; Vite bundles the referenced `woff2` files (about 1.7 MB in total, `latin` and `latin-ext` subsets only, `font-display: swap`). The file is generated — `npm run fonts` runs `scripts/make-fonts-css.mjs`, whose `FONTS` map lists package and weights — because the packages' per-subset stylesheets carry no `unicode-range` and two of them side by side would cover each other; the script takes the rules from the complete files and keeps the two subsets. A new typeface or weight means `FONTS`, the package, `npm run fonts` and the font list in `theme.ts`. The CSP therefore names no remote origin (see [`security.md`](../security.md#content-security-policy)).

**CSS variable mapping.** Each font ID defines a `--font-<id>` variable with the full font-family stack. The `data-ui-font` selector sets `--font-ui`; the `data-editor-font` selector sets `--font-editor`. Components reference these variables:

- `--font-ui` is applied to the root `body` element (all UI chrome).
- `--font-editor` is applied to `.tiptap`, `.entry-view-title`, and `.entry-view-body`.
- `--editor-font-size` is applied wherever editor/field text should track the setting, independent of which font is chosen.

This means the editor font controls the TipTap editor body, entry titles in all detail views (journal, wiki, operations, altar), and the read-mode body text. There is no separate heading font — headings inherit the editor body font.

**Defaults.** UI font defaults to **Inter**; editor body font defaults to **Lora**; editor text size defaults to **17px** (the previous fixed value). Invalid or missing stored values fall back to these defaults via `normalizeUIFontId()` / `normalizeEditorFontId()` / `normalizeEditorFontSize()`.
