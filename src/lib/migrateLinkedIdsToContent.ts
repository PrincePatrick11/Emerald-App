import type Database from '@tauri-apps/plugin-sql';
import i18n from '../i18n';
import { categoryLabel } from './categories';
import { DEFAULT_ENTRY_EMOJI } from './modules';
import { isImageIcon } from './helpers';
import { linkItemKey } from './linkItems';
import { getCategoryEmoji } from '../components/wiki/WikiList';
import {
  extractInternalLinks,
  internalLinkBlockHtml,
  isBlankContent,
  type InternalLinkChip,
} from './internalLinkHtml';

/**
 * Migration v36 — die Journal-Spalten `linked_operation_ids` und
 * `linked_wiki_ids` werden zu Link-Chips im Inhalt.
 *
 * Vorher waren verknüpfte Operationen und Wiki-Artikel zwei eigene Felder am
 * Journal-Eintrag, gezeigt als Chips unter dem Titel. Beides ist weg: Was ein
 * Eintrag verlinkt, steht jetzt in seinem Text, und die rechte Seitenleiste
 * liest es von dort. Ohne diese Migration wären bestehende Verknüpfungen von
 * einem Tag auf den anderen unsichtbar.
 *
 * Angehängt wird derselbe Block, den `appendEntryLink` schreibt (beide über
 * `internalLinkBlockHtml`): Trennlinie, Kategorie des Ziels als Überschrift,
 * dann der Chip.
 *
 * Die Spalten bleiben im Schema — Export, Import und die Integritätsprüfung
 * kennen sie, und ein Backup aus der Zeit davor muss sie weiterhin füllen
 * dürfen. Geleert werden sie hier trotzdem, sonst stünde dieselbe Verknüpfung
 * zweimal in der Datenbank.
 *
 * Zwei Dinge, die man beim Lesen wissen sollte:
 * - Die Überschrift wird in der Sprache geschrieben, die beim Migrationslauf
 *   geladen war. Sie ist ab dann Text im Eintrag des Nutzers und wandert bei
 *   einem Sprachwechsel nicht mit — wie jeder andere getippte Text auch.
 * - Wiederaufnahme: Das `WHERE` unten überspringt bereits geleerte Zeilen, und
 *   `alreadyLinked` fängt Ziele ab, die schon im Text stehen. Ein Abbruch
 *   mittendrin lässt v36 ungestempelt, der nächste Start macht sauber weiter.
 */

interface EntryRow {
  id: string;
  content: string | null;
  linked_operation_ids: string | null;
  linked_wiki_ids: string | null;
}

interface TargetRow {
  id: string;
  title: string | null;
  icon: string | null;
  category_id: string | null;
  entry_number: number | null;
}

interface CategoryRow {
  id: string;
  name: string;
  emoji: string | null;
  is_builtin: number;
}

const byId = <T extends { id: string }>(rows: T[]) => new Map(rows.map((r) => [r.id, r]));

/** `null` statt `[]` bei kaputtem JSON — der Aufrufer lässt die Zeile dann in Ruhe. */
function parseIds(value: string | null): string[] | null {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : null;
  } catch {
    return null;
  }
}

