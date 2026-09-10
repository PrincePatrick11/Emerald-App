import type { TFunction } from 'i18next';
import { BLOCK_ATTR, type BlockAttrName, type BlockInstance } from './types';
import type { BlockTypeMeta } from './blockTypes';
import {
  activeElements, elementKindLabelKey, FIELDS_BLOCK_TYPE, parseFields, type ElementDef, type FallbackText,
} from './fields';

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

/**
 * Der Typname allein — ohne eigenen Titel, etwa als Platzhalter beim
 * Umbenennen. Die Kopie eines eigenen Blocks heißt wie dieser, ein Feldblock
 * mit genau einem Element wie dieses Element.
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
 * `t(key)` — außer i18n ist noch nicht bereit und gibt den Schlüssel selbst
 * zurück; dann `fallback`. Für Texte, die fest in Inhalt oder Definition
 * landen: dort bliebe sonst für immer „blocks.fields.no" stehen.
 */
export function translatedOr(t: TFunction, key: string, fallback: string): string {
  const value = t(key);
  return typeof value === 'string' && value && value !== key ? value : fallback;
}

/** Die Texte, mit denen `serializeFields` den lesbaren Fallback schreibt — in der Sprache von `t`. */
export function fieldFallbackText(t: TFunction): FallbackText {
  return {
    label: (element) => elementLabel(t, element),
    yes: translatedOr(t, 'blocks.fields.yes', 'Yes'),
    no: translatedOr(t, 'blocks.fields.no', 'No'),
    moonName: (phase) => translatedOr(t, `moonPhase.${phase}`, phase),
  };
}

/** Wie ein eigener Block (Definition) heißt: sein Name, sonst „Unbenannter Block". */
export function definitionLabel(t: TFunction, def: { name: string }): string {
  return def.name.trim() || t('blocks.library.untitled');
}

/** Die Beschriftung eines Feld-Elements: die eigene, sonst der Name seiner Art. */
export function elementLabel(t: TFunction, element: ElementDef): string {
  return element.label.trim() || t(elementKindLabelKey(element.kind));
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
