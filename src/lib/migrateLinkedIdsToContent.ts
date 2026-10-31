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
 * Migration v36 — the journal columns `linked_operation_ids` and
 * `linked_wiki_ids` become link chips in the content.
 *
 * Before, linked operations and wiki articles were two fields of their own on the
 * journal entry, shown as chips under the title. Both are gone: whatever an
 * entry links now lives in its text, and the right sidebar
 * reads it from there. Without this migration, existing links would be
 * invisible overnight.
 *
 * The same block that `appendEntryLink` writes is appended (both via
 * `internalLinkBlockHtml`): separator line, category of the target as heading,
 * then the chip.
 *
 * The conversion itself (`linkedIdsToContent`) works on one row and
 * a lookup source (`LegacyLinkSource`): the migration looks things up in the
 * old tables, the import of a backup from before v36 in the file
 * (`rowsLinkSource`). Since v49 the columns no longer exist — old
 * backups therefore go through the same function before insertion.
 *
 * Two things worth knowing when reading:
 * - The heading is written in the language that was loaded during the migration run.
 *   From then on it is text in the user's entry and does not follow
 *   a language switch — like any other typed text.
 * - Resuming: the `WHERE` below skips rows that have already been emptied, and
 *   `alreadyLinked` catches targets that are already in the text. An abort
 *   midway leaves v36 unstamped, the next start carries on cleanly.
 */

/** The two link kinds the old journal fields pointed at. */
export type LegacyLinkType = 'operation' | 'wiki';

/** A link target of the old journal fields, as the conversion needs it. */
export interface LegacyLinkTarget {
  id: string;
  title: string | null;
  icon: string | null;
  category_id: string | null;
  entry_number: number | null;
}

/**
 * Where the conversion looks up targets and categories. A target that does not
 * exist (deleted, in the trash, not in the file) is dropped — a
 * vanished target is not immortalized as a chip.
 */
export interface LegacyLinkSource {
  target(type: LegacyLinkType, id: string): LegacyLinkTarget | undefined;
  /** Heading and emoji of a category; `undefined` if the row does not exist. */
  category(type: LegacyLinkType, id: string): { label: string; emoji: string | null } | undefined;
}

/** A category row, as both sources read it. */
export interface LegacyCategoryRow {
  id: string;
  name: string;
  emoji: string | null;
  is_builtin: number | boolean;
}

const byId = <T extends { id: string }>(rows: T[]) => new Map(rows.map((r) => [r.id, r]));

/**
 * The source of migrations v36/v37: targets and one category table
 * per module from the time before v38, built-in categories with the
 * display name of their module (`legacyCategoryLabel`).
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
 * The source when importing a backup: targets and categories from the file
 * itself, the categories already as one list (`categories`, since format 4 —
 * `migrateBackupPayload` lifts older ones beforehand). Entries in the file's
 * trash do not count as targets, as in the migration.
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
 * The emoji that is stored in the chip. Images do not belong in the
 * node attrs: `icon` lands in the stored HTML, and an uploaded
 * data URL thereby inflates every entry that links the target. The chip
 * fetches its image live anyway — only the emoji fallback is stored here. (The same
 * rule as the altar branch in useLinkItems.)
 */
export function legacyChipIcon(type: LegacyLinkType, target: LegacyLinkTarget, categoryEmoji: string | null | undefined): string {
  if (target.icon && !isImageIcon(target.icon)) return target.icon;
  if (categoryEmoji) return categoryEmoji;
  // Without a category row only the module fallback remains.
  return type === 'wiki' ? legacyWikiCategoryEmoji(target.category_id ?? '') : DEFAULT_ENTRY_EMOJI.operation;
}

/** `null` instead of `[]` for broken JSON — the caller then leaves the row alone. */
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

/** The two old columns of a journal row — as JSON text (database) or already as a list (file). */
export interface LinkedIdsRow {
  id: string;
  linked_operation_ids?: unknown;
  linked_wiki_ids?: unknown;
}

/**
 * The content with the links of the old columns as link blocks after it.
 * `null` if a column is not valid JSON — then the row stays as
 * it is. Without links, `content` comes back unchanged.
 */
export function linkedIdsToContent(content: string, row: LinkedIdsRow, source: LegacyLinkSource): string | null {
  /** Order as in the two replaced fields: operations first, then wiki. */
  const columns = [
    { column: 'linked_operation_ids', type: 'operation' },
    { column: 'linked_wiki_ids', type: 'wiki' },
  ] as const;

  const alreadyLinked = new Set(extractInternalLinks(content).map(linkItemKey));
  let appended = '';
  // For an empty entry the first separator line is left out — it separates
  // text from links, and there is no text there.
  let separator = !isBlankContent(content);

  for (const { column, type } of columns) {
    const ids = parseIds(row[column]);
    if (ids === null) {
      console.warn(`[db] ${column} von Eintrag ${row.id} ist kein gültiges JSON — Zeile bleibt unverändert`, row[column]);
      return null;
    }

    for (const id of ids) {
      const target = source.target(type, id);
      if (!target) continue; // Target deleted or in the trash.
      const key = linkItemKey({ id: target.id, entryType: type });
      if (alreadyLinked.has(key)) continue; // Already in the text.
      alreadyLinked.add(key);

      const cat = source.category(type, target.category_id ?? '');
      const chip: InternalLinkChip = {
        id: target.id,
        entryType: type,
        label: target.title ?? '',
        icon: legacyChipIcon(type, target, cat?.emoji),
        entry_number: target.entry_number,
      };
      // Without a category, better no heading at all than a "None".
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

  // The trash stays out: a deleted target would stay in the text permanently
  // as a chip, even if the trash later removes it for good.
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
    // `updated_at` is deliberately left untouched: the migration is not an
    // edit by the user and should not upset the sort order.
    await db.execute(
      `UPDATE journal_entries SET content = $1, linked_operation_ids = '[]', linked_wiki_ids = '[]' WHERE id = $2`,
      [nextContent, entry.id]
    );
  }
}
