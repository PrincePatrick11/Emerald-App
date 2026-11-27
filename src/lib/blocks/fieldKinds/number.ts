import { Hash } from 'lucide-react';
import type { FieldKindDef } from './fieldKind';
import { plainPrefill } from './prefill';

const parseNumber = (raw: unknown): number | undefined => (typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined);

/** Number: a finite number in the JSON. */
export const numberFieldKind: FieldKindDef = {
  id: 'number',
  icon: Hash,
  labelKey: 'blocks.kinds.number',
  presetGroup: 'fields',
  dataVersion: 1,
  storage: 'value',
  parseValue: parseNumber,
  isEmpty: ({ stored }) => typeof stored !== 'number',
  uses: ['info', 'panel', 'values'],
  startUses: ['panel', 'values'],
  sortable: true,
  fallbackHtml: ({ stored }) => String(stored),
  value: ({ stored }) => ({ kind: 'number', value: stored as number }),
  prefill: plainPrefill(parseNumber),
};
