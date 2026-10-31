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
 * Migration v37 — the three fixed journal fields Paradigm, Banishing and
 * Meditation become link chips in the content.
 *
 * They were dropdowns in the right sidebar and chips under the title,
 * each tied to one wiki category. Both are gone: a journal entry
 * now links freely, and the linking field shows the targets sorted by
 * category — so Paradigm, Banishing and Meditation still sit
 * together there, just without a field of their own.
 *
 * The same move as v36 (`linked_operation_ids`/`linked_wiki_ids`), with
 * two peculiarities:
 * - The meditation duration has no link target. It moves as text after the
 *   chip: "Silent sitting (20 min)".
 * - `is_bannung`/`is_meditation` could be set without an article (the checkbox
 *   is older than the selection behind it). Then only a paragraph with the
 *   category name remains — a chip without a target would be a dead link.
 * A field whose article is in the trash or was deleted is dropped;
 * as in v36, a vanished target is not immortalized as a chip.
 *
 * As in v36, the conversion (`journalFieldsToContent`) works on one
 * row and a `LegacyLinkSource` — the import of a backup from before v37
 * takes the same path, since v49 dropped the columns.
 */

/**
 * The three replaced fields in the order in which they appeared in the sidebar
 * — the key is also the ID of their wiki category. `fallbackName`
 * only applies if the category row itself no longer exists; otherwise the
 * display name comes from the locale key.
 *
 * Exported because the `.emerald`/Markdown import needs the same knowledge:
 * a file from before v37 carries these fields in its header and should produce
 * the same blocks there as the migration here.
 */
export const LEGACY_JOURNAL_FIELDS = {
  paradigm: { emoji: '🌀', fallbackName: 'Paradigma' },
  bannung: { emoji: '🚫', fallbackName: 'Bannung' },
  meditation: { emoji: '🧘', fallbackName: 'Meditation' },
} as const;

export type LegacyJournalField = keyof typeof LEGACY_JOURNAL_FIELDS;

const FIELD_ORDER: LegacyJournalField[] = ['paradigm', 'bannung', 'meditation'];

/** The six old columns of a journal row — from the database or from a backup. */
export interface JournalFieldsRow {
  paradigm_id?: unknown;
  is_bannung?: unknown;
  bannung_type_wiki_id?: unknown;
  is_meditation?: unknown;
  meditation_duration?: unknown;
  meditation_type_wiki_id?: unknown;
}

const idOf = (v: unknown): string | null => (v == null || v === '' ? null : String(v));
/** `1`, `true` or `'1'` — the database delivers numbers, a backup possibly booleans. */
const flag = (v: unknown): boolean => v === true || Number(v) === 1;

/**
 * The content with Paradigm, Banishing and Meditation as blocks after it. Without
 * any fields set, `content` comes back unchanged.
 */
export function journalFieldsToContent(content: string, row: JournalFieldsRow, source: LegacyLinkSource): string {
  const alreadyLinked = new Set(extractInternalLinks(content).map(linkItemKey));
  let separator = !isBlankContent(content);
  let appended = '';

  // What each field has to say: an article ID, a "was set" flag and,
  // for the meditation field, the duration. Gathered here first, so that the
  // loop below treats all three the same.
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
    // Built-in wiki categories sit in the DB with a German seed name;
    // the display name comes from the source (locale key). Without this detour,
    // an English vault would permanently have "Bannung" in the entry. Without a
    // category row the name stays empty — better no heading than
    // an invented one.
    const cat = source.category('wiki', article?.category_id ?? key);
    const label = cat?.label ?? '';

    if (!article) {
      // Set, but with no article behind it — only the category name.
      // A `paradigm_id` whose article was deleted drops out here as well:
      // `active` is true then, but the text "Paradigma" alone
      // says nothing that the entry does not already say by its absence.
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
      // As in v36: an uploaded image does not belong in the node attrs.
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
    // `updated_at` stays untouched — the migration is not an edit
    // by the user and should not upset the sort order.
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
