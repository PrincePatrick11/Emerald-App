import { ListChecks } from 'lucide-react';
import { generateId, isRecord } from '../../helpers';
import { escapeHtml } from '../../internalLinkHtml';
import type { FieldKindDef } from './fieldKind';

export interface ChecklistItem {
  id: string;
  text: string;
  checked: boolean;
}

function parseItems(raw: unknown): ChecklistItem[] | undefined {
  return Array.isArray(raw)
    ? raw
        .filter((i): i is Record<string, unknown> => isRecord(i) && typeof i.id === 'string')
        .map((i) => ({ id: i.id as string, text: typeof i.text === 'string' ? i.text : '', checked: i.checked === true }))
    : undefined;
}

/** A checklist as readable markup — fallback and export alike. */
export function checklistHtml(items: readonly ChecklistItem[]): string {
  return `<ul>${items.map((item) => `<li>${item.checked ? '☑' : '☐'} ${escapeHtml(item.text)}</li>`).join('')}</ul>`;
}

/** Checklist: items with text and tick in the JSON; shown outside the block as "done/all". */
export const checklistFieldKind: FieldKindDef = {
  id: 'checklist',
  icon: ListChecks,
  labelKey: 'blocks.kinds.checklist',
  presetGroup: 'fields',
  dataVersion: 1,
  storage: 'value',
  parseValue: parseItems,
  isEmpty: ({ stored }) => !Array.isArray(stored) || stored.length === 0,
  uses: ['info', 'panel', 'values'],
  startUses: ['panel'],
  // "done/all" is no order: a checklist filters, it does not sort.
  sortable: false,
  fallbackHtml: ({ stored }) => checklistHtml(stored as ChecklistItem[]),
  value: ({ stored }) => {
    const items = stored as ChecklistItem[];
    return { kind: 'text', text: `${items.filter((i) => i.checked).length}/${items.length}` };
  },
  exportValue: ({ stored }) => ({ kind: 'html', html: checklistHtml(stored as ChecklistItem[]) }),
  prefill: {
    parse: parseItems,
    // A copy gets its own item IDs, so that two copies do not carry the same ones.
    toStored: (prefill, _element, fresh) => (fresh ? (prefill as ChecklistItem[]).map((item) => ({ ...item, id: generateId() })) : prefill),
    fromStored: (stored) => stored,
  },
};
