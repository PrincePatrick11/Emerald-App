import type { TFunction } from 'i18next';
import { phraseText, type BlockValue } from './blocks/blockType';
import { linkValueTitle, type LinkTitleOf } from './blocks/blockValue';
import type { InfoForm } from './blocks/listInfo';
import { formatIsoDate, formatIsoDateShort } from './formatDate';
import i18n from '../i18n';

/**
 * A value a block delivers, worded for the app's display — the info line in
 * lists and the rows of the properties panel. Blocks hand over values, the
 * app words them; one place for it. `short`: as narrow as it gets (a date
 * without the current year), for the short info line. `titleOf` gives a
 * link its target's current title (`useLinkTitle`).
 */
export function blockValueText(t: TFunction, value: BlockValue, { form = 'long', titleOf }: { form?: InfoForm; titleOf?: LinkTitleOf } = {}): string {
  switch (value.kind) {
    case 'date': return form === 'short' ? formatIsoDateShort(value.iso) : formatIsoDate(value.iso);
    case 'text': return value.text;
    case 'number': return value.value.toLocaleString(i18n.language);
    case 'bool': return t(value.value ? 'blocks.fields.yes' : 'blocks.fields.no');
    case 'link': return linkValueTitle(value, titleOf);
    case 'phrase': return phraseText(value, t);
  }
}
