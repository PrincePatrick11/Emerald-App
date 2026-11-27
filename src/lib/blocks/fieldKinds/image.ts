import { Image } from 'lucide-react';
import { escapeHtml } from '../../internalLinkHtml';
import { storedImageName } from '../../schema';
import { imageFromSlot } from '../toolkit';
import { storedString, type FieldKindDef } from './fieldKind';

/** The slot of an image field: a real `<img src>` — that is how the image cleanup finds the file. */
export function imageSlotHtml(filename: string): string {
  return `<img src="${escapeHtml(filename)}">`;
}

const parseFile = (raw: unknown): string | undefined => (typeof raw === 'string' ? storedImageName(raw) ?? undefined : undefined);

/** Image: a stored picture as `<img src>` in the slot. It has no value to show or filter by outside its block. */
export const imageFieldKind: FieldKindDef = {
  id: 'image',
  icon: Image,
  labelKey: 'blocks.kinds.image',
  presetGroup: 'media',
  dataVersion: 1,
  storage: 'slot',
  isEmpty: ({ stored }) => !stored,
  uses: [],
  startUses: [],
  sortable: false,
  value: () => null,
  exportValue: ({ stored }) => {
    const file = imageFromSlot(storedString(stored));
    // Named after its row.
    return file ? { kind: 'image', file } : null;
  },
  prefill: {
    parse: parseFile,
    toStored: (prefill) => imageSlotHtml(prefill as string),
    fromStored: (stored) => parseFile(imageFromSlot(storedString(stored))),
    refs: (prefill, report) => report.image(prefill as string, 'default'),
    remap: (raw, map) => (typeof raw === 'string' ? map.image(raw) : raw),
  },
};
