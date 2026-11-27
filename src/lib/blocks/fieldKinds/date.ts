import { Calendar } from 'lucide-react';
import { escapeHtml } from '../../internalLinkHtml';
import { storedString, type FieldKindDef } from './fieldKind';
import { plainPrefill } from './prefill';

/** Date: a `yyyy-MM-dd` string in the JSON. */
export const dateFieldKind: FieldKindDef = {
  id: 'date',
  icon: Calendar,
  labelKey: 'blocks.kinds.date',
  presetGroup: 'fields',
  dataVersion: 1,
  storage: 'value',
  parseValue: storedString,
  isEmpty: ({ stored }) => !storedString(stored)?.trim(),
  uses: ['info', 'panel', 'values'],
  startUses: ['panel', 'values'],
  sortable: true,
  fallbackHtml: ({ stored }) => escapeHtml(stored as string),
  value: ({ stored }) => ({ kind: 'date', iso: stored as string }),
  prefill: plainPrefill(storedString),
};
