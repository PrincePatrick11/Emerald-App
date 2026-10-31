import type { TFunction } from 'i18next';
import { BLOCK_ATTR, type BlockAttrName, type BlockInstance } from './types';
import type { BlockTypeMeta } from './blockTypes';
import {
  activeElements, elementKindLabelKey, FIELDS_BLOCK_TYPE, parseFields, type ElementDef, type FallbackText,
} from './fields';

/**
 * Reading and setting the instance attributes from `BLOCK_ATTR` — the same
 * rules for the stack, the sidebar and, later, the export.
 */

/** Hidden: gone in read mode, greyed out in edit mode. The data stays. */
export function isBlockHidden(block: BlockInstance): boolean {
  return block.attrs[BLOCK_ATTR.hidden] === '1';
}

/** The instance's own title, or `null` for "type name". */
export function customBlockTitle(block: BlockInstance): string | null {
  return block.attrs[BLOCK_ATTR.title]?.trim() || null;
}

/**
 * What a block is called — one rule for frame, management list and
 * sidebar section: its own title, otherwise the type name, otherwise (type
 * unknown or data format too new — `meta` is then `undefined`) "Unknown
 * block (type)".
 */
export function blockLabel(t: TFunction, block: BlockInstance, meta: BlockTypeMeta | undefined): string {
  return customBlockTitle(block) ?? blockTypeLabel(t, block, meta);
}

/**
 * The type name alone — without its own title, e.g. as a placeholder when
 * renaming. The copy of a custom block is named like that block, a fields
 * block with exactly one element like that element.
 */
export function blockTypeLabel(t: TFunction, block: BlockInstance, meta: BlockTypeMeta | undefined): string {
  if (!meta) return t('blocks.unknown', { type: block.type });
  if (meta.id === FIELDS_BLOCK_TYPE) {
    const model = parseFields(block);
    if (model.name.trim()) return model.name.trim();
    const elements = activeElements(model);
    if (elements.length === 1) return elementLabel(t, elements[0]);
  }
  return t(meta.labelKey);
}

/**
 * `t(key)` — unless i18n is not ready yet and returns the key itself;
 * then `fallback`. For texts that end up permanently in content or a
 * definition: otherwise "blocks.fields.no" would stay there forever.
 */
export function translatedOr(t: TFunction, key: string, fallback: string): string {
  const value = t(key);
  return typeof value === 'string' && value && value !== key ? value : fallback;
}

/** The texts with which `serializeFields` writes the readable fallback — in the language of `t`. */
export function fieldFallbackText(t: TFunction): FallbackText {
  return {
    label: (element) => elementLabel(t, element),
    yes: translatedOr(t, 'blocks.fields.yes', 'Yes'),
    no: translatedOr(t, 'blocks.fields.no', 'No'),
    moonName: (phase) => translatedOr(t, `moonPhase.${phase}`, phase),
  };
}

/** What a template is called: its name, otherwise "Untitled template". */
export function templateLabel(t: TFunction, template: { name: string }): string {
  return template.name.trim() || t('templates.untitled');
}

/** What a custom block (definition) is called: its name, otherwise "Untitled block". */
export function definitionLabel(t: TFunction, def: { name: string }): string {
  return def.name.trim() || t('blocks.library.untitled');
}

/** The label of a field element: its own, otherwise the name of its kind. */
export function elementLabel(t: TFunction, element: ElementDef): string {
  return element.label.trim() || t(elementKindLabelKey(element.kind));
}

/** The attribute value for "hidden: `hidden`". */
export function hiddenAttrValue(hidden: boolean): string | null {
  return hidden ? '1' : null;
}

/** Does the block show its title in read mode? The instance beats the type's default. */
export function showsTitleInRead(block: BlockInstance, meta: BlockTypeMeta | undefined): boolean {
  const value = block.attrs[BLOCK_ATTR.showTitle];
  if (value === '1') return true;
  if (value === '0') return false;
  return meta?.defaultShowTitle ?? false;
}

/** Copy of the block with the attribute set; `null` removes it. */
export function withBlockAttr(block: BlockInstance, name: BlockAttrName, value: string | null): BlockInstance {
  const attrs = { ...block.attrs };
  if (value === null) delete attrs[name];
  else attrs[name] = value;
  return { ...block, attrs };
}

/**
 * The attribute value for "title in read mode: `show`". If it equals the
 * type's default, the attribute is dropped — a text block whose switch is
 * back at the default is then saved without a wrapper again.
 */
export function showTitleAttrValue(show: boolean, meta: BlockTypeMeta | undefined): string | null {
  return show === (meta?.defaultShowTitle ?? false) ? null : show ? '1' : '0';
}
