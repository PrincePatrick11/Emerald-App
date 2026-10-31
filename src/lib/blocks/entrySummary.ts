import { parseBlocks } from './blockHtml';
import { isBlockHidden } from './blockAttrs';
import { blockOrigin } from './definitions';
import { activeElements, isElementEmpty, isSigilKind, isSlotKind, parseFields, type FieldValue } from './fields';
import { mayHoldSigil, SIGIL_CANVAS_TYPE, sigilImage, sigilState, sigilUnits, todayIso, type SigilState } from './sigil';
import { templateOriginsOf } from './templates';
import { BLOCK_ATTR } from './types';

/**
 * What lists, sidebar, menu and the blocks view want to know about the blocks
 * of an entry without opening it — parsed from the `content` that the stores
 * keep in memory anyway, once per content state (and day).
 */
export interface EntryBlockSummary {
  /** Every copy of a custom block: definition and revision. */
  origins: { id: string; rev: number }[];
  /**
   * Scalar field values of the copies under `"<definition>:<element>"` — the
   * basis for later filtering and showing block values in lists.
   * Element IDs are the same in all copies of a definition, so a filter
   * finds every copy, whatever its version.
   */
  fieldValues: Record<string, FieldValue>;
  /** The templates that blocks of the entry come from — each one once. */
  templates: string[];
  /** The entry's sigil together with the file name of the first visible, non-concealed drawing (cards) — `null` without sigil blocks. */
  sigil: (SigilState & { image: string | null }) | null;
}

const EMPTY: EntryBlockSummary = { origins: [], fieldValues: {}, templates: [], sigil: null };

const cache = new Map<string, { content: string; day: string; summary: EntryBlockSummary }>();

function summarize(content: string, today: string): EntryBlockSummary {
  const hasOrigins = content.includes(BLOCK_ATTR.origin);
  const hasSigil = mayHoldSigil(content);
  const hasTemplates = content.includes(BLOCK_ATTR.template);
  // The vast majority of entries have neither custom nor sigil blocks nor a template — then do not parse at all.
  if (!hasOrigins && !hasSigil && !hasTemplates) return EMPTY;
  const blocks = parseBlocks(content);

  const origins: EntryBlockSummary['origins'] = [];
  const fieldValues: Record<string, FieldValue> = Object.create(null);
  if (hasOrigins) {
    for (const block of blocks) {
      const origin = blockOrigin(block);
      if (!origin) continue;
      origins.push(origin);
      const model = parseFields(block);
      if (model.broken) continue;
      for (const element of activeElements(model)) {
        if (isSlotKind(element.kind) || isSigilKind(element.kind) || isElementEmpty(element, model)) continue;
        const key = `${origin.id}:${element.id}`;
        if (!(key in fieldValues)) fieldValues[key] = model.values[element.id];
      }
    }
  }

  let sigil: EntryBlockSummary['sigil'] = null;
  if (hasSigil) {
    const units = sigilUnits(blocks);
    if (units.length > 0) {
      const state = sigilState(blocks, today);
      // The first visible drawing, block or part — a part counts as visible if its block is.
      const canvas = units.find(({ block, part }) =>
        block.type === SIGIL_CANVAS_TYPE && !isBlockHidden(part?.parent ?? block) && !part?.element.archived
          && !state.concealed.has(block.id) && sigilImage(block));
      sigil = { ...state, image: canvas ? sigilImage(canvas.block) : null };
    }
  }
  return { origins, fieldValues, templates: hasTemplates ? templateOriginsOf(blocks) : [], sigil };
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
