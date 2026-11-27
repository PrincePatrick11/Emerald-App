import { TextCursorInput } from 'lucide-react';
import { escapeHtml } from '../../internalLinkHtml';
import { storedString, type FieldKindDef } from './fieldKind';
import { plainPrefill } from './prefill';

/** Short text: one line, a string in the JSON. */
export const shorttextFieldKind: FieldKindDef = {
  id: 'shorttext',
  icon: TextCursorInput,
  labelKey: 'blocks.kinds.shorttext',
  presetGroup: 'fields',
  dataVersion: 1,
  storage: 'value',
  parseValue: storedString,
  isEmpty: ({ stored }) => !storedString(stored)?.trim(),
  uses: ['info', 'panel', 'values'],
  startUses: ['panel', 'values'],
  sortable: true,
  fallbackHtml: ({ stored }) => escapeHtml(stored as string),
  value: ({ stored }) => ({ kind: 'text', text: stored as string }),
  prefill: plainPrefill(storedString),
};
