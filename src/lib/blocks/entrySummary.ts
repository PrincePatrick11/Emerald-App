import { parseBlocks } from './blockHtml';
import { isBlockHidden } from './blockAttrs';
import { isDrawingUnitType, mayHoldSigil, sigilState, sigilUnits, todayIso, type SigilState } from './sigil';
import { drawingImage } from './paint';

/**
 * What lists, sidebar and menu want to know about the blocks
 * of an entry without opening it — parsed from the `content` that the stores
 * keep in memory anyway, once per content state (and day).
 */
export interface EntryBlockSummary {
  /** The entry's sigil together with the file name of the first visible, non-concealed drawing (cards) — `null` without sigil blocks. */
  sigil: (SigilState & { image: string | null }) | null;
}

const EMPTY: EntryBlockSummary = { sigil: null };

const cache = new Map<string, { content: string; day: string; summary: EntryBlockSummary }>();

function summarize(content: string, today: string): EntryBlockSummary {
  // The vast majority of entries have no sigil blocks — then do not parse at all.
  if (!mayHoldSigil(content)) return EMPTY;
  const blocks = parseBlocks(content);

  const units = sigilUnits(blocks);
  if (units.length === 0) return EMPTY;
  const state = sigilState(blocks, today);
  // The first visible drawing, block or part — a part counts as visible if its block is.
  const canvas = units.find(({ block, part }) =>
    isDrawingUnitType(block.type) && !isBlockHidden(part?.parent ?? block) && !part?.element.archived
      && !state.concealed.has(block.id) && drawingImage(block));
  return { sigil: { ...state, image: canvas ? drawingImage(canvas.block) : null } };
}

/** The summary of an entry; the same content is not parsed twice on the same day. */
export function entryBlockSummary(id: string, content: string, today = todayIso()): EntryBlockSummary {
  const hit = cache.get(id);
  if (hit?.content === content && hit.day === today) return hit.summary;
  const summary = summarize(content, today);
  cache.set(id, { content, day: today, summary });
  return summary;
}

/** On vault switch and after an import: the earlier IDs do not come back. */
export function clearEntrySummaryCache(): void {
  cache.clear();
}
