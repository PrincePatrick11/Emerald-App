# Internationalisation

Emerald supports four languages: English (`en`), German (`de`), Spanish (`es`), and French (`fr`). The active language is selected in the Settings modal and persisted across sessions.

## Setup

Translations are managed with `react-i18next`. The setup lives in `src/i18n/index.ts`, which imports all four locale files and registers them. `AppShell` (or any root component) calls `i18n.changeLanguage(lang)` when the user changes the setting.

Translation files are at:

```
src/i18n/locales/en.json
src/i18n/locales/de.json
src/i18n/locales/es.json
src/i18n/locales/fr.json
```

All four files must have the same key structure. A key missing from a non-English locale will fall back to English silently, which can be hard to notice — always add every key to all four files.

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

Skipping step 3 is the most common mistake. The missing-key fallback to English makes the omission invisible during testing in English.

## Built-in Category Names

Wiki categories and operation categories have a `name` column in the database. For built-in categories, this value is the English seed name written at database creation time. It must never be displayed directly because it does not change with the selected language.

**Wiki categories.** Use the translation key `wiki.categories.{id}`:

```tsx
// correct
const label = cat.is_builtin ? t('wiki.categories.' + cat.id) : cat.name;

// wrong — always shows English
const label = cat.name;
```

Built-in wiki category IDs: `paradigm`, `bannung`, `meditation`, `sigil_charging`, `ritual`, `deity`, `herb`, `symbol`, `tool`, `concept`, `spell`, `other`.

**Operation categories.** Use the translation key `operations.categories.{id}`:

```tsx
const label = cat.is_builtin ? t('operations.categories.' + cat.id) : cat.name;
```

Built-in operation category IDs: `sigils`, `servitors`.

Custom categories (those with UUID IDs and `is_builtin = false`) display `cat.name` directly — they were named by the user and have no translation key.

## Key Structure

The translation files follow this top-level structure (from `en.json`):

| Key | Contents |
|---|---|
| `app` | Application name |
| `common` | Shared labels including `yes`, `no`, `delete`, `deleteConfirm` |
| `listView` | View/sort mode labels for list toolbar |
| `undo` | Undo toast messages |
| `nav` | Sidebar navigation labels |
| `operations` | All operations UI strings, including `categories.sigils` and `categories.servitors` |
| `altar` | All altar UI strings, including `element` (add-item button label), `category` (category field label), `addCategory` (new-category button), `categoryName` (category name input placeholder), `uncategorized` (label for the pseudo-tab that collects items whose category no longer exists), `backgroundOverlay` (section header label for the background overlay slider), background presets under `altar.backgrounds.*` — four colour-gradient preset keys (`midnight`, `ember`, `forest`, `moon`) plus 16 image preset keys (e.g. `bamboo_grove_bench`, `mountain_altar_summit`, `dark_grotto_shrine`, `light_gate_magic`, `marble_temple_arch`, …), inspector labels (`inspectorX`, `inspectorY`, `inspectorScale`, `inspectorRotation`, `inspectorOpacity` — unit annotations are rendered in the UI, not in the key values), grid controls (`rotationSnap`, `rotationSnapAngle`, `snapScaleToGrid`), canvas options controls (`canvasOptions`, `ratio`), lock/show/hide actions, `background` (view-mode section header), and `duplicateElement` (duplicate button tooltip and context menu label) |
| `journal` | Journal UI strings |
| `creation` | Sigil editor strings (shown for sigil operations) |
| `wiki` | Wiki UI strings, including `categories.*` for all built-in wiki category IDs |
| `editor` | Shared editor button labels (Save, Done, Cancel, Edit, Delete) |
| `moonPhase` | Display names for all eight moon phase keys |
| `search` | Search bar placeholders and no-results messages |
| `routines` | Routines panel strings |
| `tags` | Tags view strings |
| `properties` | Right sidebar properties panel strings, including custom property type names |
| `filters` | Filter panel strings |
| `settings` | Settings modal strings |
| `home` | Home view strings |
| `contextMenu` | Context menu action labels, including `openInNewTab` |
| `backlinks` | Backlinks panel strings |
| `trash` | Trash view strings |
| `linkPicker` | Internal link picker modal (title, search placeholder, tab labels, no-results message) |
| `menu` | Native menu item labels (Edit, View, Export, Import submenus and their items) |

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
