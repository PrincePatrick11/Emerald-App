import type { LucideIcon } from 'lucide-react';
import { parseFields, type ElementDef, type ElementKind, type FieldsModel } from './fields';
import { chargeListInfo, SIGIL_CHARGE_KIND } from './sigil';
import { isBlockHidden } from './blockAttrs';
import type { BlockInstance } from './types';

/**
 * What a block adds to the info line of its entry in lists (dashboard rows
 * and cards, under a tag, the left list) — after category and date. The
 * block decides; the lists only show what comes back. Pure data: the lists
 * word and format it, long ("Target date: Dec 12, 2026") or, in the narrow
 * left list, short (icon and "Dec 12", the long form as its tooltip).
 */
export interface ListInfoPart {
  /** One part per key and entry: of several, the one with the lowest `rank` (then the first) is shown. */
  key: string;
  rank: number;
  /** For the short form. */
  icon: LucideIcon;
  /** The i18n key of the label of the long form. */
  labelKey: string;
  /** `null`: the block holds the key but has nothing to show (and keeps a lower-ranked part out). */
  value: ListInfoValue | null;
}

export type ListInfoValue = { kind: 'date'; iso: string } | { kind: 'text'; text: string };

/** A part the lists show: `pickListInfo` has left out those without a value. */
export type ShownListInfoPart = ListInfoPart & { value: ListInfoValue };

/** What a block type registers (`BlockTypeDef.listInfo`). */
export interface ListInfoProvider {
  /** The cheap pre-check on the raw content: can it hold anything for this type? Lists stay fast because most entries fail it. */
  mayContribute: (content: string) => boolean;
  /** Asked about a hidden block (the eye) too — otherwise a hidden block adds nothing. */
  evenWhenHidden?: boolean;
  parts: (block: BlockInstance, today: string) => ListInfoPart[];
}

/** The same for a kind of field inside a fields block; the kind's name is its pre-check marker. */
interface ElementListInfo {
  /** As `ListInfoProvider.evenWhenHidden`: also when its block is hidden. */
  evenWhenHidden?: boolean;
  parts: (block: BlockInstance, element: ElementDef, model: FieldsModel, today: string) => ListInfoPart[];
}

const ELEMENT_LIST_INFO: Partial<Record<ElementKind, ElementListInfo>> = {
  // A hidden sigil keeps showing its target date — the date matters most then.
  [SIGIL_CHARGE_KIND]: { evenWhenHidden: true, parts: chargeListInfo },
};

// Bare kind names, as `mayHoldSigil` does: quotes are encoded differently depending on the source.
const ELEMENT_MARKERS = Object.keys(ELEMENT_LIST_INFO);

/**
 * A fields block hands the question on to its fields — archived ones say
 * nothing, and in a hidden block only the kinds that speak even then.
 */
export const fieldsListInfo: ListInfoProvider = {
  mayContribute: (content) => ELEMENT_MARKERS.some((m) => content.includes(m)),
  // Asked always; whether a hidden block speaks is each field kind's own `evenWhenHidden`.
  evenWhenHidden: true,
  parts: (block, today) => {
    const model = parseFields(block);
    if (model.broken) return [];
    const hidden = isBlockHidden(block);
    return model.elements.flatMap((element) => {
      const info = ELEMENT_LIST_INFO[element.kind];
      if (!info || element.archived || (hidden && !info.evenWhenHidden)) return [];
      return info.parts(block, element, model, today);
    });
  },
};

/** Of the parts in stack order: per key the lowest rank, the first among equals; keys in order of appearance. */
export function pickListInfo(parts: readonly ListInfoPart[]): ShownListInfoPart[] {
  const best = new Map<string, ListInfoPart>();
  for (const part of parts) {
    const held = best.get(part.key);
    if (!held || part.rank < held.rank) best.set(part.key, part);
  }
  return [...best.values()].filter((part): part is ShownListInfoPart => part.value !== null);
}
