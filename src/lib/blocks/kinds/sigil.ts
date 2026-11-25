import { CalendarClock, Sparkles } from 'lucide-react';
import type { BlockExportPart, BlockTypeDef, ReadContext } from '../blockType';
import type { ListInfoPart } from '../listInfo';
import { drawingImage } from '../paint';
import { htmlPlainText } from '../plainText';
import {
  isSigilBroken, parseSigilCharge, shownSigilParts, sigilEffect, sigilPartBlock, sigilPartId, sigilTargetDate,
  SIGIL_BLOCK_TYPE, SIGIL_SETTINGS, type SigilPartName,
} from '../sigil';
import { blockTypeTextKey, type RefReporter } from '../toolkit';
import { BLOCK_ATTR, type BlockInstance } from '../types';
import { reportDrawing } from './paint';

/**
 * The sigil block (`lib/blocks/sigil.ts`) through its interfaces: the
 * target date in the info line (also while hidden), as a panel row and as a
 * value to sort and filter by; the charge's effect on the entry; search and
 * export without what the charge conceals; its references. A copy needs
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
 * The parts the block shows and does not conceal today. Only its own charge
 * conceals a sigil's parts, so its own effect is enough here — the view reads
 * the same answer from the entry's folded effects.
 */
function visibleParts(block: BlockInstance, ctx: ReadContext): Record<SigilPartName, boolean> {
  const shown = shownSigilParts(block);
  const concealed = ctx.revealAll ? undefined : sigilEffect(block, ctx.today).concealed;
  const visible = (part: SigilPartName) => shown[part] && !concealed?.has(sigilPartId(block.id, part));
  return { calc: visible('calc'), drawing: visible('drawing'), charge: visible('charge') };
}

function sigilSearchText(block: BlockInstance, ctx: ReadContext): string {
  if (isSigilBroken(block)) return htmlPlainText(block.html);
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
  report.markup(sigilPartBlock(block, 'charge').html);
  // An unreadable block keeps what its JSON names, so no picture of it goes unseen.
  if (isSigilBroken(block)) report.imagesIn(block.attrs[BLOCK_ATTR.data], 'default');
}

const partHeading = (part: SigilPartName): BlockExportPart => ({ kind: 'heading', labelKey: `blocks.types.sigil.parts.${part}` });

function sigilExport(block: BlockInstance, ctx: ReadContext): BlockExportPart[] {
  // Unreadable: its markup, as read mode shows it (an unreadable sigil conceals nothing).
  if (isSigilBroken(block)) return block.html ? [{ kind: 'html', html: block.html }] : [];
  const visible = visibleParts(block, ctx);
  const parts: BlockExportPart[] = [];
  const calc = visible.calc ? sigilPartBlock(block, 'calc').html : '';
  // The calculator's stored markup is already its read version (intention, letters).
  if (calc) parts.push(partHeading('calc'), { kind: 'html', html: calc });
  const drawing = visible.drawing ? drawingImage(sigilPartBlock(block, 'drawing')) : null;
  if (drawing) parts.push(partHeading('drawing'), { kind: 'image', file: drawing, altKey: 'blocks.types.sigil.parts.drawing' });
  if (visible.charge) {
    const charge = parseSigilCharge(sigilPartBlock(block, 'charge'));
    if (!charge.broken) {
      parts.push(
        partHeading('charge'),
        { kind: 'row', labelKey: 'creation.targetDate', value: charge.revealDate ? { kind: 'date', iso: charge.revealDate } : null },
        { kind: 'row', labelKey: 'creation.chargingTechnique', value: charge.technique ? { kind: 'html', html: charge.technique } : null },
        { kind: 'note', textKey: charge.loaded ? 'blocks.sigil.loaded' : 'blocks.sigil.notLoaded' },
      );
    }
  }
  return parts;
}

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
  settings: SIGIL_SETTINGS,
};
