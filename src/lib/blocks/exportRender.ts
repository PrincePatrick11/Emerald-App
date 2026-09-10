import { escapeHtml } from '../internalLinkHtml';
import { isBlockHidden, showsTitleInRead } from './blockAttrs';
import { parseBlocks } from './blockHtml';
import { resolveBlockType, type BlockTypeMeta } from './blockTypes';
import {
  FIELDS_BLOCK_TYPE, fieldValueHtml, imageFromSlot, isHiddenInRead, isSlotKind, parseFields,
  type ElementDef, type FallbackText, type FieldsModel,
} from './fields';
import {
  isSigilToolType, parseSigilCharge, sigilImage, sigilState, SIGIL_CALC_TYPE, SIGIL_CANVAS_TYPE, SIGIL_CHARGE_TYPE,
  todayIso,
} from './sigil';
import { TEXT_BLOCK_TYPE, type BlockInstance } from './types';

/**
 * Die Blöcke eines Eintrags als HTML für PDF und Markdown — ein Serializer je
 * Typ, nach denselben Regeln wie der Lesemodus:
 * - ausgeblendete Blöcke (das Auge) fehlen,
 * - Rechner und Zeichnung einer geladenen, noch verborgenen Sigille fehlen,
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
}

function row(label: string, valueHtml: string): string {
  return `<dt>${escapeHtml(label)}</dt><dd>${valueHtml}</dd>`;
}

function imageHtml(filename: string, label: string): string {
  return `<img src="${escapeHtml(filename)}" alt="${escapeHtml(label)}" data-export-placeholder="1">`;
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
    case 'date':
      return typeof value === 'string' && value.trim() ? escapeHtml(text.date(value)) : null;
    case 'number':
      return typeof value === 'number' ? escapeHtml(text.number(value)) : null;
    default:
      return isSlotKind(element.kind) ? null : fieldValueHtml(element, model, text.fields);
  }
}

function fieldsHtml(block: BlockInstance, text: ExportText): string {
  const model = parseFields(block);
  if (model.broken) return block.html;
  const rows = model.elements
    .filter((element) => !isHiddenInRead(element, model))
    .map((element) => row(text.fields.label(element), fieldValue(element, model, text) ?? '—'));
  return rows.length ? `<dl>${rows.join('')}</dl>` : '';
}

function chargeHtml(block: BlockInstance, text: ExportText): string {
  const charge = parseSigilCharge(block);
  if (charge.broken) return block.html;
  return `<dl>${row(text.targetDate, charge.revealDate ? escapeHtml(text.date(charge.revealDate)) : '—')}`
    + `${row(text.technique, charge.technique ?? '—')}</dl>`
    + `<p>${escapeHtml(charge.loaded ? text.loaded : text.notLoaded)}</p>`;
}

function bodyHtml(block: BlockInstance, meta: BlockTypeMeta | undefined, text: ExportText): string {
  switch (meta?.id) {
    case FIELDS_BLOCK_TYPE:
      return fieldsHtml(block, text);
    case SIGIL_CANVAS_TYPE: {
      const image = sigilImage(block);
      return image ? imageHtml(image, text.drawing) : '';
    }
    case SIGIL_CHARGE_TYPE:
      return chargeHtml(block, text);
    case TEXT_BLOCK_TYPE:
    case SIGIL_CALC_TYPE: // Sein gespeicherter Fallback ist schon die Lesefassung (Absicht, Buchstaben).
    default: // Unbekannter Typ oder zu neues Format: der gespeicherte Fallback.
      return block.html;
  }
}

export function renderBlocksForExport(content: string, text: ExportText, today = todayIso()): string {
  const blocks = parseBlocks(content);
  const concealed = sigilState(blocks, today).concealed;
  const parts: string[] = [];
  for (const block of blocks) {
    if (isBlockHidden(block) || (concealed && isSigilToolType(block.type))) continue;
    const meta = resolveBlockType(block);
    const body = bodyHtml(block, meta, text);
    if (!body.trim()) continue;
    const title = showsTitleInRead(block, meta) ? `<h3>${escapeHtml(text.title(block, meta))}</h3>` : '';
    parts.push(title + body);
  }
  return parts.join('');
}
