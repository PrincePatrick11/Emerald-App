import type { TFunction } from 'i18next';
import { getCategoryEmoji } from '../components/wiki/WikiList';
import { MOON_PHASE_SYMBOLS } from './moonPhase';
import { DEFAULT_ENTRY_EMOJI } from './modules';
import { categoryLabel } from './categories';
import { isImageIcon } from './helpers';
import type {
  AltarRecord, ContentType, JournalEntry, MoonPhase, Operation, OperationCategory,
  Task, TaskCategory, WikiArticle, WikiCategoryDef,
} from '../types';

/**
 * Ein verlinkbarer Eintrag, wie ihn die `[[`-Autovervollständigung, der
 * Link-Picker, das Verlinkungs-Feld und die Import-/Export-Pfade sehen.
 *
 * Wohnt hier und nicht bei `SuggestionList`: `buildLinkItems` unten ist die
 * Quelle dieser Werte, und `lib/`-Module (Import/Export) brauchen den Typ,
 * ohne eine React-Komponente zu importieren. `SuggestionList` reicht ihn für
 * die Komponenten weiter, die ihn von dort holen.
 */
export interface SuggestionItem {
  id: string;
  entryType: ContentType;
  label: string;
  category?: string;
  /** Wandert beim Einfügen in die Node-Attrs und damit ins gespeicherte HTML. */
  icon?: string;
  /**
   * Nur zum Anzeigen, nie zum Speichern — für Altäre die data-URL aus
   * `icon_data`, die in den Node-Attrs nichts zu suchen hat. Fällt auf `icon`
   * und von dort auf `DEFAULT_ENTRY_EMOJI` zurück.
   */
  displayIcon?: string;
  /**
   * Übersetzter Name der Kategorie, in der der Eintrag in seinem Modul steht —
   * die Überschrift, unter der ein angehängter Link im Eintrag landet. Journal
   * hat keine Kategorien und nimmt die Mondphase (so heißt „Kategorie" dort
   * auch beim Sortieren), Altäre haben gar keine und nehmen den Modulnamen.
   */
  categoryLabel?: string;
  entry_number?: number;
}

/**
 * Alle verlinkbaren Einträge aller Module als eine Liste — die eine Wahrheit
 * dafür, welches Icon, welches Label und welche Kategorie ein Link-Ziel trägt.
 * Genutzt von der `[[`-Autovervollständigung, dem Link-Picker, dem
 * Verlinkungs-Feld der Seitenleiste (alle über `useLinkItems`) und vom
 * `.emerald`-Import/-Export, der dieselbe Zuordnung ohne React braucht.
 *
 * Reine Funktion über Store-Momentaufnahmen: der Hook memoisiert sie, die
 * Import/Export-Pfade rufen sie mit `getState()` und `i18n.t` direkt.
 *
 * Blockreihenfolge = Rail-Reihenfolge (Registry): journal, task, operation,
 * wiki, altar — nichts erzwingt das, es steht hier von Hand.
 *
 * Gelöschte Einträge filtern bereits die Stores heraus (`deleted_at IS NULL`
 * beim Laden), hier braucht es dafür keinen zweiten Filter.
 */
export interface LinkItemSources {
  entries: JournalEntry[];
  tasks: Task[];
  taskCategories: TaskCategory[];
  operations: Operation[];
  opCategories: OperationCategory[];
  articles: WikiArticle[];
  wikiCategories: WikiCategoryDef[];
  altars: AltarRecord[];
}

/**
 * Trennt Anzeige- und Speicher-Icon. Ein hochgeladenes Bild (data-URL, Blob,
 * Vault-Dateiname) darf NICHT in `icon` landen: das wandert beim Einfügen in
 * die Node-Attrs und damit in den gespeicherten Inhalt jedes Eintrags, der das
 * Ziel verlinkt — eine data-URL bläht ihn dort um ihre volle Größe auf, ohne je
 * gelesen zu werden (der Chip löst sein Icon live auf). Gespeichert wird der
 * Emoji-Rückfall, angezeigt das Bild.
 */
function splitIcon(icon: string | null | undefined, emojiFallback: string) {
  if (icon && isImageIcon(icon)) return { icon: emojiFallback, displayIcon: icon };
  return { icon: icon || emojiFallback, displayIcon: undefined };
}

export function buildLinkItems(s: LinkItemSources, t: TFunction): SuggestionItem[] {
  return [
    ...s.entries.map((e) => ({
      id: e.id,
      entryType: 'journal' as const,
      label: e.title,
      icon: MOON_PHASE_SYMBOLS[e.moon_phase as MoonPhase] ?? DEFAULT_ENTRY_EMOJI.journal,
      categoryLabel: e.moon_phase ? t(`moonPhase.${e.moon_phase}`) : t('journal.noPhase'),
      entry_number: e.entry_number,
    })),
    ...s.tasks.map((task) => {
      const cat = s.taskCategories.find((c) => c.id === task.category_id);
      return {
        id: task.id,
        entryType: 'task' as const,
        label: task.title,
        icon: cat?.emoji || DEFAULT_ENTRY_EMOJI.task,
        // Aufgaben-Kategorien haben keine Builtin-Keys — der gespeicherte Name
        // ist der Anzeigename (siehe lib/categories).
        categoryLabel: cat?.name,
      };
    }),
    ...s.operations.map((o) => {
      const cat = s.opCategories.find((c) => c.id === o.category_id);
      return {
        id: o.id,
        entryType: 'operation' as const,
        label: o.title,
        category: cat?.emoji,
        ...splitIcon(o.icon, cat?.emoji || DEFAULT_ENTRY_EMOJI.operation),
        categoryLabel: categoryLabel(t, 'operations', cat),
        entry_number: o.entry_number,
      };
    }),
    ...s.articles.map((a) => {
      const cat = s.wikiCategories.find((c) => c.id === a.category_id);
      return {
        id: a.id,
        entryType: 'wiki' as const,
        label: a.title,
        category: a.category_id,
        ...splitIcon(a.icon, cat?.emoji ?? getCategoryEmoji(a.category_id)),
        categoryLabel: categoryLabel(t, 'wiki', cat),
        entry_number: a.entry_number,
      };
    }),
    // Kein `icon`: es landet beim Einfügen in den Node-Attrs, und die einzige
    // Altar-Grafik (icon_data) ist eine data-URL — gespeichert wird nur der
    // Emoji-Fallback. Für die Anzeige trägt sie `displayIcon`.
    ...s.altars.map((a) => ({
      id: a.id,
      entryType: 'altar' as const,
      label: a.title,
      displayIcon: a.icon_data || DEFAULT_ENTRY_EMOJI.altar,
      // Altäre kennen keine Kategorien (altar_categories gehören den Elementen
      // auf dem Altar, nicht dem Altar selbst) — es bleibt der Modulname.
      categoryLabel: t('nav.altar'),
    })),
  ];
}

/** `entryType:id` → Item. Der Schlüssel, unter dem Link-Chips nachgesehen werden. */
export function linkItemKey(target: { id: string; entryType: string }): string {
  return `${target.entryType}:${target.id}`;
}

export function linkItemsByKey(items: SuggestionItem[]): Map<string, SuggestionItem> {
  return new Map(items.map((i) => [linkItemKey(i), i]));
}
