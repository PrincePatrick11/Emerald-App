import type Database from './sqlite';
import type { Statement } from './sync/apply';
import { isStoredImage, saveImage } from './images';
import { internalLinkChipHtml } from './internalLinkHtml';
import { isImageIcon } from './helpers';
import { createTextBlock, parseBlocks, serializeBlocks } from './blocks/blockHtml';
import { hiddenAttrValue } from './blocks/blockAttrs';
import {
  implementedIn, isIsoDate, letterList, mayHoldSigil, serializeSigilCalc, serializeSigilCharge, textParagraphs,
} from './blocks/sigil';
import { withDrawingImage } from './blocks/paint';
import {
  contentWithoutLegacySigils, hasLegacySigilBlocks, LEGACY_SIGIL_CALC_TYPE, LEGACY_SIGIL_MARKER, type LegacySigilLabels, LEGACY_SIGIL_CANVAS_TYPE, LEGACY_SIGIL_CHARGE_TYPE, legacySigilBlock,
} from './blocks/legacySigilBlocks';
import { BLOCK_ATTR, type BlockInstance } from './blocks/types';
import { SIGIL_CATEGORY_ID } from './schema';

/**
 * Migration v42 — the sigil operation becomes an entry made of blocks.
 *
 * Up to v41 an operation of the "Sigils" category had a view of its own
 * and columns of its own: intention, letter bank, drawing (Base64), loaded,
 * target date, charging technique, notes. These become:
 * - calculator (intention, letters), drawing (as an image file via `saveImage`,
 *   only the filename in the block), charging (loaded, date, technique as a
 *   link chip; "whole entry" lock as before);
 * - the notes as a text block, followed by the existing content.
 * `show_sigil = 0` without charging becomes a hidden drawing block; for
 * a loaded sigil it was only the concealing mechanism, which the
 * charging block now takes over. An operation without sigil data but with notes
 * gets only the text block.
 *
 * If saving a drawing fails, the row stays completely untouched
 * (columns and content) — v49 (`unifyEntries`) catches up on it before it
 * drops the columns, and aborts as long as that does not succeed. A
 * drawing that is not an image at all (or oversized) is discarded instead of
 * being retried endlessly. The empty operations of the "Sigils" category are picked up
 * only by v42 itself and by the import of backups from before version 7 — and
 * only as long as their content does not yet carry
 * sigil blocks: an aborted and restarted v42 run
 * does not put a second set in front, and catching up does not add the blocks
 * again to an entry from which the user deliberately removed them.
 *
 * The blocks are written in the form of v42 to v63 (`legacySigilBlocks.ts`);
 * v64, and the backup import after it, convert them like every other.
 *
 * The columns are set to their base values, `updated_at` stays. The
 * conversion of a row (`sigilRowToContent`) is also used by the import of old
 * backups — before insertion, since the columns no longer exist since v49.
 */

/** The sigil columns of an operation row — from the database or from a backup. */
export interface LegacySigilRow {
  id: string;
  content: string | null;
  category_id: string | null;
  description: string | null;
  intention_text: string | null;
  letter_bank: string | null;
  implemented_letters: string | null;
  drawing_data: string | null;
  is_loaded: number | null;
  target_reveal_date: string | null;
  charging_technique_wiki_id: string | null;
  show_sigil: number | null;
}

const LEGACY_DATA = `drawing_data IS NOT NULL
   OR TRIM(intention_text) != ''
   OR letter_bank NOT IN ('[]', '')
   OR is_loaded = 1
   OR target_reveal_date IS NOT NULL
   OR charging_technique_wiki_id IS NOT NULL
   OR TRIM(description) != ''`;

/** A drawing that can be stored as an image: PNG/JPEG/GIF/WebP as a data URL, at most ~25 MB. */
const DRAWING_DATA_URL = /^data:image\/(?:png|jpeg|gif|webp);base64,/;
const MAX_DRAWING_CHARS = 25 * 1024 * 1024;

