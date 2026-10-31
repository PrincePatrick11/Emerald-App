import { generateId } from '../helpers';
import { parseBlocks, serializeBlocks } from './blockHtml';
import {
  DEFAULT_DISPLAY, FIELDS_BLOCK_TYPE, isSlotKind, parseDisplay, parseElements, parseFields, serializeFields, slotFromDefault,
  type ChargeDefault, type DisplayRules, type ElementDef, type FallbackText, type FieldsModel, type FieldValue,
} from './fields';
import { isSigilFrozen, mayHoldSigil, sigilPartId, sigilState, todayIso } from './sigil';
import { BLOCK_ATTR, type BlockInstance } from './types';

/**
 * Custom blocks (blocks view, table `block_definitions`): a definition
 * is the template from which a field block with several elements is copied.
 *
 * The model is **copies, not live references** (the user's decision):
 * an inserted block carries elements, display rules, name and icon itself —
 * rendering always comes from the copy. A change to the definition therefore
 * changes no existing entry; if the definition is missing (trash, import
 * from another vault), the copy works anyway. The copy only remembers
 * where it came from (`data-block-origin`) and in which revision
 * (`data-block-rev`) — that is how the app recognises an "older version" and
 * offers to update it, individually in the entry or collectively in the blocks view.
 *
 * Element IDs are the same in the definition and all copies. Values thus
 * stay with their element across renaming and updating, and a later
 * list filter finds them in every copy, whatever its version.
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
 * A definition ID from a foreign source (backup, `.emerald`): it ends up in
 * the `data-block-origin` of every copy, so only harmless characters. One
 * shared rule for both import paths.
 */
export function isDefinitionId(id: unknown): id is string {
  return typeof id === 'string' && /^[\w-]{1,100}$/.test(id);
}

