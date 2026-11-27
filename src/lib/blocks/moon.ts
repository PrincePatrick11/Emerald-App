import { generateId } from '../helpers';
import { createTextBlock } from './blockHtml';
import { MOON_PHASE_SYMBOLS, moonPhaseOfDay } from '../moonPhase';
import type { MoonPhase } from '../../types';
import type { BlockContext, BlockValue } from './blockType';
import { blockTypeTextKey } from './toolkit';
import type { BlockInstance, BlockTypeId } from './types';

/**
 * The moon phase block: the phase of the day its entry was created
 * (`BlockContext.entryDate`). Nothing stored, nothing to choose — it is
 * worked out wherever it is shown, so it follows the entry's date. Outside
 * an entry (a template) it has no phase.
 */
export const MOON_BLOCK_TYPE = 'core.moon' satisfies BlockTypeId;

/** The block's name — its label in menus and in its own row. */
export const moonBlockLabelKey = blockTypeTextKey(MOON_BLOCK_TYPE, 'label');

export function createMoonBlock(): BlockInstance {
  return { id: generateId(), type: MOON_BLOCK_TYPE, html: '', attrs: {} };
}

/** What the built-in journal and dream journal templates start with: the moon phase, then text. */
export function moonBlockSet(): BlockInstance[] {
  return [createMoonBlock(), createTextBlock()];
}

/** The phase where the block is — `null` outside an entry. */
export function moonPhaseIn(ctx: Pick<BlockContext, 'entryDate'>): MoonPhase | null {
  return moonPhaseOfDay(ctx.entryDate);
}

/** The text key of a phase's name (`moonPhase.<phase>` in the locale files). */
function moonPhaseKey(phase: MoonPhase): string {
  return `moonPhase.${phase}`;
}

/** The phase as a value the app words: its symbol, then its name. */
export function moonPhaseValue(phase: MoonPhase): Extract<BlockValue, { kind: 'phrase' }> {
  return { kind: 'phrase', key: moonPhaseKey(phase), symbol: MOON_PHASE_SYMBOLS[phase] };
}
