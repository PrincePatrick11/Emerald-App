import { ToggleLeft } from 'lucide-react';
import { escapeHtml } from '../../internalLinkHtml';
import { translatedOr } from '../toolkit';
import type { FieldKindDef } from './fieldKind';
import { plainPrefill } from './prefill';

const parseBool = (raw: unknown): boolean | undefined => (typeof raw === 'boolean' ? raw : undefined);

/**
 * Yes/no: a boolean in the JSON. Never empty — unset means "no", so input,
 * read mode and fallback show the same, and there is no "hide when empty".
 */
export const toggleFieldKind: FieldKindDef = {
  id: 'toggle',
  icon: ToggleLeft,
  labelKey: 'blocks.kinds.toggle',
  presetGroup: 'fields',
  dataVersion: 1,
  storage: 'value',
  parseValue: parseBool,
  isEmpty: () => false,
  canBeEmpty: false,
  uses: ['info', 'panel', 'values'],
  startUses: ['panel', 'values'],
  sortable: true,
  fallbackHtml: ({ stored }, text) => escapeHtml(stored === true
    ? translatedOr(text.t, 'blocks.fields.yes', 'Yes')
    : translatedOr(text.t, 'blocks.fields.no', 'No')),
  value: ({ stored }) => ({ kind: 'bool', value: stored === true }),
  // Whoever prefills wants "yes": "no" it is already.
  prefill: { ...plainPrefill(parseBool), startValue: true },
};
