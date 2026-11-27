import { CalendarClock, Sparkles, Wallpaper } from 'lucide-react';
import type { BlockActionDef, BlockExportPart, BlockTypeDef, ExportContext, ReadContext } from '../blockType';
import type { ListInfoPart } from '../listInfo';
import { drawingImage } from '../paint';
import { htmlPlainText } from '../plainText';
import {
  createSigilBlock, isSigilBroken, parseSigilCharge, serializeSigilCharge, shownSigilParts, sigilBackground, sigilEffect, sigilPartBlock, sigilPartId,
  sigilTargetDate, SIGIL_BACKGROUND_ACTION, SIGIL_BLOCK_TYPE, SIGIL_SETTINGS, withSigilPart, type SigilPartName,
} from '../sigil';
import { extractInternalLinks } from '../../internalLinkHtml';
import { backgroundFile, blockTypeTextKey, type RefReporter } from '../toolkit';
import type { BlockInstance } from '../types';
import { reportDrawing } from './paint';

/**
 * The sigil block (`lib/blocks/sigil.ts`) through its interfaces: the
 * target date in the info line (also while hidden), as a panel row and as a
 * value to sort and filter by; the charge's effect on the entry; search
 * without what the charge conceals, export with it covered in HTML and
 * left out elsewhere; its references. A copy needs
 * nothing of its own: what the charge locks and conceals is named by the
 * block's own ID, so a copy's charge acts on the copy's parts.
 */

const TARGET_DATE = { key: 'sigil.targetDate', labelKey: 'creation.targetDate', icon: CalendarClock } as const;

/** The type's marker in the raw content — the cheap pre-check of lists. */
const mayHold = (content: string) => content.includes(SIGIL_BLOCK_TYPE);

/** Of several sigils in an entry, a loaded one's date speaks first (`rank`), as in the info line. */
function rankedTargetDate(block: BlockInstance) {
  const target = sigilTargetDate(block);
  if (!target) return null;
  return { rank: target.loaded ? 0 : 1, value: target.iso ? { kind: 'date' as const, iso: target.iso } : null };
}

/**
 * The parts the block shows and does not conceal today, for the search. Only
 * its own charge conceals a sigil's parts, so its own effect is enough here —
 * the view and the export read the same answer from the entry's folded
 * effects (`ExportContext.concealed`).
 */
function visibleParts(block: BlockInstance, ctx: ReadContext): Record<SigilPartName, boolean> {
  const shown = shownSigilParts(block);
  const concealed = ctx.revealAll ? undefined : sigilEffect(block, ctx.today).concealed;
  const visible = (part: SigilPartName) => shown[part] && !concealed?.has(sigilPartId(block.id, part));
  return { calc: visible('calc'), drawing: visible('drawing'), charge: visible('charge') };
}

function sigilSearchText(block: BlockInstance, ctx: ReadContext): string {
  const visible = visibleParts(block, ctx);
  return (['calc', 'charge'] as const)
    .filter((part) => visible[part])
    .map((part) => htmlPlainText(sigilPartBlock(block, part).html))
    .filter(Boolean)
    .join(' ');
}

function sigilRefs(block: BlockInstance, report: RefReporter): void {
  // Switched off or concealed, a part still holds what it points at.
  reportDrawing(sigilPartBlock(block, 'drawing'), report);
  report.image(backgroundFile(sigilBackground(block)), 'background');
  report.markup(sigilPartBlock(block, 'charge').html);
}

/** The sigil without its charging technique if that links to `target`; charged state, date and lock stay as they are. */
function sigilWithoutLink(block: BlockInstance, target: string): BlockInstance {
  const part = sigilPartBlock(block, 'charge');
  const charge = parseSigilCharge(part);
  if (!extractInternalLinks(part.html).some((link) => link.id === target)) return block;
  const { broken: _broken, ...data } = charge;
  return withSigilPart(block, 'charge', serializeSigilCharge(part, { ...data, technique: null }));
}

const partLabelKey = (part: SigilPartName) => `blocks.types.sigil.parts.${part}`;
const partHeading = (part: SigilPartName): BlockExportPart => ({ kind: 'heading', labelKey: partLabelKey(part) });

/** Calculator or drawing as the export shows it, before concealing; empty if it holds nothing. */
function toolExport(block: BlockInstance, part: 'calc' | 'drawing'): BlockExportPart[] {
  const value = sigilPartBlock(block, part);
  if (part === 'calc') {
    // The calculator's stored markup is already its read version (intention, letters).
    return value.html ? [{ kind: 'html', html: value.html }] : [];
  }
  const drawing = drawingImage(value);
  return drawing ? [{ kind: 'image', file: drawing, altKey: partLabelKey('drawing') }] : [];
}

