# Design

Bestandsaufnahme des aktuellen visuellen Design-Systems von Emerald: Farb-/Typografie-Tokens, tatsächlich verwendete Spacing-/Radius-/Shadow-Werte und die gewachsenen Komponenten-Patterns (Buttons, Panels, Modals, Emoji-Picker, Icons). Dies ist eine reine Ist-Zustand-Dokumentation ohne Priorisierung oder Lösungsvorschläge — sie dient als Referenzgrundlage für einen späteren, separaten Redesign-Durchgang.

Für die *Architektur* des Theming-Systems (CSS-Custom-Property-Tiers, Normalisierungs-Flow, Tailwind-Bridge-Konzept) siehe bereits [`architecture.md`](architecture.md#theming-system) — hier werden stattdessen die konkreten Werte und die Komponenten-Ebene dokumentiert, die dort fehlen.

## Farben

### Tailwind-Tokens (`tailwind.config.js`)

| Skala | 50 | 300 | 500 | 600 | 800 | 950 |
|---|---|---|---|---|---|---|
| `jade` | `#edfff7` | `#70ffca` | `#00e699` (primary bright) | `#00c47f` (buttons/links) | `#007a4d` (borders) | `#002e1d` (darkest) |
| `parchment` | `#fdf8f0` | `#ecc685` | `#d98c34` | `#c97229` | `#874824` | `#3b1d0f` |
| `stone` | Tailwind-Default-Skala, nur `950: #0f0e0c` ist überschrieben | | | | | |

`jade` ist die durchgängig genutzte Akzentfarbe (Buttons, Links, aktive Zustände). `parchment` ist als Tailwind-Skala vorhanden, wird aber im tatsächlichen "Emerald Parchment"-Theme kaum als Utility-Klasse verwendet — das Theme läuft stattdessen über eigene CSS-Variablen (siehe unten), deren Werte nicht auf die `parchment`-Skala mappen.

### CSS-Custom-Properties pro Theme (`src/themes/emerald-noctis.css`, `emerald-parchment.css`)

Beide Dateien definieren dieselben ~55 Properties. Kernwerte im Vergleich:

| Property | Emerald Noctis (dunkel) | Emerald Parchment (hell) |
|---|---|---|
| `--bg-app` | `#15110d` | `#f7efdf` |
| `--text-primary` | `#f5f5f4` | `#2c2014` |
| `--accent` | `#00c47f` | `#008a57` |
| `--accent-strong` | `#00a066` | `#006941` |
| `--focus-ring` | `rgba(0, 196, 127, 0.42)` | `rgba(0, 138, 87, 0.34)` |
| `--danger-text` | `#f87171` | `#b63f32` |
| `--panel-bg` | `rgba(38, 32, 27, 0.78)` | `#f7eddb` |
| `--menu-shadow` | `0 14px 36px rgba(0,0,0,0.35)` | `0 18px 36px rgba(96,63,30,0.2)` |

Beobachtung: Noctis' `--accent: #00c47f` entspricht exakt `jade-600`. Parchments `--accent: #008a57` liegt zwischen keinen zwei `jade`-Stufen und taucht auch sonst nirgends in der Tailwind-Palette auf — die beiden Farbsysteme (Tailwind-Skala vs. Theme-CSS-Vars) sind an dieser Stelle unabhängig voneinander gepflegt.

Zusätzlich überschreibt `src/index.css` (die in `architecture.md` beschriebene "Tailwind bridge") pro Theme nochmals eigene Hex-Werte für Klassen wie `.btn-primary`, `.btn-secondary`, `.panel-interactive`, unabhängig von den obigen CSS-Vars, z. B.:

- `html[data-theme='emerald-noctis'] .btn-primary` → `background: rgba(0,138,87,0.3)`, `border-color: rgba(0,196,127,0.44)`, `color: #dcfff0` (index.css:900-906)
- `html[data-theme='emerald-parchment'] .btn-primary` → `background: #159165`, `border-color: #127651`, `color: #ecfff7` (index.css:1343-1348)

Damit existieren für die "Primärfarbe" faktisch drei unabhängig gepflegte Werte-Sets: die `jade`-Tailwind-Skala, die `--accent`-CSS-Vars, und die Bridge-Overrides in `index.css`.

## Typografie

- UI-Schrift-Stack: `Inter, system-ui, sans-serif` (Tailwind `font-sans`)
- Editor-Schrift-Stack: `Lora, Georgia, serif` (Tailwind `font-serif`)
- Mono-Stack: `JetBrains Mono, monospace` (Tailwind `font-mono`) — deklariert in `tailwind.config.js:46`, aber `JetBrains Mono` wird nirgends per `<link>` geladen (weder in `index.html` noch sonstwo); Code-Stellen mit `font-mono` fallen faktisch auf die System-Monospace-Schrift zurück.
- 8 wählbare Google Fonts (UI/Editor getrennt einstellbar), geladen über einen einzelnen `<link>` in `index.html`: Alegreya, Cormorant Garamond, IBM Plex Sans, Inter, Lora, Merriweather, Nunito, Source Sans 3 (`src/themes/theme.ts:13-22`).
- Defaults: UI = Inter, Editor = Lora (`DEFAULT_UI_FONT_ID`, `DEFAULT_EDITOR_FONT_ID`, `theme.ts:10-11`).
- Anwendung technisch über `data-ui-font`/`data-editor-font`-Attribute auf `<html>`, siehe `architecture.md#font-system` für den vollen Flow.

## Spacing, Radius, Shadows

`tailwind.config.js` definiert keine eigene `spacing`, `borderRadius` oder `boxShadow` Skala — jede Stelle im Code wählt einen Tailwind-Default-Wert frei. Beobachtete tatsächliche Verteilung:

**Border-Radius**, für optisch vergleichbare "Container"-Elemente:
- `rounded-md`: Dropdown-Trigger (`ListToolbar.tsx`), kleine Tab-Buttons (`AltarLibraryStrip.tsx:172`), `.btn-danger` (`index.css`)
- `rounded-lg`: Context-Menu (`ContextMenu.tsx:49`), `.btn-primary`/`.btn-secondary` (`index.css`, jetzt auch der Undo-Button in `UndoToast.tsx` über `<Button variant="primary">`), Settings-Reihen
- `rounded-xl`: `.panel`/`.panel-interactive` (`index.css:96,125`), alle drei Modal-Cards (Settings, LinkPicker, Altar-Item), aber auch der Undo-Toast selbst (`UndoToast.tsx`)
- `rounded-full`: Filter-Chips (`FilterPanel.tsx`)

Es gibt keine erkennbare Regel, wann `md`/`lg`/`xl` verwendet wird — z. B. ist `ContextMenu` (`rounded-lg`) und `UndoToast` (`rounded-xl`) beides ein kleines, schwebendes Overlay-Element mit ähnlicher Funktion, aber unterschiedlichem Radius.

**Shadows**: `shadow-2xl` (ContextMenu, alle Modal-Cards außer Altar-Item-Modal), `shadow-xl` (UndoToast), kein Shadow (Altar-Item-Modal-Card, `AltarLibraryStrip.tsx:196`) — Modals verlassen sich teils auf `shadow-2xl`-Klasse, teils auf die `--panel-shadow`/`--menu-shadow` CSS-Vars, teils auf gar nichts.

**Padding/Spacing**: Toolbar-artige Leisten (`ListToolbar`, `FilterPanel`) nutzen häufig `px-8 py-2`/`px-8 py-3`; Modal-Header/-Bodies nutzen `px-4 py-3`/`px-5 py-4`/`p-4`. Keine dokumentierte oder erzwungene Spacing-Skala.

## Komponenten-Patterns

### Buttons

Geteilte Komponente: `src/components/ui/Button.tsx`. Ein dünner Wrapper mit vier Varianten (`primary` / `secondary` / `ghost` / `danger`), die auf die bestehenden CSS-Klassen `.btn-primary`, `.btn-secondary`, `.btn-ghost` sowie die neue `.btn-danger`-Klasse (`index.css`, basierend auf den bereits themed `--danger-*`-CSS-Variablen — es waren keine Theme-Datei-Änderungen nötig) abbilden. `type` ist standardmäßig `'button'`; `className` wird an die Varianten-Klasse angehängt statt sie zu ersetzen, sodass Aufrufer weiterhin Layout/Spacing pro Stelle mitgeben können. Eine gemeinsame `:disabled`-Regel (`opacity-50 cursor-not-allowed pointer-events-none`) gilt für alle vier Varianten.

Über Journal, Wiki, Operations, Tasks, Altar, Trash, Settings sowie die geteilten `Modal`/`FilterPanel`/`RichEditor`-Komponenten sind 109 vormals rohe `<button>`-Elemente auf `<Button>` migriert. Dabei wurden fünf verschiedene Ad-hoc-Rot-Behandlungen für "löschen" (`text-red-400`, `text-red-600`, `text-stone-500 hover:text-red-400`, bordered `bg-red-950/30`-Pills u. a., verstreut über Trash/Operations/Wiki/Tasks/Altar/Settings) auf `<Button variant="danger">` konsolidiert, und drei vormals inline-duplizierte "primary"-Button-Rezepte (`HomeView`s "New Entry", `UndoToast`s Action-Button, Settings' Export/Import-Buttons) nutzen jetzt `<Button variant="primary">`. Die dadurch toten CSS-Klassen `.trash-empty-btn`, `.trash-bulk-delete-btn` und `.settings-cta-btn` wurden entfernt.

Aktive/inaktive Zustände (z. B. Tab-artige Buttons in `AltarLibraryStrip.tsx:172,174,219`, `SettingsModal.tsx:199-201,261`) werden weiterhin jeweils lokal per Ternary im `className`-Template implementiert — das ist bewusst außerhalb des `Button`-Scopes, da diese Buttons einen `active`-Toggle-State abbilden, den die vier Basis-Varianten nicht kennen. Ebenfalls bewusst nicht migriert: `AltarCanvas.tsx`s Rotations-/Resize-Drag-Handles (dynamisch dimensioniert, keine semantischen Buttons), `EditorToolbar.tsx`s `ToolbarBtn` (hat ebenfalls einen `active`-Toggle-State), sowie `ContextMenu.tsx`-Menüeinträge und andere volle-Breite Menü-/Chip-/Tab-/Nav-Item-Patterns (`LinkedOpsInput`, `LinkedWikiInput`, `BacklinksPanel`, `SuggestionList`, `TagInput`, die frühere WikiPanel-/OperationsPanel-Browse-Tabs) — das sind strukturell andere Komponententypen (Listenzeilen, Chips, Toggles), keine generischen Aktions-Buttons. `AltarReadingSummary`s eigener Fullscreen-Toggle wurde inzwischen ganz entfernt, siehe [Right Sidebar Action Bar](#right-sidebar-action-bar) unten.

### Panels / Cards

`.panel` / `.panel-interactive` (`index.css:95-99,124-131`, plus Theme-Overrides `index.css:633-637,1009-1013`) sind das konsistenteste wiederverwendete Pattern — in `HomeView.tsx` durchgängig für Journal-/Operations-/Wiki-Karten genutzt. Abweichung: Der Altar-Item-Modal-Card-Container (`AltarLibraryStrip.tsx:196`, `rounded-xl border border-stone-700/80 bg-stone-900 p-4`) reimplementiert dieselbe Optik roh statt `.panel` zu verwenden.

### Modals / Dialogs

Geteilter Modal-Wrapper: `src/components/ui/Modal.tsx`. Ein Overlay (`bg-black/50 backdrop-blur-sm`), eine `.modal-card` (`index.css`, theme-var-basiert: `background-color: var(--bg-surface-2)`, `border-color: var(--border-soft)`, `shadow-2xl`, `rounded-xl`) mit Header (Titel + Close-X), `createPortal` nach `document.body`, und Escape-to-close sind damit für alle Modals einheitlich. Genutzt von `SettingsModal`, `LinkPickerModal`, `ImportDestinationModal`, `AltarLibraryStrip` (`ItemModal` und `CategoryModal`), dem Gradient-Hintergrund-Picker in `AltarSidebarPanel`, und `RichEditor`s "nicht unterstütztes Bildformat"-Fehlerdialog beim Drag-Drop (vorher ein roher `fixed inset-0`-Overlay mit hartcodierten `stone-900`/`stone-700`-Farben, die im Emerald-Parchment-Theme nicht themten).

`ImportDestinationModal`s Options-Zeilen nutzen jetzt die geteilte `context-menu-item-default`-Klasse aus `ContextMenu.tsx` statt roher `stone-800`/`stone-700`-Utility-Klassen, und Footer-Border/-Beschreibungstext nutzen `var(--border-soft)`/`var(--text-muted)` statt roher `stone-*`-Farben — damit themt auch dieses Modal jetzt vollständig in Emerald Parchment.

`.modal-card` selbst hat kein `overflow-hidden` in der Basisklasse, da einzelne Modals einen Popover-Inhalt haben, der die Card-Grenzen verlassen muss (z. B. der Altar-Kategorie-Emoji-Picker). `overflow-hidden` wird stattdessen pro Modal per `className`-Prop opt-in gesetzt (`LinkPickerModal`, `ImportDestinationModal`, der Altar-Gradient-Picker).

Verbleibende Abweichung: `LinkPickerModal`s interne Elemente (Suchfeld, Tab-Textfarben) nutzen weiterhin rohe Tailwind-`stone-*`-Utility-Klassen statt Theme-CSS-Variablen — nur der äußere Wrapper (Overlay/Card/Header/Portal) wurde vereinheitlicht, nicht der komplette Innenaufbau jedes Modals.

### Emoji-Picker

Geteilte Komponente: `src/components/ui/EmojiPicker.tsx`. Kapselt Open/Close-State, Klick-außerhalb- und Escape-to-close (vorher bei keiner der Einzelimplementierungen vorhanden) sowie eine themed Popover-Chrome (`.emoji-picker-popover`, `.emoji-picker-item-idle`/`-active` in `index.css`, beide auf `--menu-bg`/`--menu-border`/`--menu-item-hover-bg` basierend). Der Trigger-Button bleibt pro Aufrufer frei gestaltbar (Render-Prop `trigger`), da sich die Trigger-Optik je nach Kontext stark unterscheidet (z. B. großer Bild/Emoji-Button mit Label in `AltarLibraryStrip`s `ItemModal` vs. reiner Emoji-Glyph ohne Hintergrund in den Kategorie-Zeilen von Operations/Tasks/Wiki) — analog zu `Modal.tsx`, das ebenfalls nur die äußere Chrome vereinheitlicht und den Inhalt frei lässt.

Genutzt von `AltarLibraryStrip` (`ItemModal` und `CategoryModal`), `AltarSidebarPanel` (Altar-Favicon/-Emoji in den Altar-Properties), `RoutinesPanel` (Add- und Edit-Formular), `OperationsView`, `TasksView` und `WikiView` (jeweils Add- und Edit-Kategorie) — 11 vormals unabhängige Implementierungen mit rohen `bg-stone-800`/`border-stone-700`-Popovern (die im Emerald-Parchment-Theme falsch bzw. gar nicht themten) sind damit auf eine gemeinsame, theme-korrekte Implementierung reduziert. Einzige Vorlage, die bereits korrekt themte, war `WikiView`s `.wiki-emoji-popover`; deren CSS-Klassen wurden zu den jetzt generischen `.emoji-picker-*`-Klassen verallgemeinert.

Vorher hatte jede Aufrufer-Stelle eine eigene, unterschiedlich kuratierte Emoji-Liste (`ROUTINE_EMOJIS`, `OPERATION_EMOJIS`, `TASK_EMOJIS`, `WIKI_EMOJIS`, `ALTAR_CAT_EMOJIS`, `ALTAR_ICON_EMOJIS`, `CATEGORY_EMOJIS`/`FALLBACK_CATEGORY_EMOJIS` inkl. der kategoriebasierten Mini-Vorschläge im Altar-Item-Picker). Alle wurden entfernt zugunsten einer einzigen `DEFAULT_EMOJI_PICKER_EMOJIS`-Konstante in `EmojiPicker.tsx`, die als Default für den optionalen `emojis`-Prop dient — damit steht in jedem Picker dieselbe Auswahl zur Verfügung.

Das Popover-Grid ist auf **max. 5, min. 3 Spalten** ausgelegt (`COLUMNS`/`MIN_COLUMNS` in `EmojiPicker.tsx`): `width`/`minWidth`/`maxWidth` werden direkt am Grid-Element in Zellen-Einheiten berechnet (`cell * n + gap * (n-1)`), nicht am gepolsterten Popover-Rahmen — eine erste Version rechnete das gegen die Border-Box der äußeren, gepolsterten Box, wodurch für 5 Spalten zu wenig Platz übrig blieb und `auto-fill` auf 4 abrundete. `grid-template-columns: repeat(COLUMNS, minmax(0, 1fr))` erzwingt seitdem die konfigurierte Spaltenzahl exakt, statt sie wie zuvor über `auto-fill` aus der verfügbaren Breite abzuleiten — das bleibt auch bei der unten beschriebenen, absichtlich reduzierten Grid-Breite stabil bei 5 Spalten. Bei zu wenig Viewport-Breite (`maxWidth: calc(100vw - 3rem)`) schrumpft das Raster bis auf 3 Spalten (harte Untergrenze über `minWidth`, kann bei extrem schmalem Fenster leicht über den Viewport hinausragen).

Scroll-Clipping sitzt auf einem eigenen Wrapper um das Grid herum (`max-h-56 overflow-y-auto overflow-x-hidden`), nicht direkt auf dem Grid. Da die globale Scrollbar-Regel (`::-webkit-scrollbar` in `index.css`, 6 px) plattformübergreifend einen klassischen, platzraubenden statt einen überlagernden Scrollbalken erzeugt, lief ein gleich breites Grid auf macOS über den Wrapper hinaus und erzeugte einen sichtbaren horizontalen Scrollbalken; `overflow-x-hidden` unterdrückt dieses Artefakt. Damit der vertikale Scrollbalken dabei nicht stattdessen die letzte Emoji-Spalte überlappt, ist das Grid über ein eigenes `gridStyle`-Objekt (getrennt von `sizeStyle`, das weiterhin Suchfeld- und Popover-Breite bestimmt) um eine feste `SCROLLBAR_GUTTER` (`0.5rem`) schmaler als der Scroll-Wrapper — der Scrollbalken hat dadurch Platz in der Lücke rechts vom Grid.

**Suche**: Ein fixes Suchfeld (`.emoji-picker-search`, themed wie `.wiki-cat-input`) sitzt oben im Popover und scrollt nicht mit. Leer zeigt der Picker weiterhin `DEFAULT_EMOJI_PICKER_EMOJIS`; sobald getippt wird, durchsucht er stattdessen ein vollständiges, lokalisiertes Emoji-Set aus `src/lib/emojiSearchData/{en,de,es,fr}.json` (je `[emoji, suchtext]`-Paare, aus `emojibase-data@17` generiert — Skins/reine Flaggen-Bausteine ausgeschlossen, ca. 1900 Einträge/Sprache), nicht nur die kuratierte Kurzliste. Das passende Locale-File wird anhand von `i18n.language` gewählt (Fallback `en`) und per dynamischem `import()` erst beim ersten Öffnen eines Pickers nachgeladen (Vite code-splittet das automatisch in einen eigenen Chunk pro Sprache, ~100–150 KB, mit Modul-Level-Cache gegen Mehrfach-Laden). Treffer sind auf 150 begrenzt (`MAX_SEARCH_RESULTS`), ein leeres Ergebnis zeigt `common.noEmojiResults` statt eines leeren Rasters.

Das Suchfeld bekommt bewusst dieselbe explizite `width`/`minWidth`/`maxWidth` (`sizeStyle`-Objekt) wie das Grid statt einer prozentualen `w-full`-Breite: `AltarSidebarPanel`s Favicon-Picker sitzt (anders als die übrigen 10 Aufrufer, die alle in einer Flex-Zeile stecken) in einem normalen Block-`<div>`, dessen Wrapper dadurch auf 100 % Elternbreite aufgeht statt sich auf die Trigger-Größe zu schrumpfen — eine `w-full`-Suchleiste hätte sich dort gegen diese (deutlich breitere) Wrapper-Breite aufgeblasen und rechts neben dem schmaleren, fix breiten Grid sichtbaren Leerraum hinterlassen. Mit identischer expliziter Breite für Input und Grid kann das unabhängig vom umgebenden Layout des jeweiligen Aufrufers nicht mehr auseinanderlaufen.

Verbleibende Abweichung: die "Keine Treffer"-Meldung bei leerer Suche (`EmojiPicker.tsx:151`) nutzt rohes `text-stone-500` statt einer Theme-CSS-Variable wie `--text-muted` — der einzige Rest an unthemtem Text innerhalb einer ansonsten komplett auf CSS-Vars umgestellten Komponente.

### Dashboard (Modul-Übersichtsscreens)

Geteilte Komponente: `src/components/ui/Dashboard.tsx` (generisch über `<T>`). Vereinheitlicht nur die äußere Chrome der sechs Modul-Übersichtsscreens (Wiki, Operations, Journal, Altar, Tasks, Trash) — Topbar, `ListToolbar`/`FilterPanel`-Einbindung, sowie Leerzustands-/No-Results-/Gruppierungs-Orchestrierung — analog zum `Modal`/`EmojiPicker`-Prinzip: nur die Chrome ist geteilt, der eigentliche Item-Inhalt bleibt pro Aufrufer lokal (`renderItem`-Prop).

**Topbar**: Standardmäßig `title` + optionale `primaryAction` (Button + Plus-Icon) rechts. Beide Seiten sind per `headerLeft`/`headerRight` vollständig ersetzbar, wenn eine Ansicht keine primäre Aktion, sondern z. B. Bulk-Select-Controls braucht (Trash: Select-all-Link links, Bulk-Delete/Empty-Trash-Buttons rechts). `headerClassName` ist ebenfalls überschreibbar (Trash nutzt `px-6` statt der Default-`px-8`, aus historischen Gründen enger als die übrigen Dashboards).

**Gruppierung** (`grouping`-Prop, vier Modi):
- `flat` — ungruppierte Liste (Altar).
- `timeline` — Divider-Gruppen mit `label` + `items`, kein editierbarer Header (Journal: sowohl der Datums-Timeline- als auch der "nach Mondphase gruppiert"-Fall laufen über diesen Modus, da beide dieselbe Divider-Optik brauchen; Altar für seine Datumsgruppen).
- `category` — wie `timeline`, aber mit `renderGroupHeader`/`renderAddCategory`-Render-Props für editierbare Kategorie-Header inkl. Inline-CRUD (Wiki, Operations — Operations ergänzt zusätzlich einen "Other"-Uncategorized-Bucket als weitere Gruppe).
- `custom` — Escape-Hatch: Aufrufer liefert eine `render()`-Funktion und ist für den kompletten Inhaltsbereich selbst verantwortlich. Genutzt von Tasks (hierarchische Task/Subtask-Struktur, Kategorie-Collapse-Zustand, Uncategorized-zuerst-Reihenfolge) und Trash (zweistufige Typ→Kategorie-Gruppierung) — beide Strukturen sind nicht generisch abbildbar. `DashboardProps<T>` ist als discriminated Union über `grouping.mode` typisiert: `renderItem`/`isEmpty`/`emptyState`/`hasNoResults` sind nur bei `flat`/`timeline`/`category` erforderlich und bei `custom` typseitig ausgeschlossen (`grouping.mode === 'custom'` wird in `renderContent()` als erste Prüfung behandelt) — Tasks und Trash müssen dadurch keine bedeutungslosen Dummy-Props (`renderItem={() => null}`, `isEmpty={false}` usw.) mehr an `Dashboard` übergeben, nur um in den `custom`-Modus zu wechseln.

**Filter**: `filters`-Prop ist optional (Views ohne Filterkonzept, z. B. Altar, lassen sie weg). Sie kapselt `showFilters`/`onToggleFilters`/`activeFilterCount` sowie `panelProps` (an `FilterPanel` durchgereicht — dessen `FilterPanelProps`-Interface wurde dafür aus `FilterPanel.tsx` exportiert) und ein optionales `extraPanelContent` für zusätzliche Filterzeilen unterhalb des `FilterPanel` (Tasks' Prioritäts-Chip-Zeile). `toolbarExtraActions` reicht zusätzliche Controls direkt in die `ListToolbar` durch (Tasks' "Show completed"-Toggle).

Diese Vereinheitlichung ist rein strukturell — das visuelle Ergebnis ist unverändert zum vorherigen Zustand jedes Dashboards. Ein separates visuelles Redesign der Dashboards ist als nächster Schritt geplant, aber noch nicht begonnen.

### Left Sidebar: Rail + Entry-List

Die linke Sidebar besteht aus zwei nebeneinander liegenden Komponenten: `LeftSidebarRail.tsx` (feste 56px-Icon-Leiste) und `LeftSidebarEntryList.tsx` (daneben liegendes, größenverstellbares Panel). Zwei neue geteilte Button-Komponenten kapseln die jeweiligen Zustände:

- `RailButton.tsx` — dünner Wrapper um die bestehende `.btn-ghost`-Klasse, für alle Icon-Buttons der Rail (Verlauf, Suche, Listen-Toggle, Modul-Icons, Tags/Trash/Settings).
- `TabIconButton.tsx` — Active/Idle-Toggle für die fünf Tab-Icons im Entry-List-Panel. Nutzt dafür die bereits bestehenden `.right-sidebar-tab-active`/`.right-sidebar-tab-idle`-CSS-Klassen (ursprünglich für die rechte Sidebar benannt) statt eigener Klassen — funktional identisch, aber der Klassenname passt jetzt nicht mehr zur tatsächlichen Verwendung auf beiden Seiten der App. Die themafähigen Farbregeln für diese Klassen in `index.css` waren zunächst per `.app-sidebar-right`-Präfix auf die rechte Sidebar gescoped; die Hover-Regel für inaktive Tabs (`.text-stone-500.hover\:text-stone-300:hover`) ist in beiden Themes jetzt zusätzlich auf `.app-sidebar-left` gescoped, sodass linke und rechte Tab-Icons denselben Hover-Farbwert treffen, statt dass die linke Seite auf ungestyltes Tailwind-Grau zurückfällt.

Neue CSS-Klassen in `index.css`: `.left-sidebar-rail` (eigener Hintergrund `--shell-bg`, hebt die Rail farblich vom Entry-List-Panel ab, das weiterhin `--sidebar-bg` nutzt) und `.rail-divider` (themafähige Trennlinien innerhalb der Rail, mit denselben Border-Farbwerten wie `.sidebar-header`/`.sidebar-search` in beiden Themes).

Die Listenzeilen selbst (Suche, Leerzustand, Inline-Rename, Drag-Start, Kontextmenü) sind in `EntryListTab.tsx` zentralisiert — analog zu `Dashboard.tsx`, das nur die äußere Chrome vereinheitlicht: Journal/Operations/Wiki/Altar reichen Accessor-Funktionen (`getIcon`/`getTitle`/`getDateStr`) durch, Tasks steigt über die `renderRow`-Render-Prop aus (eigene Checkbox-Zeile statt Icon-Zeile).

### Right Sidebar Action Bar

`RightSidebarActionBar` (in `RightSidebar.tsx`) ersetzt die früheren, pro Entry-View dupliziert implementierten Edit-/Save-/Cancel-/Delete-Buttons in den Content-Headern durch eine einzelne, über der scrollbaren Properties-Fläche fixierte Leiste (`px-3 h-14 border-b`, bewusst identisch zur Tab-Leiste in `LeftSidebarEntryList`, damit beide Sidebars ihre untere Trennlinie auf derselben Höhe haben — siehe Kommentar `ACTION_BAR_CLASSES` in `RightSidebar.tsx`).

Geteilte Komponente: `src/components/sidebar/fields/SidebarActionButton.tsx`. 30px hoch, um exakt auf `TabIconButton` (die Tab-Icons im linken Entry-List-Panel) zu treffen. Eine primäre Aktion (`compact` nicht gesetzt) füllt die verbleibende Breite mit Icon + Label; sekundäre Aktionen (`compact`) sind 30×30px reine Icon-Quadrate. Vier Tonvarianten, alle nach demselben "gedämpfte Fläche + passende Border, heller bei Hover"-Rezept, das ursprünglich am Altar-Fullscreen-Button entstand:

- `jade` — primäre/positive Aktion (Done, Fullscreen-Toggle im aktiven Zustand)
- `amber` — Edit
- `danger` — Delete
- `neutral` — Cancel

Emerald Parchment hat für die `amber`-Töne (nur für Edit genutzt) eigene Overrides in `index.css` auf den zugrunde liegenden Tailwind-Utility-Klassen (`.bg-amber-900\/30`, `.hover\:bg-amber-900\/50`, `.border-amber-700\/60`, `.hover\:border-amber-500\/70`). Die anderen drei Töne erben ihre Idle-Optik aus bereits bestehenden Parchment-Overrides, hatten aber zwei Hover-Lücken: Parchments Idle-Regeln `.bg-red-950\/30` und `.text-stone-400` liegen bei Spezifität (0,2,1) und überstimmen damit Tailwinds unpräfixierte `hover:`-Varianten bei (0,2,0) — Delete bekam keine Hover-Fläche, Cancel keine Hover-Textfarbe. Gefixt über zwei auf `.sidebar-action-btn` gescopte Regeln, damit andere Nutzer derselben Utilities unberührt bleiben. Hover-Regeln, die selbst eine themenspezifische Entsprechung haben, landen bei (0,3,1) und gewinnen ohnehin.

**Bewusste Abweichung vom `Button`-Pattern.** `SidebarActionButton` bildet nicht auf `.btn-*` ab, sondern bringt eine eigene Tonwert-Tabelle mit — inklusive `bg-red-950/30` für `danger`, also ausgerechnet einem der fünf Ad-hoc-Rot-Rezepte, die oben unter [Buttons](#buttons) als auf `variant="danger"` konsolidiert verzeichnet sind. Grund: die vier Basis-Varianten kennen weder den gefüllt-getönten Altar-Fullscreen-Look, der hier gewünscht war, noch einen `active`-Toggle-State (den der Fullscreen-Button braucht) — dieselbe Begründung, aus der schon die Tab-artigen Buttons in `AltarLibraryStrip`/`SettingsModal` außerhalb des `Button`-Scopes liegen. Der Preis ist eine fünfte unabhängige Button-Implementierung; wer `.btn-danger` umfärbt, muss `SidebarActionButton` mit anfassen.

**Neuer Akzentton.** `amber` ist die erste Farbe außerhalb der dokumentierten Einzel-Akzent-Regel (jade) und stammt aus Tailwinds Default-Palette, nicht aus der `parchment`-Skala in `tailwind.config.js` und nicht aus einer `--accent-*`-CSS-Variablen. Damit hat der Warmton keine Theme-Datei-Entsprechung und existiert nur als Utility-Klassen plus Parchment-Bridge in `index.css`.

Der Inhalt der Leiste hängt vom `activeView.mode` ab: im Edit-Modus Done (primär) + Delete (falls vorhanden) + Cancel; im View-Modus nur Edit (primär), bei Altar zusätzlich ein Fullscreen-Toggle. Bei einer geladenen Sigil-Operation zeigt die Leiste nichts an, da geladene Sigile nicht editierbar sind (`OperationSigilView`s bestehende Regel). Altar hat dadurch erstmals eine Delete-Aktion in der Sidebar bekommen, die vorher fehlte.

### Icons (lucide-react)

Keine dokumentierte Größen-Skala. `size`-Props reichen von 10–18px und variieren teils innerhalb derselben Datei zwischen visuell gleichrangigen Elementen, z. B. `SettingsModal.tsx`: Header-Close-Icon `size={16}` (Zeile 179), Sektions-Icons überwiegend `size={13}`/`size={14}` (Zeilen 189, 205, 214, 229, 248, 276, 349, 363, 366) ohne erkennbares Muster, welches Icon welche Größe bekommt. Farbe wird konsistent über die umgebende `text-stone-*`/`text-jade-*`/Theme-Var-Klasse vererbt, nicht per `color`-Prop.

## Beobachtete Inkonsistenzen

Sachliche Zusammenfassung der oben belegten Abweichungen, ohne Priorisierung:

1. **Primärfarbe an drei Stellen unabhängig gepflegt**: `jade`-Tailwind-Skala, `--accent`-CSS-Vars pro Theme, und Bridge-Overrides in `index.css` (z. B. `index.css:900-906`, `1343-1348`) — alle drei können bei einer Farbänderung auseinanderlaufen.
2. **`parchment`-Tailwind-Skala ungenutzt**: Definiert in `tailwind.config.js:29-41`, aber das Parchment-Theme verwendet eigene CSS-Var-Werte, die nicht auf diese Skala mappen.
3. **Border-Radius ohne erkennbare Regel** zwischen `rounded-md`/`lg`/`xl` für konzeptionell ähnliche Container (z. B. `ContextMenu` vs. `UndoToast`).
4. **Icon-Größen rein ad-hoc** (10–18px), keine Skala, teils uneinheitlich innerhalb derselben Datei.
5. **`JetBrains Mono` totes Config**: in `tailwind.config.js:46` deklariert, aber nirgends per Font-Link geladen.
6. **`SidebarActionButton` als fünfte Button-Implementierung**: bewusst am `Button`-Wrapper vorbei, mit eigener Tonwert-Tabelle und einem wiederbelebten `bg-red-950/30`-Danger-Rezept. Begründung und Konsequenz unter [Right Sidebar Action Bar](#right-sidebar-action-bar).
7. **`amber` als zweiter Akzentton neben `jade`**: aus Tailwinds Default-Palette, ohne Entsprechung in den Theme-CSS-Variablen oder der `parchment`-Skala — verschärft Punkt 1 und 2.
8. **Aktionen nur über eine einklappbare Fläche erreichbar**: Edit/Done/Delete/Cancel leben ausschließlich in der rechten Sidebar. Wer sie mitten im Edit-Modus zuklappt, hat keinen sichtbaren Weg zurück; ein Tastatur-Fallback existiert nicht. Beim *Wechsel* in den Edit-Modus wird die Leiste automatisch aufgeklappt (`usesEditorSidebar` in `uiStore.ts`), das deckt den Einstieg ab, nicht das nachträgliche Zuklappen.
9. **Kein sichtbarer Fokus-Ring in Emerald Noctis**: `button:focus-visible` ist in `index.css` nur für `emerald-parchment` definiert. Betrifft die ganze App, fällt aber bei der Action Bar am stärksten auf, seit sie die einzige Heimat der Entry-Aktionen ist.

(Ehemaliger Punkt "drei unabhängige Modal-Implementierungen" ist behoben — siehe [Modals / Dialogs](#modals--dialogs) oben.)
(Ehemaliger Punkt "kein geteiltes Button-Component" ist behoben — siehe [Buttons](#buttons) oben.)
