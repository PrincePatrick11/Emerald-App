import { Link2 } from 'lucide-react';
import { isRecord } from '../../helpers';
import { internalLinkChipHtml, isValidLinkTarget, linkTargetKindOf } from '../../internalLinkHtml';
import type { LinkTargetKind } from '../../../types';
import { linkFromSlot, normalizeLinkCategoryFilter } from '../toolkit';
import { storedString, type FieldKindDef, type LinkElement } from './fieldKind';

/** A link's prefill: the target together with its name at the time of selection. */
interface LinkDefault {
  id: string;
  targetKind: LinkTargetKind;
  label: string;
}

function parseLinkDefault(raw: unknown): LinkDefault | undefined {
  if (!isRecord(raw) || !isValidLinkTarget(raw)) return undefined;
  return {
    id: raw.id as string,
    // `isValidLinkTarget` has checked the kind against the list.
    targetKind: linkTargetKindOf(String(raw.targetKind)),
    label: typeof raw.label === 'string' ? raw.label : '',
  };
}

/** Link: an entry or task, as a real link chip in the slot — the link table and backlinks see it like any other. */
export const linkFieldKind: FieldKindDef<LinkElement> = {
  id: 'link',
  icon: Link2,
  labelKey: 'blocks.kinds.link',
  presetGroup: 'reference',
  dataVersion: 1,
  storage: 'slot',
  parseConfig: (raw) => {
    if (!isRecord(raw.linkCategories)) return {};
    const ids = Array.isArray(raw.linkCategories.categoryIds)
      ? raw.linkCategories.categoryIds.filter((i): i is string => typeof i === 'string')
      : [];
    const filter = normalizeLinkCategoryFilter({ categoryIds: ids, includeUncategorized: raw.linkCategories.includeUncategorized === true });
    return filter ? { linkCategories: filter } : {};
  },
  isEmpty: ({ stored }) => !stored,
  uses: ['info', 'panel', 'values'],
  startUses: ['panel', 'values'],
  sortable: true,
  value: ({ stored }) => {
    const link = linkFromSlot(storedString(stored));
    return link ? { kind: 'link', id: link.id, targetKind: link.targetKind, label: link.label } : null;
  },
  exportValue: ({ stored }) => ({ kind: 'html', html: storedString(stored) ?? '' }),
  withoutLink: (slot, target) => (linkFromSlot(slot)?.id === target ? null : undefined),
  prefill: {
    parse: parseLinkDefault,
    toStored: (prefill) => internalLinkChipHtml(prefill as LinkDefault),
    fromStored: (stored) => parseLinkDefault(linkFromSlot(storedString(stored))),
    refs: (prefill, report) => report.entry((prefill as LinkDefault).id, 'default'),
    remap: (raw, map) => {
      if (!isRecord(raw) || typeof raw.id !== 'string') return raw;
      const target = map.link({
        id: raw.id,
        targetKind: typeof raw.targetKind === 'string' ? raw.targetKind : '',
        label: typeof raw.label === 'string' ? raw.label : '',
      });
      if (!target) return undefined;
      return { ...raw, id: target.id, label: target.label, ...(target.targetKind ? { targetKind: target.targetKind } : {}) };
    },
  },
};