/**
 * The parts the block shows, as read mode shows them. What the charge
 * conceals today goes out as a `concealed` part: missing in PDF and
 * Markdown; in HTML there, covered under its heading as read mode covers it,
 * and the reader may uncover it — concealing a sigil is the user's own
 * discipline, not a lock.
 */
function sigilExport(block: BlockInstance, ctx: ExportContext): BlockExportPart[] {
  const shown = shownSigilParts(block);
  const parts: BlockExportPart[] = [];
  for (const part of ['calc', 'drawing'] as const) {
    if (!shown[part]) continue;
    const id = sigilPartId(block.id, part);
    const body = toolExport(block, part);
    if (!body.length) continue;
    if (ctx.concealed.has(id)) {
      parts.push({ kind: 'concealed', labelKey: partLabelKey(part), until: ctx.concealed.get(id) ?? null, parts: body });
    } else {
      parts.push(partHeading(part), ...body);
    }
  }
  // A loaded charge is never concealed (it must stay reachable to unload); the check is only a guard.
  if (shown.charge && !ctx.concealed.has(sigilPartId(block.id, 'charge'))) {
    const charge = parseSigilCharge(sigilPartBlock(block, 'charge'));
    parts.push(
      partHeading('charge'),
      { kind: 'row', labelKey: 'creation.targetDate', value: charge.revealDate ? { kind: 'date', iso: charge.revealDate } : null },
      { kind: 'row', labelKey: 'creation.chargingTechnique', value: charge.technique ? { kind: 'html', html: charge.technique } : null },
      { kind: 'note', textKey: charge.loaded ? 'blocks.sigil.loaded' : 'blocks.sigil.notLoaded' },
    );
  }
  return parts;
}

/**
 * "Background …" while editing, as long as the drawing shows and can be
 * painted on: a loaded sigil keeps its picture as it was charged.
 */
const SIGIL_ACTIONS: readonly BlockActionDef[] = [{
  id: SIGIL_BACKGROUND_ACTION,
  labelKey: 'blocks.sigil.background',
  icon: Wallpaper,
  inRead: false,
  available: (block) => shownSigilParts(block).drawing && !parseSigilCharge(sigilPartBlock(block, 'charge')).loaded,
}];

export const sigilBlockType: BlockTypeDef = {
  id: SIGIL_BLOCK_TYPE,
  origin: 'core',
  icon: Sparkles,
  labelKey: blockTypeTextKey(SIGIL_BLOCK_TYPE, 'label'),
  descriptionKey: blockTypeTextKey(SIGIL_BLOCK_TYPE, 'description'),
  group: 'sigil',
  dataVersion: 1,
  // Its parts carry their own headings.
  defaultShowTitle: false,
  presets: [{
    id: 'sigil', labelKey: blockTypeTextKey(SIGIL_BLOCK_TYPE, 'label'), descriptionKey: blockTypeTextKey(SIGIL_BLOCK_TYPE, 'description'),
    icon: Sparkles, group: 'sigil', create: createSigilBlock,
  }],
  isBroken: isSigilBroken,
  listInfo: {
    mayContribute: mayHold,
    // A hidden sigil keeps showing its target date — the date matters most then.
    evenWhenHidden: true,
    parts: (block): ListInfoPart[] => {
      const ranked = rankedTargetDate(block);
      return ranked ? [{ ...TARGET_DATE, ...ranked }] : [];
    },
  },
  properties: {
    mayContribute: mayHold,
    rows: (block) => {
      const iso = sigilTargetDate(block)?.iso;
      return iso ? [{ ...TARGET_DATE, value: { kind: 'date', iso } }] : [];
    },
    overridable: { icon: true, cover: true },
  },
  values: {
    mayContribute: mayHold,
    read: (block) => {
      const ranked = rankedTargetDate(block);
      return ranked ? [{ key: TARGET_DATE.key, labelKey: TARGET_DATE.labelKey, ...ranked, filter: true, sort: true }] : [];
    },
  },
  entryEffect: {
    mayContribute: mayHold,
    read: (block, _blocks, ctx) => sigilEffect(block, ctx.today),
  },
  export: sigilExport,
  searchText: sigilSearchText,
  refs: sigilRefs,
  withoutLink: sigilWithoutLink,
  actions: SIGIL_ACTIONS,
  settings: SIGIL_SETTINGS,
};
