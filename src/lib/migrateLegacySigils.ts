import type Database from './sqlite';
import { isStoredImage, saveImage } from './images';
import { internalLinkChipHtml } from './internalLinkHtml';
import { isImageIcon } from './helpers';
import { createTextBlock, parseBlocks, serializeBlocks } from './blocks/blockHtml';
import { hiddenAttrValue } from './blocks/blockAttrs';
import {
  createSigilCalcBlock, createSigilCanvasBlock, createSigilChargeBlock, implementedIn, isIsoDate, letterList,
  serializeSigilCalc, serializeSigilCharge, SIGIL_BLOCK_MARKER, textParagraphs, withSigilImage,
} from './blocks/sigil';
import { BLOCK_ATTR, type BlockInstance } from './blocks/types';
import { SIGIL_CATEGORY_ID } from './schema';

/**
 * Migration v42 — die Sigillen-Operation wird ein Eintrag aus Blöcken.
 *
 * Bis v41 hatte eine Operation der Kategorie „Sigillen" eine eigene Ansicht
 * und eigene Spalten: Absicht, Buchstabenbank, Zeichnung (Base64), geladen,
 * Zieldatum, Ladetechnik, Notizen. Daraus werden:
 * - Rechner (Absicht, Buchstaben), Zeichnung (als Bilddatei über `saveImage`,
 *   im Block nur der Dateiname), Ladung (geladen, Datum, Ladetechnik als
 *   Link-Chip; Sperre „ganzer Eintrag" wie bisher);
 * - die Notizen als Textblock, dahinter der bisherige Inhalt.
 * `show_sigil = 0` ohne Ladung wird ein ausgeblendeter Zeichnungs-Block; bei
 * einer geladenen Sigille war es nur der Verbergen-Mechanismus, den jetzt der
 * Ladung-Block übernimmt. Eine Operation ohne Sigillen-Daten mit Notizen
 * bekommt nur den Textblock.
 *
 * Scheitert das Speichern einer Zeichnung, bleibt die Zeile ganz unberührt
 * (Spalten und Inhalt) — v49 (`unifyEntries`) holt sie nach, bevor es die
 * Spalten verwirft, und bricht ab, solange das nicht gelingt. Eine
 * Zeichnung, die gar kein Bild ist (oder übergroß), wird verworfen statt
 * endlos wiederholt. Die leeren Operationen der Kategorie „Sigillen" nehmen
 * nur v42 selbst und der Import von Sicherungen vor Version 7 mit — und
 * nur, solange ihr Inhalt noch keine
 * Sigillen-Blöcke trägt: ein abgebrochener und neu gestarteter v42-Lauf
 * setzt kein zweites Set davor, und das Nachholen fügt einem Eintrag, dem
 * der Nutzer die Blöcke bewusst genommen hat, sie nicht wieder hinzu.
 *
 * Die Spalten werden auf ihre Grundwerte gesetzt, `updated_at` bleibt. Die
 * Umwandlung einer Zeile (`sigilRowToContent`) nimmt auch der Import alter
 * Sicherungen — vor dem Einfügen, denn seit v49 gibt es die Spalten nicht mehr.
 */

/** Die Sigillen-Spalten einer Operationszeile — aus der Datenbank oder aus einer Sicherung. */
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

/** Eine Zeichnung, die sich als Bild speichern lässt: PNG/JPEG/GIF/WebP als Data-URL, höchstens ~25 MB. */
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

/** Die Sigillen-Werte selbst — was `LEGACY_DATA` in SQL fragt, ohne die Notizen. */
function hasSigilValues(row: LegacySigilRow): boolean {
  return !!row.drawing_data || !!row.intention_text?.trim()
    || jsonLetters(row.letter_bank).length > 0 || Number(row.is_loaded) === 1
    || !!row.target_reveal_date || !!row.charging_technique_wiki_id;
}

/** Bekommt die Zeile Rechner, Zeichnung und Ladung? */
function hasSigilData(row: LegacySigilRow): boolean {
  const inSigilCategory = row.category_id === SIGIL_CATEGORY_ID && !(row.content ?? '').includes(SIGIL_BLOCK_MARKER);
  return inSigilCategory || hasSigilValues(row);
}

/**
 * Die Zeichnung als gespeicherte Datei. `null` = keine (oder unbrauchbar, dann
 * verworfen); `undefined` = das Speichern scheiterte, später erneut versuchen.
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
 * Trägt die Zeile Sigillen-Altdaten? Dieselbe Frage wie `LEGACY_DATA`, für
 * Zeilen, die nicht aus der Datenbank kommen (Import einer Sicherung).
 * `includeSigilCategory` zählt auch leere Operationen der Kategorie „Sigillen".
 */
export function needsSigilConversion(row: LegacySigilRow, includeSigilCategory: boolean): boolean {
  return (includeSigilCategory && row.category_id === SIGIL_CATEGORY_ID)
    || hasSigilValues(row) || !!row.description?.trim();
}

/** Die Felder eines Wiki-Artikels, die der Ladetechnik-Chip braucht. */
export interface SigilTechniqueArticle {
  title: string | null;
  icon: string | null;
  entry_number: number | null;
}

/**
 * Der Inhalt einer Operationszeile mit ihren Sigillen-Altdaten als Blöcke
 * davor. `undefined`, wenn das Speichern der Zeichnung scheiterte — dann
 * bleibt die Zeile, wie sie ist, und ein späterer Lauf versucht es erneut.
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
    blocks.push(serializeSigilCalc(createSigilCalcBlock(), {
      intention: row.intention_text ?? '',
      letters,
      implemented: implementedIn(letters, jsonLetters(row.implemented_letters)),
    }));
    const canvas = withSigilImage(createSigilCanvasBlock(), drawing);
    const loaded = Number(row.is_loaded) === 1;
    const hidden = Number(row.show_sigil) === 0 && !loaded;
    blocks.push(hidden ? { ...canvas, attrs: { ...canvas.attrs, [BLOCK_ATTR.hidden]: hiddenAttrValue(true)! } } : canvas);

    // Fehlt der Artikel (etwa ein Import ohne Wiki), bleibt der Verweis als
    // Chip mit seiner ID stehen — ein späterer Wiki-Import löst ihn wieder auf.
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
    blocks.push(serializeSigilCharge(createSigilChargeBlock(), {
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

/** Gibt es Zeilen, die die Umwandlung anfassen würde? Für die Sicherung vor v42. */
export async function hasLegacySigilRows(db: Database): Promise<boolean> {
  const [row] = await db.select<{ n: number }[]>(
    `SELECT COUNT(*) AS n FROM operations WHERE category_id = $1 OR ${LEGACY_DATA}`,
    [SIGIL_CATEGORY_ID]
  );
  return (row?.n ?? 0) > 0;
}

/**
 * Wandelt Operationszeilen mit Sigillen-Altdaten um. `includeSigilCategory`
 * nimmt auch leere Operationen der Kategorie „Sigillen" mit (nur v42).
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
