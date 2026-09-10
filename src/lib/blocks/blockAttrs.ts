import type { TFunction } from 'i18next';
import { BLOCK_ATTR, type BlockAttrName, type BlockInstance } from './types';
import type { BlockTypeMeta } from './blockTypes';

/**
 * Lesen und Setzen der Instanz-Attribute aus `BLOCK_ATTR` — dieselben Regeln
 * für den Stapel, die Seitenleiste und später den Export.
 */

/** Ausgeblendet: im Lesemodus weg, im Bearbeitungsmodus ausgegraut. Die Daten bleiben. */
export function isBlockHidden(block: BlockInstance): boolean {
  return block.attrs[BLOCK_ATTR.hidden] === '1';
}

/** Der eigene Titel der Instanz, oder `null` für „Typname". */
export function customBlockTitle(block: BlockInstance): string | null {
  return block.attrs[BLOCK_ATTR.title]?.trim() || null;
}

/**
 * Wie ein Block heißt — eine Regel für Rahmen, Verwaltungsliste und
 * Seitenleisten-Abschnitt: der eigene Titel, sonst der Typname, sonst (Typ
 * unbekannt oder Datenformat zu neu — `meta` ist dann `undefined`) „Unbekannter
 * Block (typ)".
 */
export function blockLabel(t: TFunction, block: BlockInstance, meta: BlockTypeMeta | undefined): string {
  return customBlockTitle(block) ?? blockTypeLabel(t, block, meta);
}

/** Der Typname allein — ohne eigenen Titel, etwa als Platzhalter beim Umbenennen. */
export function blockTypeLabel(t: TFunction, block: BlockInstance, meta: BlockTypeMeta | undefined): string {
  return meta ? t(meta.labelKey) : t('blocks.unknown', { type: block.type });
}

/** Der Attributwert für „ausgeblendet: `hidden`". */
export function hiddenAttrValue(hidden: boolean): string | null {
  return hidden ? '1' : null;
}

/** Zeigt der Block im Lesemodus seinen Titel? Die Instanz schlägt den Standard des Typs. */
export function showsTitleInRead(block: BlockInstance, meta: BlockTypeMeta | undefined): boolean {
  const value = block.attrs[BLOCK_ATTR.showTitle];
  if (value === '1') return true;
  if (value === '0') return false;
  return meta?.defaultShowTitle ?? false;
}

/** Kopie des Blocks mit gesetztem Attribut; `null` entfernt es. */
export function withBlockAttr(block: BlockInstance, name: BlockAttrName, value: string | null): BlockInstance {
  const attrs = { ...block.attrs };
  if (value === null) delete attrs[name];
  else attrs[name] = value;
  return { ...block, attrs };
}

/**
 * Der Attributwert für „Titel im Lesemodus: `show`". Entspricht er dem
 * Standard des Typs, fällt das Attribut weg — ein Textblock, dessen Schalter
 * wieder auf Standard steht, wird dann wieder ohne Wrapper gespeichert.
 */
export function showTitleAttrValue(show: boolean, meta: BlockTypeMeta | undefined): string | null {
  return show === (meta?.defaultShowTitle ?? false) ? null : show ? '1' : '0';
}
