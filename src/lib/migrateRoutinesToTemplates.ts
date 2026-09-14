import type Database from '@tauri-apps/plugin-sql';
import type { TFunction } from 'i18next';
import { Marked } from 'marked';
import { categoryLabel } from './categories';
import { isImageIcon } from './helpers';
import { DEFAULT_ENTRY_EMOJI } from './modules';
import { escapeHtml, internalLinkBlockHtml } from './internalLinkHtml';
import { backupDatabaseFile } from './dbRebuild';
import { jsonArray } from './row';
import { insertTemplateRow, nextTemplateSortOrder, templateById } from './templateRows';
import { DEFAULT_TEMPLATE_ICON, isTemplateId, type Template } from './blocks/templates';

/**
 * Die Routinen (Tabelle `routines`, bis v43) werden Vorlagen — Migration v44
 * und der Import älterer Sicherungen gehen denselben Weg.
 *
 * Eine Routine war Name, Emoji, Text (Markdown), Tags und je eine Liste
 * verknüpfter Operationen und Wiki-Artikel, die man in einen Eintrag zog. Seit
 * dem Umbau der Seitenleiste gab es keinen Weg mehr dorthin; die Vorlage kann
 * alles, was sie konnte. Aus ihr wird eine Vorlage ohne Zuweisung (also in
 * jedem Eintrag wählbar) mit derselben ID: der Text als Absätze, die
 * Verknüpfungen als Link-Blöcke — dieselben, die das Einfügen einer Routine
 * geschrieben hätte —, die Tags als Tags.
 */

/** Eine Routine, wie sie in der Tabelle oder einer Sicherung steht. */
type RoutineRow = Record<string, unknown>;

/** Ein mögliches Link-Ziel (Operation oder Wiki-Artikel). */
export interface RoutineTargetRow {
  id: string;
  title: string | null;
  icon: string | null;
  category_id: string | null;
  entry_number: number | null;
  deleted_at?: string | null;
}

export interface RoutineCategoryRow {
  id: string;
  name: string;
  emoji: string | null;
  is_builtin: number | boolean;
}

/** Was ein Link-Chip über sein Ziel wissen muss. */
interface RoutineLinkTarget {
  title: string;
  icon: string;
  entry_number: number | null;
  categoryLabel: string;
}

type RoutineLinkResolver = (entryType: 'operation' | 'wiki', id: string) => RoutineLinkTarget | undefined;

/** Links und Bilder nur mit diesen Schemata — alles andere bleibt Text. */
const SAFE_URL_RE = /^(?:https?:|mailto:)/i;

/**
 * Markdown wie beim Einfügen einer Routine, aber ohne rohes HTML und ohne
 * fremde Link-Schemata: rohes HTML stand im Text als Zeichen, nicht als Markup
 * (beim Einfügen nahm es DOMPurify heraus) — hier wird es sichtbar maskiert.
 */
const markdown = new Marked({
  async: false,
  renderer: {
    html({ text }) {
      return escapeHtml(text);
    },
    link({ href, text }) {
      return SAFE_URL_RE.test(href) ? false : escapeHtml(text);
    },
    image({ href, text }) {
      return SAFE_URL_RE.test(href) ? false : escapeHtml(text);
    },
  },
});

function stringList(value: unknown): string[] {
  return jsonArray<unknown>(value).filter((v): v is string => typeof v === 'string');
}

const stringOr = (value: unknown, fallback = '') => (typeof value === 'string' ? value : fallback);

/** Eine Routine als Vorlage — `null` ohne brauchbare ID. */
export function routineToTemplate(
  routine: RoutineRow,
  resolve: RoutineLinkResolver,
  sortOrder: number,
  now: string,
): Template | null {
  if (!isTemplateId(routine.id)) return null;
  const source = stringOr(routine.content);
  const body = source.trim() ? (markdown.parse(source) as string) : '';
  let links = '';
  let separator = body !== '';
  for (const [entryType, column] of [['operation', 'operation_ids'], ['wiki', 'wiki_ids']] as const) {
    for (const id of stringList(routine[column])) {
      const target = resolve(entryType, id);
      if (!target) continue; // Ziel gelöscht oder nicht da.
      links += internalLinkBlockHtml(
        { id, entryType, label: target.title, icon: target.icon, entry_number: target.entry_number },
        target.categoryLabel,
        { separator },
      );
      separator = true;
    }
  }
  return {
    id: routine.id,
    name: stringOr(routine.name),
    icon: stringOr(routine.emoji) || DEFAULT_TEMPLATE_ICON,
    description: '',
    title: '',
    content: body + links,
    tags: stringList(routine.tags),
    assignments: [],
    sort_order: sortOrder,
    created_at: stringOr(routine.created_at, now),
    updated_at: stringOr(routine.updated_at, now),
    deleted_at: null,
  };
}