export async function migrateLinkedIdsToContent(db: Database): Promise<void> {
  const entries = await db.select<EntryRow[]>(
    `SELECT id, content, linked_operation_ids, linked_wiki_ids FROM journal_entries
     WHERE (linked_operation_ids IS NOT NULL AND linked_operation_ids NOT IN ('', '[]'))
        OR (linked_wiki_ids      IS NOT NULL AND linked_wiki_ids      NOT IN ('', '[]'))`
  );
  if (entries.length === 0) return;

  // Papierkorb bleibt draußen: ein gelöschtes Ziel würde als Chip dauerhaft im
  // Text stehen, auch wenn der Papierkorb es später endgültig entfernt.
  const [operations, opCategories, articles, wikiCategories] = await Promise.all([
    db.select<TargetRow[]>('SELECT id, title, icon, category_id, entry_number FROM operations WHERE deleted_at IS NULL'),
    db.select<CategoryRow[]>('SELECT id, name, emoji, is_builtin FROM operation_categories'),
    db.select<TargetRow[]>('SELECT id, title, icon, category_id, entry_number FROM wiki_articles WHERE deleted_at IS NULL'),
    db.select<CategoryRow[]>('SELECT id, name, emoji, is_builtin FROM wiki_categories'),
  ]);

  const t = i18n.t;
  const toLabelable = (cat: CategoryRow | undefined) =>
    cat ? { id: cat.id, name: cat.name, is_builtin: !!cat.is_builtin } : undefined;

  /** Reihenfolge wie in den beiden abgelösten Feldern: erst Operationen, dann Wiki. */
  const sources = [
    {
      column: 'linked_operation_ids' as const,
      entryType: 'operation' as const,
      rows: byId(operations),
      cats: byId(opCategories),
      module: 'operations' as const,
      // Ohne Kategorie-Zeile bleibt nur der Modul-Fallback.
      iconFallback: (_row: TargetRow) => DEFAULT_ENTRY_EMOJI.operation,
    },
    {
      column: 'linked_wiki_ids' as const,
      entryType: 'wiki' as const,
      rows: byId(articles),
      cats: byId(wikiCategories),
      module: 'wiki' as const,
      iconFallback: (row: TargetRow) => getCategoryEmoji(row.category_id ?? ''),
    },
  ];

  for (const entry of entries) {
    const content = entry.content ?? '';
    const alreadyLinked = new Set(
      extractInternalLinks(content).map(linkItemKey)
    );

    let appended = '';
    let broken = false;
    // Bei einem leeren Eintrag bleibt die erste Trennlinie weg — sie trennt
    // Text von Links, und Text gibt es dort keinen.
    let separator = !isBlankContent(content);

    for (const source of sources) {
      const ids = parseIds(entry[source.column]);
      if (ids === null) {
        console.warn(
          `[db] v36: ${source.column} von Eintrag ${entry.id} ist kein gültiges JSON — Zeile bleibt unverändert`,
          entry[source.column]
        );
        broken = true;
        break;
      }

      for (const id of ids) {
        const row = source.rows.get(id);
        if (!row) continue; // Ziel gelöscht oder im Papierkorb.
        const key = linkItemKey({ id: row.id, entryType: source.entryType });
        if (alreadyLinked.has(key)) continue; // Steht schon im Text.
        alreadyLinked.add(key);

        const cat = source.cats.get(row.category_id ?? '');
        // Bilder gehören nicht in die Node-Attrs: `icon` landet im
        // gespeicherten HTML, und eine hochgeladene data-URL bläht damit jeden
        // Eintrag auf, der das Ziel verlinkt. Der Chip holt sein Bild ohnehin
        // live — hier steht nur der Emoji-Rückfall. (Dieselbe Regel wie beim
        // Altar-Zweig in useLinkItems.)
        const icon = row.icon && !isImageIcon(row.icon)
          ? row.icon
          : (cat?.emoji || source.iconFallback(row));

        const chip: InternalLinkChip = {
          id: row.id,
          entryType: source.entryType,
          label: row.title ?? '',
          icon,
          entry_number: row.entry_number,
        };
        // Ohne Kategorie lieber gar keine Überschrift als ein „Keine".
        appended += internalLinkBlockHtml(
          chip,
          categoryLabel(t, source.module, toLabelable(cat)),
          { separator }
        );
        separator = true;
      }
    }

    if (broken) continue;

    // `updated_at` bleibt bewusst unangetastet: die Migration ist keine
    // Bearbeitung durch den Nutzer und soll die Sortierung nicht umwerfen.
    const nextContent = content + appended;
    await db.execute(
      `UPDATE journal_entries SET content = $1, linked_operation_ids = '[]', linked_wiki_ids = '[]' WHERE id = $2`,
      [nextContent, entry.id]
    );

    // Die `links`-Tabelle spiegelt normalerweise `syncLinks` beim Speichern.
    // Die Migration schreibt am Store vorbei und muss den Spiegel selbst
    // nachziehen, sonst fehlen dem migrierten Eintrag seine Rückverweise, bis
    // ihn jemand zufällig neu speichert.
    await db.execute('DELETE FROM links WHERE source_id=$1', [entry.id]);
    for (const link of extractInternalLinks(nextContent)) {
      await db.execute(
        `INSERT OR IGNORE INTO links (source_id, source_type, target_id, target_type)
         VALUES ($1, 'journal', $2, $3)`,
        [entry.id, link.id, link.entryType]
      );
    }
  }
}
