import { generateId, isRecord } from '../helpers';
import { fieldKindOf } from './fieldKinds';
import type { PrefillRemap } from './fieldKinds/fieldKind';
import {
  DEFAULT_DISPLAY, FIELDS_BLOCK_TYPE, isReadableElement, parseDisplay, parseElements, parseFields, prefillStored, reportPrefillRefs,
  serializeFields, upgradedElement, withFieldStored,
  type DisplayRules, type ElementDef, type FallbackText, type FieldsModel,
} from './fields';
import { RefReporter } from './toolkit';
import { BLOCK_ATTR, type BlockInstance } from './types';

/**
 * Custom blocks (blocks view, table `block_definitions`): a definition
 * is the template from which a field block with several elements is copied.
 *
 * The model is **copies, without any link**: an inserted block carries
 * elements, display rules, name and icon itself and does not know where it
 * came from. A change to the definition therefore changes no existing entry,
 * and nothing in an entry or template ever changes because of a definition.
 */

/** The display rules of a definition: those of the field block plus the title in read mode. */
export interface DefinitionDisplay extends DisplayRules {
  /** Becomes the instance attribute `data-block-show-title` on insertion — changeable per block. */
  showTitle: boolean;
}

export const DEFAULT_DEFINITION_DISPLAY: DefinitionDisplay = { ...DEFAULT_DISPLAY, showTitle: true };

/** The emoji of a new definition — also the column default in `schema.ts`. */
export const DEFAULT_DEFINITION_ICON = '🧩';

/**
 * A definition ID from a foreign source (backup, `.emerald`): only harmless
 * characters. One shared rule for both import paths.
 */
export function isDefinitionId(id: unknown): id is string {
  return typeof id === 'string' && /^[\w-]{1,100}$/.test(id);
}

export interface BlockDefinition {
  id: string;
  name: string;
  /** Emoji. */
  icon: string;
  elements: ElementDef[];
  display: DefinitionDisplay;
  sort_order: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/** The definition as a database row — `elements`/`display` as JSON text. */
export function definitionToRow(def: BlockDefinition) {
  return { ...def, elements: JSON.stringify(def.elements), display: JSON.stringify(def.display) };
}

/** The element as a copy carries it: without a default — that has already become a value there. */
function elementForCopy(element: ElementDef): ElementDef {
  const { defaultValue: _defaultValue, ...rest } = element;
  return rest;
}

function parseJsonText(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/**
 * The elements of a definition from its JSON column — validated like the copy
 * in the content.
 */
export function parseDefinitionElements(raw: unknown): ElementDef[] {
  return parseElements(parseJsonText(raw));
}

export function parseDefinitionDisplay(raw: unknown): DefinitionDisplay {
  const parsed = parseJsonText(raw);
  const showTitle = typeof parsed === 'object' && parsed !== null && 'showTitle' in parsed
    ? (parsed as { showTitle: unknown }).showTitle
    : undefined;
  return {
    ...parseDisplay(parsed),
    showTitle: typeof showTitle === 'boolean' ? showTitle : DEFAULT_DEFINITION_DISPLAY.showTitle,
  };
}

/**
 * The image files that a definition's defaults name. They appear in no
 * content until a copy is made — backup, `.emerald` and the image cleanup
 * therefore have to know them specifically. Each kind says what its prefill
 * points at.
 */
export function definitionImageRefs(elements: readonly ElementDef[]): string[] {
  const report = new RefReporter();
  for (const element of elements) reportPrefillRefs(element, report);
  return report.refs.filter((ref) => ref.kind === 'image').map((ref) => ref.target);
}

/** A link target as the import resolves it — `null` means: does not exist here. */
export type LinkDefaultResolver = PrefillRemap['link'];

/**
 * The `elements` of a definition row from a foreign source with rewritten
 * defaults, each as its kind maps it: image names via `image`, link targets
 * via `link` (merge import by the copies' fresh IDs, `.emerald` by the ID of
 * an entry of the same file). A prefill its kind drops (a link whose target is
 * not there) is taken out — otherwise every new copy would carry a chip
 * pointing nowhere. An element of an older data version is brought up first;
 * unreadable input, kinds this app does not know and an element of a newer
 * version come back unchanged; reading validates anyway.
 */
export function remapDefinitionDefaults(
  rawElements: unknown,
  image: (name: string) => string,
  link: LinkDefaultResolver = (target) => target,
): unknown {
  const parsed = parseJsonText(rawElements);
  if (!Array.isArray(parsed)) return rawElements;
  const remapped = parsed.map((el: unknown) => {
    if (!isRecord(el) || el.defaultValue === undefined || typeof el.kind !== 'string' || !isReadableElement(el)) return el;
    const remap = fieldKindOf(el.kind)?.prefill?.remap;
    if (!remap) return el;
    const up = upgradedElement(el, { value: undefined, slot: undefined }).raw as Record<string, unknown>;
    const value = remap(up.defaultValue, { image, link });
    if (value === undefined) {
      const { defaultValue: _dropped, ...rest } = up;
      return rest;
    }
    return { ...up, defaultValue: value };
  });
  return typeof rawElements === 'string' ? JSON.stringify(remapped) : remapped;
}

function blockDisplay(display: DefinitionDisplay): DisplayRules {
  return { readHideEmpty: display.readHideEmpty, readOnly: display.readOnly };
}

/**
 * The elements' prefills — what a new copy receives, each as its kind makes
 * a value or a slot of it (a checklist's items with IDs of their own).
 */
function withPrefills(model: FieldsModel, elements: readonly ElementDef[]): { model: FieldsModel; filled: boolean } {
  let filled = false;
  for (const element of elements) {
    const stored = prefillStored(element, true);
    if (stored === undefined) continue;
    model = withFieldStored(model, element, stored);
    filled = true;
  }
  return { model, filled };
}

/**
 * A new block as a copy of the definition, prefilled with the defaults. `text` writes the readable fallback of these
 * values so that search and export find them right away.
 */
export function instantiateDefinition(def: BlockDefinition, text: FallbackText): BlockInstance {
  const { elements } = def;
  const attrs: Record<string, string> = {
    [BLOCK_ATTR.config]: JSON.stringify({
      elements: elements.map(elementForCopy),
      display: blockDisplay(def.display),
      name: def.name,
      icon: def.icon,
      // Where the copy came from — a note for the `.emerald` export, not a link.
      definition: def.id,
    }),
  };
  // The field block's default is "without title"; only the deviation becomes an attribute.
  if (def.display.showTitle) attrs[BLOCK_ATTR.showTitle] = '1';
  const block: BlockInstance = { id: generateId(), type: FIELDS_BLOCK_TYPE, html: '', attrs };
  const prefilled = withPrefills(parseFields(block), elements);
  return prefilled.filled ? serializeFields(block, prefilled.model, text) : block;
}
