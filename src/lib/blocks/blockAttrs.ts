import type { TFunction } from 'i18next';
import { BLOCK_ATTR, type BlockAttrName, type BlockInstance } from './types';
import { blockInstanceName, registeredBlockType, type BlockTypeDef } from './blockTypes';
import { valueLabel, type BlockGlyph } from './blockType';

/**
 * Reading and setting the instance attributes from `BLOCK_ATTR` — the same
 * rules for the stack, the sidebar and the export.
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
 * What a block is called — one rule for frame, management list, sidebar
 * section and export: its own title, otherwise its type's name for it.
 */
export function blockLabel(t: TFunction, block: BlockInstance): string {
  return customBlockTitle(block) ?? blockTypeLabel(t, block);
}

/**
 * The type name alone — without its own title, e.g. as a placeholder when
 * renaming: what the type calls this block (`instanceName`, a custom block's
 * copy its name), otherwise the type's name — an unreadable block of a known
 * type keeps it; a type this app does not know is "Unknown block (type)".
 */
export function blockTypeLabel(t: TFunction, block: BlockInstance): string {
  const meta = registeredBlockType(block);
  if (!meta) return t('blocks.unknown', { type: block.type });
  const name = blockInstanceName(block).name;
  return name ? valueLabel(name, t) : t(meta.labelKey);
}

/** The glyph of a block: what its type shows for it (`instanceName`), else the type's icon; none for an unknown type. */
export function blockIcon(block: BlockInstance): BlockGlyph | undefined {
  return blockInstanceName(block).glyph ?? registeredBlockType(block)?.icon;
}

/** What a template is called: its name, otherwise "Untitled template". */
export function templateLabel(t: TFunction, template: { name: string }): string {
  return template.name.trim() || t('templates.untitled');
}

/** What a custom block (definition) is called: its name, otherwise "Untitled block". */
export function definitionLabel(t: TFunction, def: { name: string }): string {
  return def.name.trim() || t('blocks.library.untitled');
}

/** The attribute value for "hidden: `hidden`". */
export function hiddenAttrValue(hidden: boolean): string | null {
  return hidden ? '1' : null;
}

/** Does the block show its title in read mode? The instance beats the type's default. */
export function showsTitleInRead(block: BlockInstance, meta: BlockTypeDef | undefined = registeredBlockType(block)): boolean {
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
export function showTitleAttrValue(show: boolean, meta: BlockTypeDef | undefined): string | null {
  return show === (meta?.defaultShowTitle ?? false) ? null : show ? '1' : '0';
}
