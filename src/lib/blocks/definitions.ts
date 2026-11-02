import { generateId } from '../helpers';
import {
  DEFAULT_DISPLAY, FIELDS_BLOCK_TYPE, isSlotKind, parseDisplay, parseElements, parseFields, serializeFields, slotFromDefault,
  type ChargeDefault, type DisplayRules, type ElementDef, type FallbackText, type FieldsModel, type FieldValue,
} from './fields';
import { sigilPartId } from './sigil';
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
 * in the content. A field archived by an earlier version stays out: a removed
 * field is simply gone from the definition.
 */
export function parseDefinitionElements(raw: unknown): ElementDef[] {
  return parseElements(parseJsonText(raw)).filter((element) => !element.archived);
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
 * therefore have to know them specifically.
 */
export function definitionImageRefs(elements: readonly ElementDef[]): string[] {
  return elements
    .filter((e) => e.kind === 'image' && typeof e.defaultValue === 'string')
    .map((e) => e.defaultValue as string);
}

/** A link target as the import resolves it — `null` means: does not exist here. */
export type LinkDefaultResolver = (target: { id: string; entryType: string; label: string }) => { id: string; label: string; entryType?: string } | null;

/**
 * The `elements` of a definition row from a foreign source with rewritten
 * defaults: image names via `image`, link targets via `link` (merge import
 * with prefix, `.emerald` by ID or title). If `link` finds no target, the
 * default is dropped — otherwise every new copy would carry a chip pointing
 * nowhere. Unreadable input comes back unchanged; reading validates anyway.
 */
export function remapDefinitionDefaults(
  rawElements: unknown,
  image: (name: string) => string,
  link: LinkDefaultResolver = (target) => target,
): unknown {
  const parsed = parseJsonText(rawElements);
  if (!Array.isArray(parsed)) return rawElements;
  const remapped = parsed.map((el: unknown) => {
    if (typeof el !== 'object' || el === null || !('defaultValue' in el)) return el;
    const value = (el as { defaultValue: unknown }).defaultValue;
    if (typeof value === 'string' && (el as { kind?: unknown }).kind === 'image') return { ...el, defaultValue: image(value) };
    if (typeof value === 'object' && value !== null && typeof (value as { id?: unknown }).id === 'string') {
      const raw = value as { id: string; entryType?: unknown; label?: unknown };
      const target = link({
        id: raw.id,
        entryType: typeof raw.entryType === 'string' ? raw.entryType : '',
        label: typeof raw.label === 'string' ? raw.label : '',
      });
      if (!target) {
        const { defaultValue: _dropped, ...rest } = el as Record<string, unknown>;
        return rest;
      }
      return { ...el, defaultValue: { ...raw, id: target.id, label: target.label, ...(target.entryType ? { entryType: target.entryType } : {}) } };
    }
    return el;
  });
  return typeof rawElements === 'string' ? JSON.stringify(remapped) : remapped;
}

function blockDisplay(display: DefinitionDisplay): DisplayRules {
  return { readHideEmpty: display.readHideEmpty, readOnly: display.readOnly };
}

/**
 * The elements' defaults — what a new copy (or a new element in it)
 * receives: scalars as values, link, altar and image as a slot.
 */
function defaultsOf(elements: readonly ElementDef[], blockId: string): Pick<FieldsModel, 'values' | 'slots'> {
  const values: Record<string, FieldValue> = {};
  const slots: Record<string, string> = {};
  for (const element of elements) {
    if (element.defaultValue === undefined) continue;
    if (element.kind === 'sigilCharge') {
      // The charge unloaded, with lock and targets — the targets now pointing to this block.
      const { lock, targets } = element.defaultValue as ChargeDefault;
      values[element.id] = {
        loaded: false, revealDate: null, lock,
        ...(targets ? { targets: targets.map((id) => sigilPartId(blockId, id)) } : {}),
      };
      continue;
    }
    if (isSlotKind(element.kind)) {
      const slot = slotFromDefault(element);
      if (slot) slots[element.id] = slot;
      continue;
    }
    const value = element.defaultValue as FieldValue;
    // A checklist gets its own item IDs so that two copies do not carry the same ones.
    values[element.id] = Array.isArray(value) ? value.map((item) => ({ ...item, id: generateId() })) : value;
  }
  return { values, slots };
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
    }),
  };
  // The field block's default is "without title"; only the deviation becomes an attribute.
  if (def.display.showTitle) attrs[BLOCK_ATTR.showTitle] = '1';
  const block: BlockInstance = { id: generateId(), type: FIELDS_BLOCK_TYPE, html: '', attrs };
  const defaults = defaultsOf(elements, block.id);
  if (Object.keys(defaults.values).length === 0 && Object.keys(defaults.slots).length === 0) return block;
  const model = parseFields(block);
  return serializeFields(block, {
    ...model,
    values: { ...model.values, ...defaults.values },
    slots: { ...model.slots, ...defaults.slots },
  }, text);
}
