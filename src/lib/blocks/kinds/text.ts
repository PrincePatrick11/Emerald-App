import { Type } from 'lucide-react';
import type { BlockTypeDef } from '../blockType';
import { htmlPlainText } from '../plainText';
import { blockTypeTextKey, withoutImageInMarkup } from '../toolkit';
import { createTextBlock } from '../blockHtml';
import { TEXT_BLOCK_TYPE } from '../types';

/** The text block: TipTap HTML as the inner HTML of its section. Flows without a heading. */
export const textBlockType: BlockTypeDef = {
  id: TEXT_BLOCK_TYPE,
  origin: 'core',
  icon: Type,
  labelKey: blockTypeTextKey(TEXT_BLOCK_TYPE, 'label'),
  descriptionKey: blockTypeTextKey(TEXT_BLOCK_TYPE, 'description'),
  group: 'text',
  dataVersion: 1,
  defaultShowTitle: false,
  presets: [{ id: 'text', labelKey: blockTypeTextKey(TEXT_BLOCK_TYPE, 'label'), descriptionKey: blockTypeTextKey(TEXT_BLOCK_TYPE, 'description'), icon: Type, group: 'text', create: () => createTextBlock() }],
  searchText: (block) => htmlPlainText(block.html),
  refs: (block, report) => report.markup(block.html),
  withoutImage: withoutImageInMarkup,
  // The block is one editor itself.
  textEditors: () => [''],
};
