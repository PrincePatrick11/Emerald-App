import type Database from './sqlite';
import { linkItemKey } from './linkItems';
import {
  extractInternalLinks,
  internalLinkBlockHtml,
  isBlankContent,
  plainBlockHtml,
  type InternalLinkChip,
} from './internalLinkHtml';
import {
  legacyChipIcon,
  tablesLinkSource,
  type LegacyCategoryRow,
  type LegacyLinkSource,
  type LegacyLinkTarget,
} from './migrateLinkedIdsToContent';

/**
 * Migration v37 — die drei festen Journal-Felder Paradigma, Bannung und
 * Meditation werden zu Link-Chips im Inhalt.
 *
 * Sie waren Dropdowns in der rechten Seitenleiste und Chips unter dem Titel,
 * jedes auf eine Wiki-Kategorie festgelegt. Beides ist weg: Ein Journal-Eintrag
 * verlinkt jetzt frei, und das Verlinkungs-Feld zeigt die Ziele nach Kategorie
 * sortiert — womit Paradigma, Bannung und Meditation dort weiterhin
 * beieinanderstehen, nur ohne eigenes Feld.
 *
 * Derselbe Umzug wie bei v36 (`linked_operation_ids`/`linked_wiki_ids`), mit
 * zwei Eigenheiten:
 * - Die Meditationsdauer hat kein Link-Ziel. Sie wandert als Text hinter den
 *   Chip: „Stilles Sitzen (20 min)".
 * - `is_bannung`/`is_meditation` konnten ohne Artikel gesetzt sein (der Haken
 *   ist älter als die Auswahl dahinter). Dann bleibt nur ein Absatz mit dem
 *   Namen der Kategorie — ein Chip ohne Ziel wäre ein toter Link.
 * Ein Feld, dessen Artikel im Papierkorb liegt oder gelöscht wurde, fällt weg;
 * wie in v36 wird ein verschwundenes Ziel nicht als Chip verewigt.
 *
 * Wie in v36 arbeitet die Umwandlung (`journalFieldsToContent`) auf einer
 * Zeile und einer `LegacyLinkSource` — der Import einer Sicherung von vor v37
 * nimmt denselben Weg, seit v49 die Spalten gestrichen hat.
 */

/**
 * Die drei abgelösten Felder in der Reihenfolge, in der sie in der Seitenleiste
 * standen — Schlüssel ist zugleich die ID ihrer Wiki-Kategorie. `fallbackName`
 * greift nur, wenn es die Kategorie-Zeile selbst nicht mehr gibt; sonst kommt
 * der Anzeigename aus dem Locale-Key.
 *
 * Exportiert, weil der `.emerald`-/Markdown-Import dieselbe Kenntnis braucht:
 * eine Datei von vor v37 trägt diese Felder im Kopf und soll dort dieselben
 * Blöcke ergeben wie die Migration hier.
 */
export const LEGACY_JOURNAL_FIELDS = {
  paradigm: { emoji: '🌀', fallbackName: 'Paradigma' },
  bannung: { emoji: '🚫', fallbackName: 'Bannung' },
  meditation: { emoji: '🧘', fallbackName: 'Meditation' },
} as const;

export type LegacyJournalField = keyof typeof LEGACY_JOURNAL_FIELDS;

const FIELD_ORDER: LegacyJournalField[] = ['paradigm', 'bannung', 'meditation'];

/** Die sechs alten Spalten einer Journal-Zeile — aus der Datenbank oder aus einer Sicherung. */
export interface JournalFieldsRow {
  paradigm_id?: unknown;
  is_bannung?: unknown;
  bannung_type_wiki_id?: unknown;
  is_meditation?: unknown;
  meditation_duration?: unknown;
  meditation_type_wiki_id?: unknown;
}

const idOf = (v: unknown): string | null => (v == null || v === '' ? null : String(v));
/** `1`, `true` oder `'1'` — die Datenbank liefert Zahlen, eine Sicherung womöglich Booleans. */
const flag = (v: unknown): boolean => v === true || Number(v) === 1;

/**
 * Der Inhalt mit Paradigma, Bannung und Meditation als Blöcke dahinter. Ohne
 * gesetzte Felder kommt `content` unverändert zurück.
 */
