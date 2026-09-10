# Internationalisation

Emerald supports four languages: English (`en`), German (`de`), Spanish (`es`), and French (`fr`). The active language is selected in the Settings modal and persisted in `localStorage` (`app-language`); `main.tsx` re-activates it before the first render.

## Setup

Translations are managed with `react-i18next`. The setup lives in `src/i18n/index.ts`. Only `en` — the startup and fallback language — is imported statically; `de`/`es`/`fr` are loaded on demand as their own chunks, following the same pattern as the emoji search data. **Always switch languages through `changeAppLanguage(lang)`** (exported from `src/i18n/index.ts`), which loads the bundle before calling `i18n.changeLanguage`, persists the choice, and lets the last of two racing switches win — a direct `i18n.changeLanguage` call would switch to a not-yet-registered locale and render the English fallback. `settings/GeneralPage.tsx` and the startup path in `main.tsx` are the two callers. Stores without hook access (the duplicate actions' `common.copySuffix`) read translations through the default `i18n` export instead.

Translation files are at:

```
src/i18n/locales/en.json
src/i18n/locales/de.json
src/i18n/locales/es.json
src/i18n/locales/fr.json
```

All four files must have the same key structure. A key missing from a non-English locale will fall back to English silently, which can be hard to notice — always add every key to all four files.

`npm run check:i18n` (`scripts/i18n-check.mjs`, run in CI alongside the schema check) verifies this automatically: it flattens all four files to `a.b.c`-style paths and fails if any language is missing a key English has, has a key English doesn't, or a value's `{{placeholder}}`s don't match English's for the same key. It deliberately does not detect dead keys — dynamic key lookups like `t(`${module}.categories.${id}`)` would make a static search too noisy to trust.

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

Since v38, Wiki, Operations, Tasks, and Altar items share one `categories` table (see [`database.md`](database.md#categories)). Only two rows are true built-ins, `is_builtin = 1`: `other` (the fallback) and `sigils` (what the sigil editor keys on). Their `name` column holds a fixed English seed value that must never be displayed directly — the display name always goes through the single shared helper instead:

```tsx
// correct — the one rule for all four modules
import { categoryLabel } from '../lib/categories';
const label = categoryLabel(t, cat);

// wrong — always shows English for a builtin
const label = cat.name;
```

`categoryLabel` resolves a builtin via `categories.builtin.<id>` (so just `categories.builtin.other` / `categories.builtin.sigils`) and returns `cat.name` unchanged for everything else — including a fresh vault's eight starter categories (`categories.starter.<key>`, used only once, to *name* them at creation time; from then on they are ordinary rows a user can rename or delete like any other).

Before v38, each of Wiki, Operations, and Tasks had its own set of built-in categories under a module-scoped key (`wiki.categories.{id}`, `operations.categories.{id}`; Altar's built-ins carried no `is_builtin` flag at all and were matched by seed name instead). Those keys — `wiki.categories.*` (built-in Wiki category IDs: `paradigm`, `bannung`, `meditation`, `sigil_charging`, `ritual`, `deity`, `herb`, `symbol`, `tool`, `concept`, `spell`, `other`), `operations.categories.*` (`sigils`, `servitors`), and `altar.categories.*` — are **still present in all four locale files**, deliberately: migrations v36–v38 and the importer for `.emerald`/backup files written before v38 still resolve an old builtin id or name through them. Nothing in the live UI reads them any more; do not remove them, and do not add new keys there.

## Key Structure

The translation files follow this top-level structure (from `en.json`):

| Key | Contents |
|---|---|
| `app` | Application name |
| `common` | Shared labels including `delete`, `deleteConfirm`, `confirmSure`/`confirmYes`/`confirmNo` (the shared inline delete-confirmation triple — "Sure? Yes/No" — used by Trash, Tags, and the Altar library; moved here from `trash.sure`/`confirmYes`/`confirmNo`, which were the same three strings under a module-specific name), `loading` (moved from `trash.loading`, same reasoning), `unsupportedImageFormat`, `searchEmoji` (placeholder for the shared `EmojiPicker` search field), `noEmojiResults` (shown when an emoji search yields no matches), `ok` |
| `categories` | The one category block for Wiki/Operations/Tasks/Altar since v38: `add` (the Categories view's add button), `name` (name-input placeholder), `uncategorized`, `nameTaken` (duplicate-name error), `dragHint` (the reorder hint above the list) and `builtinHint` (why a built-in row has no rename/delete, shown as its tooltip) — the last two belong to the Categories view, the one place categories are managed —, `builtin.other` / `builtin.sigils` (the two true built-ins' display names), `starter.*` (the eight starter-category names, used once to name them at fresh-vault creation — see [Built-in Category Names](#built-in-category-names)). Replaces what used to be four near-identical `addCategory`/`categoryName`/`uncategorized` triples scattered across `wiki`, `operations`, `altar`, and `tasks` |
| `listView` | View/sort/grouping mode labels for the list toolbar, including `cardsWide` (the full-width card layout), `grouping`/`ungrouped` (the grouping axis, independent of sort), and `type` (Trash's own word for what it groups by) |
| `undo` | Undo toast messages |
| `nav` | Sidebar navigation labels, including `home` (the rail's Home button, above Journal), `categories` (the rail button and title of the category-management view), `all` (the entry-list's "All" tab), and `vaults` (the rail button that opens `VaultModal`). A rail entry needs its `nav.<id>` key in all four locales, since `ModuleMeta`/`AUX_VIEWS` resolve the label dynamically |
| `sidebar` | Left sidebar rail strings: `allEmpty` (empty-state message for the entry-list's "All" tab). The rail itself carries no toggle buttons — `collapseList`/`expandList`/`collapseProperties`/`expandProperties` were removed along with them; both sidebars toggle only through `menu.entryList`/`menu.properties` now |
| `operations` | All operations UI strings. `categories.sigils`/`categories.servitors` are legacy-only now (see [Built-in Category Names](#built-in-category-names)); the live "Sigils"/"Other" labels come from `categories.builtin.*` |
| `altar` | All altar UI strings, including `addElement` (add-element button label), `element` (singular noun, used standalone elsewhere), `elementName` (the library item's name-input placeholder), `noElements` (empty-state message), `elementsPlaced` (placed-element count) — the module's item/element wording is "element" throughout now, formerly a mix of "item" and "element" (`addItem`/`itemName`/`noItems`/`itemsPlaced` were the old key names) — `backgroundOverlay` (opacity slider label inside the Overlay Options box), `overlayOptions` (collapsible section header, formerly "Background Overlay"), `overlay.dark` / `overlay.light` (labels for the overlay color toggle buttons), reading summary labels (`summary`, `summaryRatio`, `summaryBackground`, `summaryOverlay`, `summaryGrid`, `summaryElements`, `summaryActive`, `summaryInactive`, `summaryEditToChange`), background presets under `altar.backgrounds.*` — four colour-gradient preset keys (`midnight`, `ember`, `forest`, `moon`) plus 16 image preset keys (e.g. `bamboo_grove_bench`, `mountain_altar_summit`, `dark_grotto_shrine`, `light_gate_magic`, `marble_temple_arch`, …), inspector labels (`inspectorX`, `inspectorY`, `inspectorScale`, `inspectorRotation`, `inspectorOpacity` — unit annotations are rendered in the UI, not in the key values), grid controls (`rotationSnap`, `rotationSnapAngle`, `snapScaleToGrid`, `gridToggleGrid` / `gridToggleSnap` / `gridToggleRotate` / `gridToggleScale` — the short labels under the four grid-toggle buttons, distinct from the longer `title` tooltips `gridOverlay` / `snapToGrid` / `rotationSnap` / `snapScaleToGrid` on the same buttons), favicon section strings (`favicon` section header, `uploadImage`, `chooseEmoji` — reused for both the with-icon and no-icon states of the shared `Favicon` field rather than duplicating it; the change/remove/add actions themselves are the shared `wiki.changeIcon`/`removeIcon`/`addIcon` keys below, since `Favicon` is used by Wiki and Operations too), canvas options controls (`canvasOptions`, `ratio`), lock/show/hide actions, `background` (view-mode section header), `duplicateElement` (duplicate button tooltip and context menu label), `removeElement` (remove button tooltip and context menu label — replaces the previously hardcoded "Remove" string in `PlacedElementRow`), `sectionTitle` (the dashboard's collapsible "Altars" heading above the altar list, mirroring `libraryTitle`'s own below it), and `showPreview` (the filter panel's canvas-preview toggle chip). Its own `category`/`addCategory`/`categoryName`/`uncategorized` keys moved to the shared `categories.*` block above; `categories.*` under `altar` (the eight old built-in Altar category IDs) is legacy-only, see [Built-in Category Names](#built-in-category-names) |
| `tasks` | Tasks module UI strings. `newCategory`, `filter.category`, `uncategorized`, and `categoryName` moved to the shared `categories.*` block above |
| `journal` | Journal UI strings |
| `wiki` | Wiki UI strings. `categories.*` (the twelve old built-in Wiki category IDs) is legacy-only now, see [Built-in Category Names](#built-in-category-names); its own `addCategory`/`categoryName`/`uncategorized` keys moved to the shared `categories.*` block above |
| `editor` | Shared editor button labels (Done, Cancel, Confirm, Edit, Delete), the link-popup actions (`editLink`, `removeLink`), and `editor.toolbar.*` — every tooltip of the formatting toolbar |
| `moonPhase` | Display names for all eight moon phase keys |
| `search` | Search bar placeholders and no-results messages, including the title bar's global search: `globalPlaceholder` (input placeholder), `hint` (shown before anything is typed), `clear` (accessible name for the clear button), `altarElements` / `categories` (module labels for the two result kinds with no entry in `nav.*`), `showMore` / `showMore_other` (label of the "show more results" button, phrased as an action since clicking it — or pressing Arrow Down on the last visible result — reveals the next page rather than just stating a count). The dropdown's other module labels, including the module shown on a category result (`Category · Wiki`), reuse the existing `nav.*` keys rather than duplicating them |
| `routines` | Routines panel strings |
| `tags` | Tags view strings |
| `properties` | Right sidebar Properties panel strings |
| `filters` | Filter panel strings |
| `vault` | The full `VaultModal` string set — list/switch (`title`, `hint`, `switch`, `switching`, `alreadyOpen`), edit (`edit`, `save`, `icon`, `resetIcon`, `namePlaceholder`), create (`add`, `create`, `chooseFolder`, `defaultFolder`, `folderNotEmpty`), open/relocate (`open`, `openDbFile`, `dbFileFilter` — the file-picker's file-type filter label, `relocate`, `missing`, `accessDenied`, `folderHasVault`, `folderHasNoVault`), and delete (`delete`, `deleteHint`, `deleteFiles`, `deleteFilesWarning`, `deleteFilesLeftover`, `deleteActiveHint`, `deleteLastHint`), plus `cancel`, `switchFailed`, `saveFailed`. Moved out of `settings.vault*` when vault management moved into its own modal. `chooseFolder`, `defaultFolder`, `alreadyOpen`, `accessDenied`, `folderHasVault` and `folderNotEmpty` also serve the settings backup import's add-vault mode, via the shared `VaultLocationRow` and `NEW_VAULT_TARGET_ERROR_KEY` |
| `settings` | Settings modal strings |
| `home` | Home view strings |
| `contextMenu` | Context menu action labels, including `openInNewTab` |
| `backlinks` | Backlinks panel strings |
| `trash` | Trash view strings, including `categories` (the trash's own "Categories" section label). Its former `sure`/`confirmYes`/`confirmNo`/`loading` keys moved to `common.*` (see above), since Tags and the Altar library shared the exact same three-string confirmation under this module's name |
| `tabBar` | Tab strip strings (`editing`, `closeTab`, `newTab`); the tab titles themselves fall back to `nav.*` and the modules' `untitled` keys |
| `linkPicker` | Internal link picker modal (title, search placeholder, tab labels, no-results message) |
| `importDestination` | Markdown-import destination-picker modal (`title`, `description` — interpolates `{{title}}`, `cancel`); reuses `linkPicker.tabJournal` / `tabWiki` / `tabOperations` for the option labels rather than duplicating them |
| `menu` | Application menu item labels (Edit, View, Export, Import submenus and their items), including the nested `exportAltarImage` submenu (`exportAltarJpeg`, `exportAltarPng`, `exportAltarWebp`), the View menu's two check items `entryList` / `properties` (toggle the left entry list / right Properties sidebar — named after what each sidebar holds; this menu is the only place either is toggled, there being no rail button for it any more), and `showSplash` (the View menu's "Show Loading Screen" item, which replays the startup loading screen). Used by both menus: the native macOS menu, whose labels are pushed into Rust via `update_menu_labels`, and the HTML menu bar on Windows/Linux, which reads them through `useTranslation` like any other component. `cut` / `copy` / `paste` / `selectAll` exist only for the HTML menu — on macOS those items are `PredefinedMenuItem`s and the OS supplies its own localised labels |
| `titlebar` | Window title bar strings: `minimize` / `maximize` / `restore` / `close` (window-button titles and accessible names, Windows and Linux only), `back` / `forward` (navigation-history button titles, moved here from `sidebar` when those buttons left the rail), `search` (accessible name for the search button — deliberately not `search.placeholder`, which is placeholder text and reads poorly as a button's name), `menu` (tooltip and `aria-label` for the collapsed-menu button shown when the window is too narrow to display the four menus separately) |

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
