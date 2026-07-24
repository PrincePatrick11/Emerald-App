# Design

Bestandsaufnahme des aktuellen visuellen Design-Systems von Emerald: Farb-/Typografie-Tokens, tatsächlich verwendete Spacing-/Radius-/Shadow-Werte und die gewachsenen Komponenten-Patterns (Buttons, Panels, Modals, Icons). Dies ist eine reine Ist-Zustand-Dokumentation ohne Priorisierung oder Lösungsvorschläge — sie dient als Referenzgrundlage für einen späteren, separaten Redesign-Durchgang.

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
- `rounded-md`: Dropdown-Trigger (`ListToolbar.tsx`), kleine Tab-Buttons (`AltarLibraryStrip.tsx:172`), Undo-Button in `UndoToast.tsx:25`
- `rounded-lg`: Context-Menu (`ContextMenu.tsx:49`), die meisten Buttons (`.btn-primary`, `.btn-secondary`, `index.css:106,111`), Settings-Reihen
- `rounded-xl`: `.panel`/`.panel-interactive` (`index.css:96,125`), alle drei Modal-Cards (Settings, LinkPicker, Altar-Item), aber auch der Undo-Toast (`UndoToast.tsx:21`)
- `rounded-full`: Filter-Chips (`FilterPanel.tsx`)

Es gibt keine erkennbare Regel, wann `md`/`lg`/`xl` verwendet wird — z. B. ist `ContextMenu` (`rounded-lg`) und `UndoToast` (`rounded-xl`) beides ein kleines, schwebendes Overlay-Element mit ähnlicher Funktion, aber unterschiedlichem Radius.

**Shadows**: `shadow-2xl` (ContextMenu, alle Modal-Cards außer Altar-Item-Modal), `shadow-xl` (UndoToast), kein Shadow (Altar-Item-Modal-Card, `AltarLibraryStrip.tsx:196`) — Modals verlassen sich teils auf `shadow-2xl`-Klasse, teils auf die `--panel-shadow`/`--menu-shadow` CSS-Vars, teils auf gar nichts.

**Padding/Spacing**: Toolbar-artige Leisten (`ListToolbar`, `FilterPanel`) nutzen häufig `px-8 py-2`/`px-8 py-3`; Modal-Header/-Bodies nutzen `px-4 py-3`/`px-5 py-4`/`p-4`. Keine dokumentierte oder erzwungene Spacing-Skala.

## Komponenten-Patterns

### Buttons

Kein geteiltes `<Button>`-Component. Drei CSS-Utility-Klassen existieren in `index.css` (`.btn-primary`, `.btn-secondary`, `.btn-ghost`), werden aber nicht durchgängig verwendet:

- `HomeView.tsx:239-243` ("Neuer Eintrag"-Button) dupliziert die `.btn-primary`-Optik komplett inline (`bg-jade-900/40 hover:bg-jade-900/60 text-jade-400 text-sm font-medium rounded-lg border border-jade-800/40`) statt die Klasse `.btn-primary` zu nutzen.
- `SettingsModal.tsx:447` nutzt eine eigene Klasse `.settings-cta-btn` gemischt mit rohen Tailwind-Utilities (`bg-jade-500/20 border-jade-500/40`), ein drittes visuelles Muster für einen inhaltlich ähnlichen "primären" Button.
- `UndoToast.tsx:25` repliziert wiederum eine eigene Variante (`bg-jade-900/40 ... rounded-md`, mit `rounded-md` statt dem sonst für Primary-Buttons üblichen `rounded-lg`).

Aktive/inaktive Zustände (z. B. Tab-artige Buttons in `AltarLibraryStrip.tsx:172,174,219`, `SettingsModal.tsx:199-201,261`) werden jeweils lokal per Ternary im `className`-Template neu implementiert statt über eine gemeinsame Komponente/Klasse.

### Panels / Cards

`.panel` / `.panel-interactive` (`index.css:95-99,124-131`, plus Theme-Overrides `index.css:633-637,1009-1013`) sind das konsistenteste wiederverwendete Pattern — in `HomeView.tsx` durchgängig für Journal-/Operations-/Wiki-Karten genutzt. Abweichung: Der Altar-Item-Modal-Card-Container (`AltarLibraryStrip.tsx:196`, `rounded-xl border border-stone-700/80 bg-stone-900 p-4`) reimplementiert dieselbe Optik roh statt `.panel` zu verwenden.

### Modals / Dialogs

Kein geteilter Modal-Wrapper — drei unabhängige Implementierungen:

| | Overlay | Backdrop-Blur | Card | Portal |
|---|---|---|---|---|
| `SettingsModal.tsx:166,171` | `bg-black/60` | nein | `rounded-xl shadow-2xl w-[520px]` | `createPortal` |
| `LinkPickerModal.tsx:107,110` | `bg-black/50` | `backdrop-blur-sm` | `rounded-xl shadow-2xl w-[560px]` | nein |
| `AltarLibraryStrip.tsx:195-196` | `bg-black/55` | nein | `rounded-xl` (kein `shadow-*`) | nein |

Overlay-Opacity (50/55/60), Blur-Einsatz und Portal-Nutzung unterscheiden sich in allen drei Fällen.

### Icons (lucide-react)

Keine dokumentierte Größen-Skala. `size`-Props reichen von 10–18px und variieren teils innerhalb derselben Datei zwischen visuell gleichrangigen Elementen, z. B. `SettingsModal.tsx`: Header-Close-Icon `size={16}` (Zeile 179), Sektions-Icons überwiegend `size={13}`/`size={14}` (Zeilen 189, 205, 214, 229, 248, 276, 349, 363, 366) ohne erkennbares Muster, welches Icon welche Größe bekommt. Farbe wird konsistent über die umgebende `text-stone-*`/`text-jade-*`/Theme-Var-Klasse vererbt, nicht per `color`-Prop.

## Beobachtete Inkonsistenzen

Sachliche Zusammenfassung der oben belegten Abweichungen, ohne Priorisierung:

1. **Primärfarbe an drei Stellen unabhängig gepflegt**: `jade`-Tailwind-Skala, `--accent`-CSS-Vars pro Theme, und Bridge-Overrides in `index.css` (z. B. `index.css:900-906`, `1343-1348`) — alle drei können bei einer Farbänderung auseinanderlaufen.
2. **`parchment`-Tailwind-Skala ungenutzt**: Definiert in `tailwind.config.js:29-41`, aber das Parchment-Theme verwendet eigene CSS-Var-Werte, die nicht auf diese Skala mappen.
3. **Kein geteiltes Button-Component**: `.btn-primary`/`.btn-secondary`/`.btn-ghost` existieren, werden aber an mehreren Stellen (`HomeView.tsx:239-243`, `SettingsModal.tsx:447`, `UndoToast.tsx:25`) durch eigene, leicht abweichende Inline-Varianten ersetzt.
4. **Drei unabhängige Modal-Implementierungen** mit unterschiedlicher Overlay-Opacity, Backdrop-Blur und Portal-Nutzung (siehe Tabelle oben).
5. **Border-Radius ohne erkennbare Regel** zwischen `rounded-md`/`lg`/`xl` für konzeptionell ähnliche Container (z. B. `ContextMenu` vs. `UndoToast`).
6. **Icon-Größen rein ad-hoc** (10–18px), keine Skala, teils uneinheitlich innerhalb derselben Datei.
7. **`JetBrains Mono` totes Config**: in `tailwind.config.js:46` deklariert, aber nirgends per Font-Link geladen.
