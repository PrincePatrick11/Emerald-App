import type Database from './sqlite';
import type { TFunction } from 'i18next';
import { Marked } from 'marked';
import { categoryLabel } from './categories';
import { isImageIcon } from './helpers';
import { DEFAULT_ENTRY_EMOJI } from './modules';
import { escapeHtml, internalLinkBlockHtml } from './internalLinkHtml';
import { backupDatabaseFile, tableExists } from './dbRebuild';
import { jsonArray } from './row';
import { insertTemplateRow, nextTemplateSortOrder, templateById } from './templateRows';
import { DEFAULT_TEMPLATE_ICON, isTemplateId, type Template } from './blocks/templates';

/**
 * The routines (table `routines`, up to v43) become templates — migration v44
 * and the import of older backups take the same path.
 *
 * A routine was a name, emoji, text (Markdown), tags and one list each of
 * linked operations and wiki articles that one dragged into an entry. Since
 * the sidebar rework there was no way to get there any more; the template can do
 * everything it could. It becomes a template without an assignment (so selectable in
 * every entry) with the same ID: the text as paragraphs, the
 * links as link blocks — the same ones that inserting a routine would have
 * written —, the tags as tags.
 */

/** A routine as it appears in the table or a backup. */
type RoutineRow = Record<string, unknown>;

/** A possible link target (operation or wiki article). */
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

/** What a link chip needs to know about its target. */
interface RoutineLinkTarget {
  title: string;
  icon: string;
  entry_number: number | null;
  categoryLabel: string;
}

type RoutineLinkResolver = (entryType: 'operation' | 'wiki', id: string) => RoutineLinkTarget | undefined;

/** Links and images only with these schemes — everything else stays text. */
const SAFE_URL_RE = /^(?:https?:|mailto:)/i;

/**
 * Markdown as when inserting a routine, but without raw HTML and without
 * foreign link schemes: raw HTML stood in the text as characters, not as markup
 * (on insertion DOMPurify removed it) — here it is visibly escaped.
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

/** A routine as a template — `null` without a usable ID. */
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
      if (!target) continue; // Target deleted or not there.
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
 * Resolves link targets from rows — from the database (migration) or from
 * backup and vault (import). Anything in the trash does not count: a
 * deleted target would otherwise stay in the template permanently as a chip. With
 * several sources, the first one that knows the target wins.
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
    // Images do not belong in the chip (see v36) — emoji only.
    const icon = row.icon && !isImageIcon(row.icon) ? row.icon : (cat?.emoji || DEFAULT_ENTRY_EMOJI[entryType]);
    return {
      title: row.title ?? '',
      icon,
      entry_number: row.entry_number ?? null,
      categoryLabel: cat ? categoryLabel(t, { id: String(cat.id), name: cat.name, is_builtin: !!cat.is_builtin }) : '',
    };
  };
}

/**
 * The link targets of a vault — for the migration and as a fallback on import.
 * v44 runs before v49 and still reads the two old tables, the import afterwards
 * `entries`.
 */
export async function vaultRoutineLinkSource(db: Database) {
  const columns = 'id, title, icon, category_id, entry_number, deleted_at';
  const unified = await tableExists(db, 'entries');
  const targets = (type: 'operation' | 'wiki', table: string) => db.select<RoutineTargetRow[]>(
    unified ? `SELECT ${columns} FROM entries WHERE type = $1` : `SELECT ${columns} FROM ${table}`,
    unified ? [type] : [],
  );
  return {
    operations: await targets('operation', 'operations'),
    articles: await targets('wiki', 'wiki_articles'),
    categories: await db.select<RoutineCategoryRow[]>('SELECT id, name, emoji, is_builtin FROM categories'),
  };
}

/**
 * Migration v44: every routine becomes a template, afterwards the table is dropped.
 * Repeatable — a routine that was already carried over (same ID) is skipped.
 * A backup of the file is taken beforehand if there are routines.
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