export interface BlockDefinition {
  id: string;
  name: string;
  /** Emoji. */
  icon: string;
  /** Including archived elements: they remain restorable. */
  elements: ElementDef[];
  display: DefinitionDisplay;
  /** Increases with every change that affects copies (name, icon, elements, display). */
  revision: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/** The definition as a database row — `elements`/`display` as JSON text. */
export function definitionToRow(def: BlockDefinition) {
  return { ...def, elements: JSON.stringify(def.elements), display: JSON.stringify(def.display) };
}

/** What a definition passes on to its copies; `sameShape` decides which of it raises the revision. */
export type DefinitionShape = Pick<BlockDefinition, 'name' | 'icon' | 'elements' | 'display'>;

/** The element as a copy carries it: without a default — that has already become a value there. */
function elementForCopy(element: ElementDef): ElementDef {
  const { defaultValue: _defaultValue, ...rest } = element;
  return rest;
}

// Comparison via JSON: depends on key order. Elements are therefore always
// created through `parseElement` or as a copy from there — an object sorted
// differently would yield a revision without a real change. Defaults and
// "show title" do not count: they only affect new copies, an existing one
// would have nothing to update (`updateInstanceToDefinition`).
export function sameShape(a: DefinitionShape, b: DefinitionShape): boolean {
  const shape = (d: DefinitionShape) => JSON.stringify([d.name, d.icon, d.elements.map(elementForCopy), blockDisplay(d.display)]);
  return shape(a) === shape(b);
}

function parseJsonText(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/** The elements of a definition from its JSON column — validated like the copy in the content. */
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

/** Origin of a copy, or `null` for any other block. */
export function blockOrigin(block: BlockInstance): { id: string; rev: number } | null {
  if (block.type !== FIELDS_BLOCK_TYPE) return null;
  const id = block.attrs[BLOCK_ATTR.origin];
  if (!id) return null;
  const rev = Number(block.attrs[BLOCK_ATTR.rev]);
  return { id, rev: Number.isInteger(rev) && rev > 0 ? rev : 0 };
}

/** Is the block a copy of this definition in an older revision — and readable enough to update it? */
export function isOutdatedCopy(block: BlockInstance, def: BlockDefinition): boolean {
  const origin = blockOrigin(block);
  return !!origin && origin.id === def.id && origin.rev < def.revision && !parseFields(block).broken;
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
 * A new block as a copy of the definition — without the archived elements,
 * prefilled with the defaults. `text` writes the readable fallback of these
 * values so that search and export find them right away.
 */
export function instantiateDefinition(def: BlockDefinition, text: FallbackText): BlockInstance {
  const elements = def.elements.filter((e) => !e.archived);
  const attrs: Record<string, string> = {
    [BLOCK_ATTR.config]: JSON.stringify({
      elements: elements.map(elementForCopy),
      display: blockDisplay(def.display),
      name: def.name,
      icon: def.icon,
    }),
    [BLOCK_ATTR.origin]: def.id,
    [BLOCK_ATTR.rev]: String(def.revision),
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

/**
 * Bring the copy up to the definition's state:
 * - Values stay where they are — at their element ID.
 * - New elements are added, in the definition's order — with their
 *   default, otherwise empty.
 * - Elements that the definition no longer shows are archived:
 *   invisible, with their data.
 * - Labels, options, display rules, name and icon come from the
 *   definition. What belongs to the instance itself — own title, eye, title
 *   in read mode — stays.
 *
 * An unreadable block comes back unchanged. An element whose kind in the copy
 * differs from the one in the definition (the blocks view does not allow
 * that; only a doctored file could) keeps its own version — the
 * definition's would discard its value.
 */
export function updateInstanceToDefinition(block: BlockInstance, def: BlockDefinition, text: FallbackText): BlockInstance {
  const model = parseFields(block);
  if (model.broken) return block;
  const own = new Map(model.elements.map((e) => [e.id, e]));
  const fromDef = def.elements
    .filter((e) => !e.archived)
    .map((e) => {
      const mine = own.get(e.id);
      return mine && mine.kind !== e.kind ? mine : elementForCopy(e);
    });
  // Only elements the copy never knew — neither as an (even archived) element nor as an orphaned value or slot.
  const added = def.elements.filter((e) =>
    !e.archived && !own.has(e.id) && !(e.id in model.orphans) && !(e.id in model.slots));
  const defaults = defaultsOf(added, block.id);
  const shown = new Set(fromDef.map((e) => e.id));
  const archived = model.elements
    .filter((e) => !shown.has(e.id))
    .map((e) => ({ ...e, archived: true }));

  const next: FieldsModel = {
    ...model,
    values: { ...defaults.values, ...model.values },
    slots: { ...defaults.slots, ...model.slots },
    elements: [...fromDef, ...archived],
    display: blockDisplay(def.display),
    name: def.name,
    icon: def.icon,
  };
  const withRev = { ...block, attrs: { ...block.attrs, [BLOCK_ATTR.rev]: String(def.revision) } };
  return serializeFields(withRev, next, text);
}

/**
 * Does the content carry a copy of the definition that a loaded sigil
 * holds fixed (`isSigilFrozen`)? It stays in place on updating and removing
 * — the caller reports it as skipped.
 */
export function hasFrozenCopy(content: string, defId: string, today = todayIso()): boolean {
  if (!mayHoldSigil(content)) return false;
  const blocks = parseBlocks(content);
  const state = sigilState(blocks, today);
  return blocks.some((block) => blockOrigin(block)?.id === defId && isSigilFrozen(block, state));
}

/** Update all outdated copies of the definition in a content — `null` if there were none. */
export function updateCopiesInContent(content: string, def: BlockDefinition, text: FallbackText): string | null {
  let changed = false;
  const blocks = parseBlocks(content);
  const state = sigilState(blocks, todayIso());
  const next = blocks.map((block) => {
    if (!isOutdatedCopy(block, def) || isSigilFrozen(block, state)) return block;
    changed = true;
    return updateInstanceToDefinition(block, def, text);
  });
  return changed ? serializeBlocks(next) : null;
}

/** Remove all copies of the definition from a content — `null` if there were none. Locked ones stay (see `hasFrozenCopy`). */
export function removeCopiesFromContent(content: string, defId: string): string | null {
  const blocks = parseBlocks(content);
  const state = sigilState(blocks, todayIso());
  const next = blocks.filter((block) => blockOrigin(block)?.id !== defId || isSigilFrozen(block, state));
  return next.length === blocks.length ? null : serializeBlocks(next);
}
