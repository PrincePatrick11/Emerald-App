import type Database from './sqlite';
import i18n from '../i18n';
import { categoryLabel, legacyCategoryLabel, legacyWikiCategoryEmoji } from './categories';
import { DEFAULT_ENTRY_EMOJI } from './modules';
import { isImageIcon } from './helpers';
import { linkItemKey } from './linkItems';
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
 * Die Umwandlung selbst (`linkedIdsToContent`) arbeitet auf einer Zeile und
 * einer Nachschlage-Quelle (`LegacyLinkSource`): die Migration schlägt in den
 * alten Tabellen nach, der Import einer Sicherung von vor v36 in der Datei
 * (`rowsLinkSource`). Seit v49 gibt es die Spalten nicht mehr — alte
 * Sicherungen gehen deshalb vor dem Einfügen durch dieselbe Funktion.
 *
 * Zwei Dinge, die man beim Lesen wissen sollte:
 * - Die Überschrift wird in der Sprache geschrieben, die beim Migrationslauf
 *   geladen war. Sie ist ab dann Text im Eintrag des Nutzers und wandert bei
 *   einem Sprachwechsel nicht mit — wie jeder andere getippte Text auch.
 * - Wiederaufnahme: Das `WHERE` unten überspringt bereits geleerte Zeilen, und
 *   `alreadyLinked` fängt Ziele ab, die schon im Text stehen. Ein Abbruch
 *   mittendrin lässt v36 ungestempelt, der nächste Start macht sauber weiter.
 */

/** Die beiden Link-Arten, auf die die alten Journal-Felder zeigten. */
export type LegacyLinkType = 'operation' | 'wiki';

/** Ein Link-Ziel der alten Journal-Felder, wie die Umwandlung es braucht. */
export interface LegacyLinkTarget {
  id: string;
  title: string | null;
  icon: string | null;
  category_id: string | null;
  entry_number: number | null;
}

/**
 * Wo die Umwandlung Ziele und Kategorien nachschlägt. Ein Ziel, das es nicht
 * gibt (gelöscht, im Papierkorb, nicht in der Datei), fällt weg — ein
 * verschwundenes Ziel wird nicht als Chip verewigt.
 */
export interface LegacyLinkSource {
  target(type: LegacyLinkType, id: string): LegacyLinkTarget | undefined;
  /** Überschrift und Emoji einer Kategorie; `undefined`, wenn es die Zeile nicht gibt. */
  category(type: LegacyLinkType, id: string): { label: string; emoji: string | null } | undefined;
}

/** Eine Kategoriezeile, wie beide Quellen sie lesen. */
export interface LegacyCategoryRow {
  id: string;
  name: string;
  emoji: string | null;
  is_builtin: number | boolean;
}

const byId = <T extends { id: string }>(rows: T[]) => new Map(rows.map((r) => [r.id, r]));

/**
 * Die Quelle der Migrationen v36/v37: Ziele und je Modul eine eigene
 * Kategorie-Tabelle aus der Zeit vor v38, eingebaute Kategorien mit dem
 * Anzeigenamen ihres Moduls (`legacyCategoryLabel`).
 */
export function tablesLinkSource(
  targets: Partial<Record<LegacyLinkType, LegacyLinkTarget[]>>,
  categories: Partial<Record<LegacyLinkType, LegacyCategoryRow[]>>,
): LegacyLinkSource {
  const t = i18n.t;
  const targetMaps = { operation: byId(targets.operation ?? []), wiki: byId(targets.wiki ?? []) };
  const categoryMaps = { operation: byId(categories.operation ?? []), wiki: byId(categories.wiki ?? []) };
  const module = { operation: 'operations', wiki: 'wiki' } as const;
  return {
    target: (type, id) => targetMaps[type].get(id),
    category: (type, id) => {
      const cat = categoryMaps[type].get(id);
      return cat && {
        label: legacyCategoryLabel(t, module[type], { id: cat.id, name: cat.name, is_builtin: !!cat.is_builtin }),
        emoji: cat.emoji,
      };
    },
  };
}

/**
 * Die Quelle beim Import einer Sicherung: Ziele und Kategorien aus der Datei
 * selbst, die Kategorien schon als eine Liste (`categories`, seit Format 4 —
 * ältere hebt `migrateBackupPayload` vorher an). Einträge im Papierkorb der
 * Datei zählen wie in der Migration nicht als Ziel.
 */
export function rowsLinkSource(
  targets: Record<LegacyLinkType, readonly Record<string, unknown>[]>,
  categories: readonly Record<string, unknown>[],
): LegacyLinkSource {
  const t = i18n.t;
  const toTarget = (r: Record<string, unknown>): LegacyLinkTarget => ({
    id: String(r.id),
    title: r.title == null ? null : String(r.title),
    icon: r.icon == null ? null : String(r.icon),
    category_id: r.category_id == null ? null : String(r.category_id),
    entry_number: r.entry_number == null || Number.isNaN(Number(r.entry_number)) ? null : Number(r.entry_number),
  });
  const live = (rows: readonly Record<string, unknown>[]) => byId(rows.filter((r) => !r.deleted_at).map(toTarget));
  const targetMaps = { operation: live(targets.operation), wiki: live(targets.wiki) };
  const categoryMap = new Map(categories.map((c) => [String(c.id), c]));
  return {
    target: (type, id) => targetMaps[type].get(id),
    category: (_type, id) => {
      const cat = categoryMap.get(id);
      return cat && {
        label: categoryLabel(t, { id: String(cat.id), name: String(cat.name ?? ''), is_builtin: !!cat.is_builtin }),
        emoji: cat.emoji == null ? null : String(cat.emoji),
      };
    },
  };
}

