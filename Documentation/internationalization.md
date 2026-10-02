# Internationalisation

Emerald supports four languages: English (`en`), German (`de`), Spanish (`es`), and French (`fr`).

The language is a **per-vault setting** (Settings → General → Language, part of `appearance` in the vault's `settings.json` — see [`database.md`](database.md#multi-vault-system) and [Vault Settings](architecture/storage.md#vault-settings)), applied through `settingsStore.loadForVault`/`update`.

It is mirrored into `localStorage` (`app-language`) only as a boot-time starting point: `main.tsx` reads the mirror before any vault is open, so the app doesn't flash English while the vault's settings load. Once a vault has loaded, its `settings.json` is authoritative.

## Setup

Translations are managed with `react-i18next`; the setup lives in `src/i18n/index.ts`. Only `en` — the startup and fallback language — is imported statically. `de`/`es`/`fr` load on demand as their own chunks, like the emoji search data (`src/lib/emojiSearch.ts`). `LANGUAGE_OPTIONS` in the same file is the one list of available languages.

**Always switch languages through `changeAppLanguage(lang)`.** It loads the bundle (and the matching date-fns locale) before calling `i18n.changeLanguage`, then writes the `localStorage` mirror and `<html lang>`, and lets the last of two racing switches win. A direct `i18n.changeLanguage` would switch to a not-yet-registered locale and render the English fallback. The callers are `settingsStore`'s `applyAppearance` and the startup path in `main.tsx`.

Code without hook access (stores, migrations, importers — e.g. the duplicate actions' `common.copySuffix`) reads translations through the default `i18n` export.

Translation files:

```
src/i18n/locales/en.json
src/i18n/locales/de.json
src/i18n/locales/es.json
src/i18n/locales/fr.json
```

All four files must have the same key structure. A key missing from a non-English locale silently falls back to English, which is easy to miss — always add every key to all four files.

`npm run check:i18n` (`scripts/i18n-check.mjs`, run in CI) verifies this: it flattens all four files to `a.b.c` paths and fails if a language lacks a key English has, has a key English doesn't, or a value's `{{placeholder}}`s differ from English's. It deliberately does not detect dead keys — dynamic lookups like `t(`${module}.categories.${id}`)` would make a static search too noisy to trust.

## Using Translations

Inside any React component, use the `useTranslation` hook:

```tsx
import { useTranslation } from 'react-i18next';

function MyComponent() {
  const { t } = useTranslation();
  return <span>{t('journal.title')}</span>;
}
```

Never hardcode display text. Every string visible to the user must go through `t()`.

## Adding a New Key

1. Decide where the key belongs in the JSON hierarchy (e.g. `operations.newField`).
2. Add the key and its English value to `en.json`.
3. Add the same key with translated values to `de.json`, `es.json`, and `fr.json`.
4. Use `t('operations.newField')` in the component.

Skipping step 3 is the most common mistake: the fallback to English makes the omission invisible when testing in English.

## Built-in Category Names

Wiki, Operations, Tasks, and Altar items share one `categories` table (see [`database.md`](database.md#categories)). Only one row is a true built-in (`is_builtin = 1`): `sigils` (a new operation in it starts with the sigil blocks). Its `name` column holds a fixed English seed value that must never be displayed directly — the display name always goes through the shared helper:

```tsx
// correct — the one rule for all four modules
import { categoryLabel } from '../lib/categories';
const label = categoryLabel(t, cat);

// wrong — always shows English for a builtin
const label = cat.name;
```

`categoryLabel` resolves a builtin via `categories.builtin.<id>` and returns `cat.name` unchanged for everything else. That includes a fresh vault's eight starter categories: `categories.starter.<key>` is used only once, to *name* them at creation; from then on they are ordinary rows the user can rename or delete.

The module-scoped keys `wiki.categories.*`, `operations.categories.*` and `altar.categories.*` are **legacy-only and must stay in all four locale files**: migrations v36–v38 and the importer for `.emerald`/backup files written before v38 resolve an old builtin id or name through them. Nothing in the live UI reads them; do not remove them, and do not add new keys there.

## Key Structure

Top-level keys of `en.json`, with the conventions worth knowing:

| Key | Contents |
|---|---|
| `common` | Shared labels: `save`/`cancel`/`delete`/`ok`, `loading`, the shared inline delete confirmation `confirmSure`/`confirmYes`/`confirmNo` ("Sure? Yes/No"), `copySuffix`, image-format and size messages, `searchEmoji`/`noEmojiResults` for the shared `EmojiPicker` |
| `categories` | The one category block for all four modules: the Categories view (`add`, `name`, `nameTaken`, `dragHint`, `builtinHint`), `uncategorized`, `builtin.*` and `starter.*` (see [Built-in Category Names](#built-in-category-names)) |
| `listView` | View/sort/grouping labels of the dashboard sidebar. The sort trigger combines a date field (`dateCreated`/`dateUpdated`/`dateDeleted`) with `sortNewest`/`sortOldest`, or uses `sortAlphaAsc`/`sortAlphaDesc`/`sortCountDesc`. `groupBy` (`"Group by {{label, lowercase}}"`) uses the `lowercase` formatter registered in `src/i18n/index.ts`; German capitalises the noun and skips the formatter |
| `undo` | Undo toast messages |
| `nav` | Navigation labels, including `home`, `categories`, `all` and `vaults`. A rail entry needs its `nav.<id>` key in all four locales, since `ModuleMeta`/`AUX_VIEWS` resolve the label dynamically |
| `sidebar` | Left sidebar strings (`allEmpty`) |
| `journal`, `wiki`, `operations`, `tasks`, `altar` | Module UI strings. Each module's `untitled` key is what `displayTitle` (`src/lib/entryTitle.ts`) shows for an empty title — display text only, never stored. `*.categories.*` is legacy-only (see above) |
| `altar` | Also: the "element" wording for library items (`addElement`, `elementName`, `noElements`, `placedElements`), background presets under `backgrounds.*`, overlay, grid and inspector labels (units are rendered in the UI, not in the values), the dashboard's `sectionTitle`/`libraryTitle` and their own sort labels `sortAltars`/`sortLibrary` |
| `creation` | The sigil creation tools (intention, letters, canvas, charge) |
| `blocks` | Content-block UI and the Blocks view: `types.*` (block types), `kinds.*` (one per `ElementKind`, shared by the "Add block" menu and the builder's element picker), `fields.*` (field block), `sigil.*` (standalone sigil blocks and their in-block parts), `altar.*` (altar field kind), `library.*` (the Blocks builder and its update/remove-copies notices) |
| `editor` | Shared editor buttons, link-popup actions, `lockedBySigil`, and `toolbar.*` (every formatting-toolbar tooltip) |
| `moonPhase` | Display names of the eight moon phases |
| `search` | Dashboard search placeholders (`placeholder`, `placeholderIn` with `{{title}}`) and the title bar's global search (`globalPlaceholder`, `hint`, `clear`, `showMore`). Result module labels reuse `nav.*`; only `altarElements`/`categories` have their own |
| `templates` | Templates dashboard and page; `builtin.sigil` names the built-in `core-sigil` template the way `categories.builtin.*` names a category; `insert.*` is the editor's picker and apply flow |
| `lexicon` | Lexicon dashboard, language page and translate field. `wordCount` counts vocabulary rows; the translated text's own count is `textWordCount` |
| `tags` | Tags view (`new`, `name`, `nameTaken`, `color`, `unused`, `onlyInTemplates`) |
| `properties` | Right sidebar Properties panel |
| `filters` | Filter panel; `all` is the "All" row every `FilterList` shows on top |
| `vault` | `VaultModal`: list/switch, edit, create, open/relocate, delete. Some keys (`chooseFolder`, `defaultFolder`, `alreadyOpen`, `accessDenied`, `folderHasVault`, `folderNotEmpty`) also serve the backup import's add-vault mode via `VaultLocationRow` and `NEW_VAULT_TARGET_ERROR_KEY` |
| `settings` | Settings modal |
| `vaultKey` | `VaultKeyDialog` and its shared parts: unlock, create, encrypt, recover, the recovery-key box, the "remember on this device" switch and the failure texts (`wrongPassword`, `tooShort` with `{{count}}`, …) |
| `security` | Settings → Security: remember, lock, change password, each with a hint and a tooltip |
| `backupKey` | `BackupUnlockDialog`: opening an encrypted backup |
| `home` | Home view |
| `emptyState` | Per-dashboard empty states (`title`, `description`, `action`) |
| `contextMenu` | Context menu actions, including `openInNewTab` |
| `trash` | Trash view: section labels per kind, `confirmEmptyAction`/`confirmDeleteSelected` (the primary button's own in-place confirmation label) |
| `tabBar` | Tab strip (`editing`, `closeTab`, `newTab`); tab titles fall back to `nav.*` and the modules' `untitled` keys |
| `linkPicker` | Internal link picker modal |
| `importDestination` | Markdown-import destination picker; option labels reuse `linkPicker.tab*` |
| `menu` | Application menu labels, used by both menus: macOS's native menu (labels pushed into Rust via `update_menu_labels`) and the HTML menu bar on Windows/Linux. `rail`/`entryList`/`properties` are the only toggles for the three sidebars. `cut`/`copy`/`paste`/`selectAll` exist only for the HTML menu — on macOS those are `PredefinedMenuItem`s labelled by the OS |
| `leaveGuard` | `LeaveGuardModal`, asked when a page with unsaved edits is left; Save reuses `common.save` |
| `titlebar` | Window buttons (Windows/Linux only), `back`/`forward`, `search` (the search button's accessible name — not `search.placeholder`, which reads poorly as a name) and `menu` (the collapsed-menu button) |

## Interpolation

Some translation values use `react-i18next` interpolation syntax. For example:

```json
"deletedAgo": "Deleted {{time}} ago"
```

Pass variables as the second argument to `t()`:

```tsx
t('trash.deletedAgo', { time: '3 days' })
```

Pluralisation uses the `_other` suffix convention:

```json
"daysLeft": "{{count}} day left",
"daysLeft_other": "{{count}} days left"
```

Pass `count` as the variable and `react-i18next` selects the correct form automatically.
