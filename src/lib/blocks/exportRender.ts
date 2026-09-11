import { escapeHtml } from '../internalLinkHtml';
import { isBlockHidden, showsTitleInRead } from './blockAttrs';
import { parseBlocks } from './blockHtml';
import { resolveBlockType, type BlockTypeMeta } from './blockTypes';
import {
  FIELDS_BLOCK_TYPE, fieldValueHtml, imageFromSlot, isHiddenInRead, isSigilKind, isSlotKind, linkFromSlot, parseFields,
  type ElementDef, type FallbackText, type FieldsModel,
} from './fields';
import {
  parseSigilCharge, sigilImage, sigilPartBlock, sigilState, SIGIL_CALC_TYPE, SIGIL_CANVAS_TYPE, SIGIL_CHARGE_TYPE,
  withoutConcealedParts,
  todayIso,
} from './sigil';
import { TEXT_BLOCK_TYPE, type BlockInstance } from './types';

/**
 * Die Blöcke eines Eintrags als HTML für PDF und Markdown — ein Serializer je
 * Typ, nach denselben Regeln wie der Lesemodus:
 * - ausgeblendete Blöcke (das Auge) fehlen,
 * - Rechner und Zeichnungen, die eine geladene Sigille noch verbirgt, fehlen,
 * - ein Altar-Feld zeigt das Vorschaubild des Altars und seinen Link-Chip,
 * - Feldblöcke zeigen nur, was der Lesemodus zeigt (archivierte und — nach
 *   der Anzeigeregel — leere Felder nicht), Datum und Zahl formatiert,
 * - der Blocktitel steht als Überschrift, wo der Lesemodus ihn zeigt,
 * - ein Block, der dabei leer bleibt, fehlt ganz.
 *
 * Heraus kommt schlichtes HTML ohne `<section>`: danach laufen die üblichen
 * Export-Schritte (DOMPurify, Bilder einbetten, Link-Chips, Turndown). Die
 * Bilder der Blöcke (Zeichnung, Bildfeld) tragen ihre Beschriftung als Alt-Text
 * und `data-export-placeholder` — im Markdown bleibt sie an ihrer Stelle stehen.
 *
 * Rein und DOM-frei; die Texte (Sprache, Formate) reicht der Aufrufer herein.
 */

export interface ExportText {
  /** Wie der Block heißt (`blockLabel` mit `t`). */
  title: (block: BlockInstance, meta: BlockTypeMeta | undefined) => string;
  fields: FallbackText;
  /** Ein `YYYY-MM-DD` für Menschen. */
  date: (iso: string) => string;
  number: (value: number) => string;
  targetDate: string;
  technique: string;
  loaded: string;
  notLoaded: string;
  /** Beschriftung der Zeichnung — im Markdown der Platzhalter an ihrer Stelle. */
  drawing: string;
  /** Ein Altar mit seinem gespeicherten Vorschaubild (Dateiname oder data-URL) — `null`, wenn es ihn nicht mehr gibt. */
  altar: (altarId: string) => { title: string; image: string | null } | null;
}

function row(label: string, valueHtml: string): string {
  return `<dt>${escapeHtml(label)}</dt><dd>${valueHtml}</dd>`;
}

function imageHtml(src: string, label: string): string {
  return `<img src="${escapeHtml(src)}" alt="${escapeHtml(label)}" data-export-placeholder="1">`;
}

