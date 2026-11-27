import { ChevronsUpDown } from 'lucide-react';
import { isRecord } from '../../helpers';
import { escapeHtml } from '../../internalLinkHtml';
import { storedString, type FieldKindDef, type SelectElement, type SelectOption } from './fieldKind';
import { plainPrefill } from './prefill';

/** The option a field holds, if it still exists — a deleted option is no value. */
function chosen(element: SelectElement, stored: unknown): SelectOption | undefined {
  return element.options?.find((o) => o.id === stored);
}

/** Choice: one of the field's own options, stored by its ID (renaming loses nothing). */
export const selectFieldKind: FieldKindDef<SelectElement> = {
  id: 'select',
  icon: ChevronsUpDown,
  labelKey: 'blocks.kinds.select',
  presetGroup: 'fields',
  dataVersion: 1,
  storage: 'value',
  parseConfig: (raw) => (Array.isArray(raw.options)
    ? {
        options: raw.options
          .filter((o): o is Record<string, unknown> => isRecord(o) && typeof o.id === 'string')
          .map((o) => ({ id: o.id as string, label: typeof o.label === 'string' ? o.label : '' })),
      }
    : {}),
  initialConfig: () => ({ options: [] }),
  parseValue: storedString,
  isEmpty: ({ element, stored }) => typeof stored !== 'string' || !chosen(element, stored),
  uses: ['info', 'panel', 'values'],
  startUses: ['panel', 'values'],
  sortable: true,
  fallbackHtml: ({ element, stored }) => escapeHtml(chosen(element, stored)!.label),
  value: ({ element, stored }) => ({ kind: 'text', text: chosen(element, stored)!.label }),
  // A prefill only for an option that still exists — otherwise every copy would get a dead value.
  prefill: plainPrefill((raw, element) => (chosen(element, raw) ? storedString(raw) : undefined)),
};