export function journalFieldsToContent(content: string, row: JournalFieldsRow, source: LegacyLinkSource): string {
  const alreadyLinked = new Set(extractInternalLinks(content).map(linkItemKey));
  let separator = !isBlankContent(content);
  let appended = '';

  // Was jedes Feld zu sagen hat: eine Artikel-ID, ein „war gesetzt"-Flag und
  // beim Meditations-Feld die Dauer. Erst hier zusammengetragen, damit die
  // Schleife darunter alle drei gleich behandelt.
  const paradigmId = idOf(row.paradigm_id);
  const bannungId = idOf(row.bannung_type_wiki_id);
  const meditationId = idOf(row.meditation_type_wiki_id);
  const duration = Number(row.meditation_duration);
  const values: Record<LegacyJournalField, { id: string | null; active: boolean; suffix?: string }> = {
    paradigm: { id: paradigmId, active: !!paradigmId },
    bannung: { id: bannungId, active: flag(row.is_bannung) || !!bannungId },
    meditation: {
      id: meditationId,
      active: flag(row.is_meditation) || !!meditationId,
      suffix: duration > 0 ? `(${duration} min)` : undefined,
    },
  };

  for (const key of FIELD_ORDER) {
    const { id, active, suffix } = values[key];
    if (!active) continue;

    const field = LEGACY_JOURNAL_FIELDS[key];
    const article: LegacyLinkTarget | undefined = id ? source.target('wiki', id) : undefined;
    // Eingebaute Wiki-Kategorien liegen mit deutschem Seed-Namen in der DB;
    // der Anzeigename kommt aus der Quelle (Locale-Key). Ohne diesen Umweg
    // stünde in einem englischen Vault dauerhaft „Bannung" im Eintrag. Ohne
    // Kategorie-Zeile bleibt der Name leer — lieber keine Überschrift als
    // eine erfundene.
    const cat = source.category('wiki', article?.category_id ?? key);
    const label = cat?.label ?? '';

    if (!article) {
      // Gesetzt, aber ohne Artikel dahinter — nur der Name der Kategorie.
      // Ein `paradigm_id`, dessen Artikel gelöscht wurde, fällt hier ebenfalls
      // heraus: `active` ist dann zwar wahr, aber der Text „Paradigma" allein
      // sagt nichts, was der Eintrag nicht schon durch sein Fehlen sagt.
      if (id) continue;
      const text = `${cat?.emoji || field.emoji} ${label || field.fallbackName}`;
      appended += plainBlockHtml(suffix ? `${text} ${suffix}` : text, { separator });
      separator = true;
      continue;
    }

    const linkKey = linkItemKey({ id: article.id, entryType: 'wiki' });
    if (alreadyLinked.has(linkKey)) continue;
    alreadyLinked.add(linkKey);

    const chip: InternalLinkChip = {
      id: article.id,
      entryType: 'wiki',
      label: article.title ?? '',
      // Wie in v36: ein hochgeladenes Bild gehört nicht in die Node-Attrs.
      icon: legacyChipIcon('wiki', article, cat?.emoji),
      entry_number: article.entry_number,
    };
    appended += internalLinkBlockHtml(chip, label, { separator, suffix });
    separator = true;
  }

  return content + appended;
}

interface EntryRow extends JournalFieldsRow {
  id: string;
  content: string | null;
}

export async function migrateJournalFieldsToContent(db: Database): Promise<void> {
  const entries = await db.select<EntryRow[]>(
    `SELECT id, content, paradigm_id, is_bannung, bannung_type_wiki_id,
            is_meditation, meditation_duration, meditation_type_wiki_id
       FROM journal_entries
      WHERE paradigm_id IS NOT NULL
         OR bannung_type_wiki_id IS NOT NULL
         OR meditation_type_wiki_id IS NOT NULL
         OR is_bannung = 1
         OR is_meditation = 1`
  );
  if (entries.length === 0) return;

  const [articles, categories] = await Promise.all([
    db.select<LegacyLinkTarget[]>(
      'SELECT id, title, icon, category_id, entry_number FROM wiki_articles WHERE deleted_at IS NULL'
    ),
    db.select<LegacyCategoryRow[]>('SELECT id, name, emoji, is_builtin FROM wiki_categories'),
  ]);
  const source = tablesLinkSource({ wiki: articles }, { wiki: categories });

  for (const entry of entries) {
    // `updated_at` bleibt unangetastet — die Migration ist keine Bearbeitung
    // durch den Nutzer und soll die Sortierung nicht umwerfen.
    const nextContent = journalFieldsToContent(entry.content ?? '', entry, source);
    await db.execute(
      `UPDATE journal_entries
          SET content = $1, paradigm_id = NULL, is_bannung = 0, bannung_type_wiki_id = NULL,
              is_meditation = 0, meditation_duration = NULL, meditation_type_wiki_id = NULL
        WHERE id = $2`,
      [nextContent, entry.id]
    );
  }
}
