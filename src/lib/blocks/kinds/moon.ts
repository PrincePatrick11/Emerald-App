import { Moon } from 'lucide-react';
import { MOON_PHASE_SYMBOLS } from '../../moonPhase';
import type { BlockTypeDef } from '../blockType';
import { createMoonBlock, MOON_BLOCK_TYPE, moonBlockLabelKey, moonPhaseIn, moonPhaseValue } from '../moon';
import { blockTypeTextKey } from '../toolkit';

/**
 * The moon phase block (`lib/blocks/moon.ts`) through its interfaces: the
 * phase of the entry's day suggested as the entry's icon (the user's own
 * icon comes first), as a row of the properties panel, in the long info
 * line (the short one already shows it as the icon) and the export, and as
 * a value to filter by. It stores nothing, so it has no data to break,
 * copy or point at.
 */

const PHASE = { key: 'moon.phase', labelKey: moonBlockLabelKey, icon: Moon } as const;

/** The type's marker in the raw content — the cheap pre-check of lists. */
const mayHold = (content: string) => content.includes(MOON_BLOCK_TYPE);

export const moonBlockType: BlockTypeDef = {
  id: MOON_BLOCK_TYPE,
  origin: 'core',
  icon: Moon,
  labelKey: PHASE.labelKey,
  descriptionKey: blockTypeTextKey(MOON_BLOCK_TYPE, 'description'),
  group: 'moon',
  dataVersion: 1,
  // Symbol and name say what it is.
  defaultShowTitle: false,
  presets: [{
    id: 'moon', labelKey: PHASE.labelKey, descriptionKey: blockTypeTextKey(MOON_BLOCK_TYPE, 'description'),
    icon: Moon, group: 'moon', create: createMoonBlock,
  }],
  listInfo: {
    mayContribute: mayHold,
    parts: (_block, ctx) => {
      const phase = moonPhaseIn(ctx);
      return phase ? [{ ...PHASE, rank: 0, value: moonPhaseValue(phase), forms: ['long'] }] : [];
    },
  },
  properties: {
    mayContribute: mayHold,
    rows: (_block, ctx) => {
      const phase = moonPhaseIn(ctx);
      return phase ? [{ ...PHASE, value: moonPhaseValue(phase) }] : [];
    },
    icon: (_block, ctx) => {
      const phase = moonPhaseIn(ctx);
      return phase ? MOON_PHASE_SYMBOLS[phase] : null;
    },
    // The user's own icon wins; `cover` is moot, the block suggests none.
    overridable: { icon: true, cover: true },
  },
  values: {
    mayContribute: mayHold,
    read: (_block, ctx) => {
      const phase = moonPhaseIn(ctx);
      return phase ? [{ key: PHASE.key, labelKey: PHASE.labelKey, value: moonPhaseValue(phase), filter: true, sort: false }] : [];
    },
  },
  export: (_block, ctx) => {
    const phase = moonPhaseIn(ctx);
    return phase ? [{ kind: 'row', labelKey: PHASE.labelKey, value: moonPhaseValue(phase) }] : [];
  },
};