/**
 * Das Emoji, das im Chip gespeichert wird. Bilder gehören nicht in die
 * Node-Attrs: `icon` landet im gespeicherten HTML, und eine hochgeladene
 * data-URL bläht damit jeden Eintrag auf, der das Ziel verlinkt. Der Chip
 * holt sein Bild ohnehin live — hier steht nur der Emoji-Rückfall. (Dieselbe
 * Regel wie beim Altar-Zweig in useLinkItems.)
 */
export function legacyChipIcon(type: LegacyLinkType, target: LegacyLinkTarget, categoryEmoji: string | null | undefined): string {
  if (target.icon && !isImageIcon(target.icon)) return target.icon;
  if (categoryEmoji) return categoryEmoji;
  // Ohne Kategorie-Zeile bleibt nur der Modul-Fallback.
  return type === 'wiki' ? legacyWikiCategoryEmoji(target.category_id ?? '') : DEFAULT_ENTRY_EMOJI.operation;
}

/** `null` statt `[]` bei kaputtem JSON — der Aufrufer lässt die Zeile dann in Ruhe. */
function parseIds(value: unknown): string[] | null {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
  if (!value) return [];
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : null;
  } catch {
    return null;
  }
}

/** Die beiden alten Spalten einer Journal-Zeile — als JSON-Text (Datenbank) oder schon als Liste (Datei). */
export interface LinkedIdsRow {
  id: string;
  linked_operation_ids?: unknown;
  linked_wiki_ids?: unknown;
}

/**
 * Der Inhalt mit den Verknüpfungen der alten Spalten als Link-Blöcke dahinter.
 * `null`, wenn eine Spalte kein gültiges JSON ist — dann bleibt die Zeile, wie
 * sie ist. Ohne Verknüpfungen kommt `content` unverändert zurück.
 */
export function linkedIdsToContent(content: string, row: LinkedIdsRow, source: LegacyLinkSource): string | null {
  /** Reihenfolge wie in den beiden abgelösten Feldern: erst Operationen, dann Wiki. */
  const columns = [
    { column: 'linked_operation_ids', type: 'operation' },
    { column: 'linked_wiki_ids', type: 'wiki' },
  ] as const;

  const alreadyLinked = new Set(extractInternalLinks(content).map(linkItemKey));
  let appended = '';
  // Bei einem leeren Eintrag bleibt die erste Trennlinie weg — sie trennt
  // Text von Links, und Text gibt es dort keinen.
  let separator = !isBlankContent(content);

  for (const { column, type } of columns) {
    const ids = parseIds(row[column]);
    if (ids === null) {
      console.warn(`[db] ${column} von Eintrag ${row.id} ist kein gültiges JSON — Zeile bleibt unverändert`, row[column]);
      return null;
    }

    for (const id of ids) {
      const target = source.target(type, id);
      if (!target) continue; // Ziel gelöscht oder im Papierkorb.
      const key = linkItemKey({ id: target.id, entryType: type });
      if (alreadyLinked.has(key)) continue; // Steht schon im Text.
      alreadyLinked.add(key);

      const cat = source.category(type, target.category_id ?? '');
      const chip: InternalLinkChip = {
        id: target.id,
        entryType: type,
        label: target.title ?? '',
        icon: legacyChipIcon(type, target, cat?.emoji),
        entry_number: target.entry_number,
      };
      // Ohne Kategorie lieber gar keine Überschrift als ein „Keine".
      appended += internalLinkBlockHtml(chip, cat?.label ?? '', { separator });
      separator = true;
    }
  }

  return content + appended;
}

interface EntryRow {
  id: string;
  content: string | null;
  linked_operation_ids: string | null;
  linked_wiki_ids: string | null;
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
    db.select<LegacyLinkTarget[]>('SELECT id, title, icon, category_id, entry_number FROM operations WHERE deleted_at IS NULL'),
    db.select<LegacyCategoryRow[]>('SELECT id, name, emoji, is_builtin FROM operation_categories'),
    db.select<LegacyLinkTarget[]>('SELECT id, title, icon, category_id, entry_number FROM wiki_articles WHERE deleted_at IS NULL'),
    db.select<LegacyCategoryRow[]>('SELECT id, name, emoji, is_builtin FROM wiki_categories'),
  ]);
  const source = tablesLinkSource(
    { operation: operations, wiki: articles },
    { operation: opCategories, wiki: wikiCategories },
  );

  for (const entry of entries) {
    const nextContent = linkedIdsToContent(entry.content ?? '', entry, source);
    if (nextContent === null) continue;
    // `updated_at` bleibt bewusst unangetastet: die Migration ist keine
    // Bearbeitung durch den Nutzer und soll die Sortierung nicht umwerfen.
    await db.execute(
      `UPDATE journal_entries SET content = $1, linked_operation_ids = '[]', linked_wiki_ids = '[]' WHERE id = $2`,
      [nextContent, entry.id]
    );
  }
}