function jsonLetters(raw: unknown): string[] {
  if (Array.isArray(raw)) return letterList(raw);
  try {
    return letterList(JSON.parse(typeof raw === 'string' && raw ? raw : '[]'));
  } catch {
    return [];
  }
}

/** The sigil values themselves — what `LEGACY_DATA` asks in SQL, without the notes. */
function hasSigilValues(row: LegacySigilRow): boolean {
  return !!row.drawing_data || !!row.intention_text?.trim()
    || jsonLetters(row.letter_bank).length > 0 || Number(row.is_loaded) === 1
    || !!row.target_reveal_date || !!row.charging_technique_wiki_id;
}

/** Does the row get calculator, drawing and charging? */
function hasSigilData(row: LegacySigilRow): boolean {
  const inSigilCategory = row.category_id === SIGIL_CATEGORY_ID && !carriesSigil(row.content ?? '');
  return inSigilCategory || hasSigilValues(row);
}

/**
 * The drawing as a stored file. `null` = none (or unusable, then
 * discarded); `undefined` = saving failed, try again later.
 */
async function drawingFile(drawing: string | null): Promise<string | null | undefined> {
  if (!drawing) return null;
  if (isStoredImage(drawing)) return drawing;
  if (!DRAWING_DATA_URL.test(drawing) || drawing.length > MAX_DRAWING_CHARS) return null;
  try {
    const name = await saveImage(drawing);
    return typeof name === 'string' && name ? name : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Does the row carry legacy sigil data? The same question as `LEGACY_DATA`, for
 * rows that do not come from the database (import of a backup).
 * `includeSigilCategory` also counts empty operations of the "Sigils" category.
 */
export function needsSigilConversion(row: LegacySigilRow, includeSigilCategory: boolean): boolean {
  return (includeSigilCategory && row.category_id === SIGIL_CATEGORY_ID)
    || hasSigilValues(row) || !!row.description?.trim();
}

/** The fields of a wiki article that the charging-technique chip needs. */
export interface SigilTechniqueArticle {
  title: string | null;
  icon: string | null;
  entry_number: number | null;
}

/**
 * The content of an operation row with its legacy sigil data as blocks
 * in front. `undefined` if saving the drawing failed — then
 * the row stays as it is, and a later run tries again.
 */
export async function sigilRowToContent(
  row: LegacySigilRow,
  article: (id: string) => SigilTechniqueArticle | undefined,
): Promise<string | undefined> {
  const blocks: BlockInstance[] = [];
  if (hasSigilData(row)) {
    const drawing = await drawingFile(row.drawing_data);
    if (drawing === undefined) return undefined;
    const letters = jsonLetters(row.letter_bank);
    blocks.push(serializeSigilCalc(legacySigilBlock(LEGACY_SIGIL_CALC_TYPE), {
      intention: row.intention_text ?? '',
      letters,
      implemented: implementedIn(letters, jsonLetters(row.implemented_letters)),
    }));
    const canvas = withDrawingImage(legacySigilBlock(LEGACY_SIGIL_CANVAS_TYPE), drawing);
    const loaded = Number(row.is_loaded) === 1;
    const hidden = Number(row.show_sigil) === 0 && !loaded;
    blocks.push(hidden ? { ...canvas, attrs: { ...canvas.attrs, [BLOCK_ATTR.hidden]: hiddenAttrValue(true)! } } : canvas);

    // If the article is missing (say, an import without a wiki), the reference stays as a
    // chip with its ID — a later wiki import resolves it again.
    const techniqueId = row.charging_technique_wiki_id;
    const technique = techniqueId ? article(techniqueId) : undefined;
    const chip = techniqueId
      ? internalLinkChipHtml({
          id: techniqueId,
          entryType: 'wiki',
          label: technique?.title ?? techniqueId,
          icon: technique?.icon && !isImageIcon(technique.icon) ? technique.icon : '📚',
          entry_number: technique?.entry_number,
        })
      : null;
    const date = row.target_reveal_date?.slice(0, 10);
    blocks.push(serializeSigilCharge(legacySigilBlock(LEGACY_SIGIL_CHARGE_TYPE), {
      loaded,
      revealDate: isIsoDate(date) ? date : null,
      lock: 'entry',
      technique: chip,
      targets: null,
    }));
  }
  if (row.description?.trim()) blocks.push(createTextBlock(textParagraphs(row.description)));
  return serializeBlocks([...blocks, ...parseBlocks(row.content ?? '')]);
}

/** Does the content already carry a sigil — the blocks of v42 to v63, or what v64 made of them? */
function carriesSigil(content: string): boolean {
  return hasLegacySigilBlocks(content) || mayHoldSigil(content);
}

/** Are there rows the conversion would touch? For the backup before v42. */
export async function hasLegacySigilRows(db: Database): Promise<boolean> {
  const [row] = await db.select<{ n: number }[]>(
    `SELECT COUNT(*) AS n FROM operations WHERE category_id = $1 OR ${LEGACY_DATA}`,
    [SIGIL_CATEGORY_ID]
  );
  return (row?.n ?? 0) > 0;
}

/**
 * Converts operation rows with legacy sigil data. `includeSigilCategory`
 * also picks up empty operations of the "Sigils" category (v42 only).
 */
export async function convertLegacySigils(
  db: Database,
  { includeSigilCategory }: { includeSigilCategory: boolean },
): Promise<{ converted: number; failed: number }> {
  const where = includeSigilCategory ? `category_id = $1 OR ${LEGACY_DATA}` : LEGACY_DATA;
  const rows = (await db.select<LegacySigilRow[]>(
    `SELECT id, content, category_id, description, intention_text, letter_bank, implemented_letters,
            drawing_data, is_loaded, target_reveal_date, charging_technique_wiki_id, show_sigil
       FROM operations WHERE ${where}`,
    includeSigilCategory ? [SIGIL_CATEGORY_ID] : []
  ));
  if (rows.length === 0) return { converted: 0, failed: 0 };

  const articles = new Map(
    (await db.select<{ id: string; title: string | null; icon: string | null; entry_number: number | null }[]>(
      'SELECT id, title, icon, entry_number FROM wiki_articles'
    )).map((a) => [a.id, a])
  );

  let converted = 0;
  let failed = 0;
  for (const row of rows) {
    const content = await sigilRowToContent(row, (id) => articles.get(id));
    if (content === undefined) {
      failed += 1;
      continue;
    }
    await db.execute(
      `UPDATE operations
          SET content=$1, description='', intention_text='', letter_bank='[]', implemented_letters='[]',
              drawing_data=NULL, thumbnail_data=NULL, is_loaded=0, target_reveal_date=NULL,
              charging_technique_wiki_id=NULL, show_sigil=1, show_intention_in_properties=1,
              show_letter_bank_in_properties=1
        WHERE id=$2`,
      [content, row.id]
    );
    converted += 1;
  }
  return { converted, failed };
}

/**
 * Converts the old sigil blocks (v42 to v63, `legacySigilBlocks.ts`) of every
 * entry and template, trash included, in one transaction: the core of v64 and
 * of importing an older backup into its working copy (`dbBackup.ts`).
 * `before` (the backup of the database) runs only if there is something to
 * convert. Repeatable.
 */
export async function convertLegacySigilsInPlace(
  db: Database,
  labels?: LegacySigilLabels,
  before?: () => Promise<unknown>,
): Promise<void> {
  const statements: Statement[] = [];
  for (const table of ['entries', 'templates'] as const) {
    const rows = await db.select<{ id: string; content: string | null }[]>(
      `SELECT id, content FROM ${table} WHERE content LIKE '%${LEGACY_SIGIL_MARKER}%'`,
    );
    for (const row of rows) {
      const content = contentWithoutLegacySigils(row.content ?? '', labels);
      if (content !== row.content) statements.push([`UPDATE ${table} SET content=$1 WHERE id=$2`, [content, row.id]]);
    }
  }
  if (statements.length === 0) return;
  await before?.();
  await db.batch(statements);
}