function fieldValue(element: ElementDef, model: FieldsModel, text: ExportText): string | null {
  const value = model.values[element.id];
  switch (element.kind) {
    case 'image': {
      const filename = imageFromSlot(model.slots[element.id]);
      return filename ? imageHtml(filename, text.fields.label(element)) : null;
    }
    case 'link':
      return model.slots[element.id] ?? null;
    case 'altar': {
      const slot = model.slots[element.id];
      if (!slot) return null;
      // Das Bild trägt den aktuellen Namen, wie der Lesemodus; ein gelöschter Altar bleibt beim Chip.
      const link = linkFromSlot(slot);
      const altar = link?.entryType === 'altar' ? text.altar(link.id) : null;
      const image = altar?.image ? imageHtml(altar.image, altar.title || link!.label) : '';
      return `${image}${slot}`;
    }
    case 'date':
      return typeof value === 'string' && value.trim() ? escapeHtml(text.date(value)) : null;
    case 'number':
      return typeof value === 'number' ? escapeHtml(text.number(value)) : null;
    default:
      return isSlotKind(element.kind) ? null : fieldValueHtml(element, model, text.fields);
  }
}

function fieldsHtml(block: BlockInstance, text: ExportText, concealed: ReadonlyMap<string, string | null>): string {
  const model = parseFields(block);
  if (model.broken) return block.html;
  const rows = model.elements
    .filter((element) => !isHiddenInRead(element, model))
    .flatMap((element) => {
      if (!isSigilKind(element.kind)) return [row(text.fields.label(element), fieldValue(element, model, text) ?? '—')];
      // Ein Sigillen-Teil wie der Block gleicher Art — verborgen fehlt er ganz.
      const part = sigilPartBlock(block, { ...element, kind: element.kind }, model);
      if (concealed.has(part.id)) return [];
      const body = sigilHtml(part, text);
      return body.trim() ? [row(text.fields.label(element), body)] : [];
    });
  return rows.length ? `<dl>${rows.join('')}</dl>` : '';
}

/** Rechner, Zeichnung oder Ladung — als Block wie als Teil eines eigenen Blocks. */
function sigilHtml(block: BlockInstance, text: ExportText): string {
  switch (block.type) {
    case SIGIL_CANVAS_TYPE: {
      const image = sigilImage(block);
      return image ? imageHtml(image, text.drawing) : '';
    }
    case SIGIL_CHARGE_TYPE:
      return chargeHtml(block, text);
    default: // Rechner: sein gespeicherter Fallback ist schon die Lesefassung (Absicht, Buchstaben).
      return block.html;
  }
}

function chargeHtml(block: BlockInstance, text: ExportText): string {
  const charge = parseSigilCharge(block);
  if (charge.broken) return block.html;
  return `<dl>${row(text.targetDate, charge.revealDate ? escapeHtml(text.date(charge.revealDate)) : '—')}`
    + `${row(text.technique, charge.technique ?? '—')}</dl>`
    + `<p>${escapeHtml(charge.loaded ? text.loaded : text.notLoaded)}</p>`;
}

function bodyHtml(
  block: BlockInstance,
  meta: BlockTypeMeta | undefined,
  text: ExportText,
  concealed: ReadonlyMap<string, string | null>,
): string {
  switch (meta?.id) {
    case FIELDS_BLOCK_TYPE:
      return fieldsHtml(block, text, concealed);
    case SIGIL_CALC_TYPE:
    case SIGIL_CANVAS_TYPE:
    case SIGIL_CHARGE_TYPE:
      return sigilHtml(block, text);
    case TEXT_BLOCK_TYPE:
    default: // Unbekannter Typ oder zu neues Format: der gespeicherte Fallback.
      return block.html;
  }
}

export function renderBlocksForExport(content: string, text: ExportText, today = todayIso()): string {
  const blocks = parseBlocks(content);
  const { concealed } = sigilState(blocks, today);
  const parts: string[] = [];
  for (const original of blocks) {
    if (isBlockHidden(original) || concealed.has(original.id)) continue;
    // Auch der Fallback eines Feldblocks (zu neues Format) ohne verborgene Teile.
    const block = withoutConcealedParts(original, concealed);
    const meta = resolveBlockType(block);
    const body = bodyHtml(block, meta, text, concealed);
    if (!body.trim()) continue;
    const title = showsTitleInRead(block, meta) ? `<h3>${escapeHtml(text.title(block, meta))}</h3>` : '';
    parts.push(title + body);
  }
  return parts.join('');
}
