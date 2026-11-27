import { Type } from 'lucide-react';
import { extractInternalLinks, isBlankContent, withoutInternalLinksTo } from '../../internalLinkHtml';
import { htmlPlainText } from '../plainText';
import { storedString, type FieldKindDef } from './fieldKind';

/** How much of a long text the info line and the panel get. */
const LONG_TEXT_SHOWN = 120;

/**
 * Text: the shared text editor in a field, its HTML in the slot. It has no
 * prefill (that would be markup in the definition) and is not offered alone
 * in "Add block" — the text block is that.
 */
export const textFieldKind: FieldKindDef = {
  id: 'text',
  icon: Type,
  labelKey: 'blocks.kinds.text',
  dataVersion: 1,
  storage: 'slot',
  textEditor: true,
  // Visible content counts — an empty heading or an empty bullet point does not.
  isEmpty: ({ stored }) => isBlankContent(storedString(stored) ?? ''),
  // Shown in a line, never filtered by: its beginning is enough.
  uses: ['info', 'panel'],
  startUses: ['panel'],
  sortable: false,
  value: ({ stored }) => {
    // None if it holds only a rule or a picture.
    const text = htmlPlainText(storedString(stored) ?? '');
    if (!text) return null;
    return { kind: 'text', text: text.length > LONG_TEXT_SHOWN ? `${text.slice(0, LONG_TEXT_SHOWN).trimEnd()}…` : text };
  },
  exportValue: ({ stored }) => ({ kind: 'html', html: storedString(stored) ?? '' }),
  // A chip in the text turns into its word; the text stays.
  withoutLink: (slot, target) =>
    extractInternalLinks(slot).some((link) => link.id === target) ? withoutInternalLinksTo(slot, target) : undefined,
};