/**
 * Löst Link-Ziele aus Zeilen auf — aus der Datenbank (Migration) oder aus
 * Sicherung und Vault (Import). Was im Papierkorb liegt, zählt nicht: ein
 * gelöschtes Ziel stünde sonst als Chip dauerhaft in der Vorlage. Bei
 * mehreren Quellen gewinnt die erste, die das Ziel kennt.
 */
export function routineLinkResolver(
  t: TFunction,
  sources: readonly { operations: readonly RoutineTargetRow[]; articles: readonly RoutineTargetRow[]; categories: readonly RoutineCategoryRow[] }[],
): RoutineLinkResolver {
  const live = (rows: readonly RoutineTargetRow[]) => new Map(rows.filter((r) => r.deleted_at == null).map((r) => [String(r.id), r]));
  const prepared = sources.map((s) => ({
    operation: live(s.operations),
    wiki: live(s.articles),
    categories: new Map(s.categories.map((c) => [String(c.id), c])),
  }));
  return (entryType, id) => {
    const source = prepared.find((s) => s[entryType].has(id));
    const row = source?.[entryType].get(id);
    if (!source || !row) return undefined;
    const cat = row.category_id ? source.categories.get(String(row.category_id)) : undefined;
    // Bilder gehören nicht in den Chip (siehe v36) — nur Emoji.
    const icon = row.icon && !isImageIcon(row.icon) ? row.icon : (cat?.emoji || DEFAULT_ENTRY_EMOJI[entryType]);
    return {
      title: row.title ?? '',
      icon,
      entry_number: row.entry_number ?? null,
      categoryLabel: cat ? categoryLabel(t, { id: String(cat.id), name: cat.name, is_builtin: !!cat.is_builtin }) : '',
    };
  };
}

/** Die Link-Ziele eines Vaults — für die Migration und als Rückfall beim Import. */
export async function vaultRoutineLinkSource(db: Database) {
  return {
    operations: await db.select<RoutineTargetRow[]>('SELECT id, title, icon, category_id, entry_number, deleted_at FROM operations'),
    articles: await db.select<RoutineTargetRow[]>('SELECT id, title, icon, category_id, entry_number, deleted_at FROM wiki_articles'),
    categories: await db.select<RoutineCategoryRow[]>('SELECT id, name, emoji, is_builtin FROM categories'),
  };
}

/**
 * Migration v44: jede Routine wird eine Vorlage, danach entfällt die Tabelle.
 * Wiederholbar — eine schon übernommene Routine (gleiche ID) wird übersprungen.
 * Vorher eine Sicherung der Datei, wenn es Routinen gibt.
 */
export async function migrateRoutinesToTemplates(db: Database, t: TFunction): Promise<void> {
  const [table] = await db.select<{ n: number }[]>(
    "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='routines'"
  );
  if (!table?.n) return;
  const routines = await db.select<RoutineRow[]>('SELECT * FROM routines ORDER BY created_at ASC');
  if (routines.length > 0) {
    await backupDatabaseFile(db, 'v44');
    const resolve = routineLinkResolver(t, [await vaultRoutineLinkSource(db)]);
    const now = new Date().toISOString();
    let sortOrder = await nextTemplateSortOrder(db);
    for (const routine of routines) {
      const template = routineToTemplate(routine, resolve, sortOrder, now);
      if (!template || await templateById(db, template.id)) continue;
      await insertTemplateRow(db, template);
      sortOrder++;
    }
  }
  await db.execute('DROP TABLE routines');
}
