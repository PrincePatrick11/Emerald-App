import { ListFilter, PanelRight, Rows3, type LucideIcon } from 'lucide-react';
import { escapeHtml, decodeHtmlAttr } from '../internalLinkHtml';
import { generateId, isRecord } from '../helpers';
import { neutralizeSectionTags } from './blockHtml';
import { fieldKindOf } from './fieldKinds';
import {
  FIELD_USES, type ElementDef, type FallbackText, type FieldKindDef, type FieldRead, type FieldUse, type FieldUses, type FieldValue,
} from './fieldKinds/fieldKind';
import type { RefReporter } from './toolkit';
import { BLOCK_ATTR, type BlockInstance, type BlockTypeId } from './types';

/**
 * The field block (`core.fields`): a sequence of fields (elements), each of a
 * kind of its own — text, short text, number, date, choice, yes/no, checklist,
 * link, image (`fieldKinds.ts`). A single field is a field block with one
 * element; custom, composite blocks (blocks view) are field blocks with several.
 *
 * This module knows no kind: what a field holds, when it is empty, how it reads
 * and writes, the kind says (`FieldKindDef`, `fieldKinds/fieldKind.ts`).
 *
 * Where things are — the same convention as for all blocks:
 * - `data-block-config` (JSON): the elements and the display rules.
 * - `data-block-data` (JSON): the values of kinds stored as `value`, under the ID of their element.
 * - The values of kinds stored as `slot` (references, images, text) are NOT in
 *   the JSON, but stand as a real link chip, `<img src>` or the text editor's
 *   HTML in the inner HTML, in a `<dd data-block-slot="el:<id>">`. That way the
 *   link table, backlinks, merge-import remap and image cleanup find them
 *   without a special case.
 * - The inner HTML is also the readable fallback (`<dl>` with label
 *   and value) for search, export and an app that does not know the type. It is
 *   rewritten on every change; the truth for values is the JSON.
 *
 * Pure and DOM-free like the rest of `lib/blocks`. Slot contents are a chip,
 * an image or TipTap HTML (whose schema has no definition lists), never
 * a `</dd>` — so a regex is enough for reading.
 */

export const FIELDS_BLOCK_TYPE = 'core.fields' satisfies BlockTypeId;

export type { ElementDef, ElementDefault, FallbackText, FieldKindDef, FieldUse, FieldUses, FieldValue, SelectOption } from './fieldKinds/fieldKind';
export { FIELD_USES } from './fieldKinds/fieldKind';

/** The kind of a field read from a block or a definition — every one of them is registered (`parseElements` drops the others). */
export function elementKind(element: ElementDef): FieldKindDef {
  const kind = fieldKindOf(element.kind);
  if (!kind) throw new Error(`Unknown field kind: ${element.kind}`);
  return kind;
}

/** The i18n key for the name of a kind — picker, label, placeholder. */
export function elementKindLabelKey(kind: string): string {
  return fieldKindOf(kind)?.labelKey ?? `blocks.kinds.${kind}`;
}

/* ---------------- Uses outside the block ---------------- */

/** How a field's setting is shown, alike in the builder and in the block's sidebar. */
export const FIELD_USE_SETTINGS: Readonly<Record<FieldUse, { icon: LucideIcon; labelKey: string; hintKey: string }>> = {
  info: { icon: Rows3, labelKey: 'blocks.fields.uses.info', hintKey: 'blocks.fields.uses.infoHint' },
  panel: { icon: PanelRight, labelKey: 'blocks.fields.uses.panel', hintKey: 'blocks.fields.uses.panelHint' },
  values: { icon: ListFilter, labelKey: 'blocks.fields.uses.values', hintKey: 'blocks.fields.uses.valuesHint' },
};

const usesOf = (on: (use: FieldUse) => boolean): FieldUses => ({ info: on('info'), panel: on('panel'), values: on('values') });

/**
 * Can a field of this kind be used so? The block's settings per field
 * (interface 14, for user-built blocks): the entry's info line in lists, the
 * properties panel, the values dashboards filter and sort by. The fields
 * block reads them in its interfaces 1, 3 and 4/9 (`kinds/fields.ts`).
 */
export function canUse(kind: string, use: FieldUse): boolean {
  return fieldKindOf(kind)?.uses.includes(use) ?? false;
}

/** The start values of a new field of a custom block, as its kind says. */
export function initialUses(kind: string): FieldUses {
  const start = fieldKindOf(kind)?.startUses ?? [];
  return usesOf((use) => start.includes(use) && canUse(kind, use));
}

/** A single field (added on its own) starts with every use off: it is shown in its block, not twice. */
export const NO_USES: FieldUses = { info: false, panel: false, values: false };

/** How the field is used — as stored, off where nothing is; never what its kind cannot do. */
export function elementUses(element: ElementDef): FieldUses {
  return usesOf((use) => canUse(element.kind, use) && element.uses?.[use] === true);
}

/** The field with one use switched; all three are stored from then on, so the field no longer depends on what is not stored. */
export function withFieldUse(element: ElementDef, use: FieldUse, on: boolean): ElementDef {
  return { ...element, uses: { ...elementUses(element), [use]: on } };
}

/** A field's name: the one the user gave it, else (as a text key) that of its kind. */
export function fieldLabel(element: ElementDef): { label: string } | { labelKey: string } {
  const label = element.label.trim();
  return label ? { label } : { labelKey: elementKindLabelKey(element.kind) };
}

export interface DisplayRules {
  /** Hide empty elements in read mode. */
  readHideEmpty: boolean;
  /** Do not tick or toggle anything in read mode either. */
  readOnly: boolean;
}

export const DEFAULT_DISPLAY: DisplayRules = { readHideEmpty: true, readOnly: false };

export interface FieldsModel {
  /**
   * Config or data are present but not readable. Such a block is displayed
   * like an unknown one and NEVER written — otherwise the next change would
   * overwrite the unreadable original data with "empty".
   */
  broken: boolean;
  elements: ElementDef[];
  display: DisplayRules;
  /** Values of known elements stored as `value`, checked by their kind. */
  values: Record<string, FieldValue>;
  /**
   * Values without a known element — written back unchanged. (A value of the
   * wrong kind for a known element, on the other hand, is dropped; a new
   * value format would come with a new data version and not be read at all.)
   */
  orphans: Record<string, unknown>;
  /** Element ID → inner HTML of its slot (link chip, `<img>`, text), also without a known element. */
  slots: Record<string, string>;
  /** Name and icon (an emoji or an icon file, `blockRefs` names it) of the custom block definition the block was copied from — empty for single fields. */
  name: string;
  icon: string;
  /**
   * The ID of the custom block definition the block was copied from — a quiet
   * note, no link: nothing follows it while editing. The `.emerald` export
   * takes the definitions of an entry's copies along by it.
   */
  definition?: string;
}

/* ---------------- What a field holds ---------------- */

/** What the field holds — its JSON value, or for a kind stored as `slot` its markup. */
export function fieldStored(element: ElementDef, model: FieldsModel): FieldValue | undefined {
  return elementKind(element).storage === 'slot' ? model.slots[element.id] : model.values[element.id];
}

/** The field as its kind is asked about it. */
export function fieldRead(element: ElementDef, model: FieldsModel): FieldRead {
  return { element, stored: fieldStored(element, model) };
}

/** The model with the field holding `stored` (`undefined`: nothing) — in the JSON or the slot, as its kind keeps it. */
export function withFieldStored(model: FieldsModel, element: ElementDef, stored: FieldValue | undefined): FieldsModel {
  if (elementKind(element).storage === 'slot') {
    const slots = { ...model.slots };
    if (typeof stored === 'string' && stored) slots[element.id] = stored;
    else delete slots[element.id];
    return { ...model, slots };
  }
  const values = { ...model.values };
  if (stored === undefined) delete values[element.id];
  else values[element.id] = stored;
  return { ...model, values };
}

/* ---------------- Reading ---------------- */

function parseJson(raw: string | undefined): { ok: boolean; value: unknown } {
  if (raw === undefined) return { ok: true, value: undefined };
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false, value: undefined };
  }
}

/**
 * An element ID must be harmless: it becomes a key in `values`/`slots`
 * and an attribute value in the markup. A name like `constructor` or `__proto__` from
 * a doctored import file would otherwise read built-in object properties
 * as slot content — and rendering would break.
 */
const ELEMENT_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function isSafeElementId(id: string): boolean {
  return ELEMENT_ID_RE.test(id) && !(id in Object.prototype);
}

/** A key-value object without a prototype — what is not in it does not exist. */
function bareRecord<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

/** The data version an element was stored in (`ElementDef.v`, missing = 1). */
function storedVersion(raw: Record<string, unknown>): number {
  return typeof raw.v === 'number' && Number.isInteger(raw.v) && raw.v >= 1 ? raw.v : 1;
}

/**
 * Can this app read the element? Not if its kind is unknown here or its data
 * version is newer than the kind's: reading would drop the field and the next
 * save lose it.
 */
export function isReadableElement(raw: unknown): boolean {
  if (!isRecord(raw) || typeof raw.kind !== 'string') return true; // Merely invalid — dropped.
  const kind = fieldKindOf(raw.kind);
  return !!kind && storedVersion(raw) <= kind.dataVersion;
}

/** What a field held as it was stored: its JSON value and its slot's markup — the kind's `storage` says which counts. */
interface RawStored {
  value: unknown;
  slot: string | undefined;
}

/**
 * An element, and what it holds, brought up to its kind's data version
 * (`FieldKindDef.upgrade`). `upgraded` is false where nothing had to be done.
 */
export function upgradedElement(raw: unknown, stored: RawStored): { raw: unknown; stored: unknown; upgraded: boolean } {
  const kind = isRecord(raw) && typeof raw.kind === 'string' ? fieldKindOf(raw.kind) : undefined;
  const current = kind?.storage === 'slot' ? stored.slot : stored.value;
  if (!isRecord(raw) || !kind?.upgrade || storedVersion(raw) >= kind.dataVersion) return { raw, stored: current, upgraded: false };
  const up = kind.upgrade({ element: raw, ...stored }, storedVersion(raw));
  return { raw: up.element, stored: up.stored, upgraded: true };
}

/** The keys every element has; a kind's own settings (`parseConfig`) never set them. */
const COMMON_KEYS: ReadonlySet<string> = new Set(['id', 'kind', 'label', 'hideWhenEmpty', 'uses', 'v', 'defaultValue']);

function parseElement(raw: unknown): ElementDef | null {
  if (!isRecord(raw) || typeof raw.id !== 'string' || !isSafeElementId(raw.id)
    || typeof raw.kind !== 'string' || !isReadableElement(raw)) {
    return null;
  }
  const kind = fieldKindOf(raw.kind)!;
  const own = Object.entries(kind.parseConfig?.(raw) ?? {}).filter(([key]) => !COMMON_KEYS.has(key));
  const element: ElementDef = {
    id: raw.id,
    kind: kind.id,
    label: typeof raw.label === 'string' ? raw.label : '',
    ...Object.fromEntries(own),
  };
  if (typeof raw.hideWhenEmpty === 'boolean') element.hideWhenEmpty = raw.hideWhenEmpty;
  if (isRecord(raw.uses)) {
    const uses: Partial<FieldUses> = {};
    for (const use of FIELD_USES) if (typeof raw.uses[use] === 'boolean') uses[use] = raw.uses[use];
    element.uses = uses;
  }
  if (kind.dataVersion > 1) element.v = kind.dataVersion;
  if (raw.defaultValue !== undefined && kind.prefill) {
    const value = kind.prefill.parse(raw.defaultValue, element);
    if (value !== undefined) element.defaultValue = value;
  }
  return element;
}

interface ReadElement {
  element: ElementDef;
  /** What it holds as its kind keeps it now; only meaningful where `upgraded`, else it is read from the block as stored. */
  stored: unknown;
  upgraded: boolean;
}

/** Elements with what they hold, from an unreliable list: brought up, checked, invalid entries and duplicate IDs dropped. */
function readElements(raw: unknown, storedOf: (raw: unknown) => RawStored): ReadElement[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: ReadElement[] = [];
  for (const item of raw) {
    const up = upgradedElement(item, storedOf(item));
    const element = parseElement(up.raw);
    if (!element || seen.has(element.id)) continue;
    seen.add(element.id);
    out.push({ element, stored: up.stored, upgraded: up.upgraded });
  }
  return out;
}

const NOTHING_STORED: RawStored = { value: undefined, slot: undefined };

/** An element list from an unreliable source (content, import, database): invalid entries and duplicate IDs are dropped. */
export function parseElements(raw: unknown): ElementDef[] {
  return readElements(raw, () => NOTHING_STORED).map(({ element }) => element);
}

/** Display rules from an unreliable source; anything missing falls back to `DEFAULT_DISPLAY`. */
export function parseDisplay(raw: unknown): DisplayRules {
  const rules = isRecord(raw) ? raw : {};
  return {
    readHideEmpty: typeof rules.readHideEmpty === 'boolean' ? rules.readHideEmpty : DEFAULT_DISPLAY.readHideEmpty,
    readOnly: typeof rules.readOnly === 'boolean' ? rules.readOnly : DEFAULT_DISPLAY.readOnly,
  };
}

// The attribute sections are bounded (IDs are at most 64 characters anyway):
// unbounded, the regex would run quadratically on doctored markup.
const SLOT_RE = /<dd\b[^<>]{0,256}?\bdata-block-slot="el:([^"]{1,200})"[^<>]{0,256}>([\s\S]*?)<\/dd>/gi;

// Blocks are immutable values: same object, same model. The stack, the
// sidebar, name and icon read the same block several times per render —
// without a cache that would mean several JSON.parse calls per keystroke.
const modelCache = new WeakMap<BlockInstance, FieldsModel>();

/** The model of a field block. Never throws — unreadable input sets `broken`. */
export function parseFields(block: BlockInstance): FieldsModel {
  const cached = modelCache.get(block);
  if (cached) return cached;

  const config = parseJson(block.attrs[BLOCK_ATTR.config]);
  const data = parseJson(block.attrs[BLOCK_ATTR.data]);
  const broken = !config.ok || !data.ok
    || (config.value !== undefined && (!isRecord(config.value)
      || (config.value.elements !== undefined && !Array.isArray(config.value.elements))))
    || (data.value !== undefined && (!isRecord(data.value)
      || (data.value.values !== undefined && !isRecord(data.value.values))))
    // An element of a kind (or a kind's data version) this app does not know
    // would be dropped on reading and lost on the next save; the block stays as it is instead.
    || (isRecord(config.value) && Array.isArray(config.value.elements) && !config.value.elements.every(isReadableElement));

  const cfg = isRecord(config.value) ? config.value : {};
  const display = parseDisplay(cfg.display);
  const rawValues = isRecord(data.value) && isRecord(data.value.values) ? data.value.values : {};

  const slots = bareRecord<string>();
  for (const m of block.html.matchAll(SLOT_RE)) {
    const id = decodeHtmlAttr(m[1]);
    if (isSafeElementId(id) && m[2].trim()) slots[id] = m[2];
  }

  // The ID is checked before it is used as a key: no built-in property is read.
  const read = readElements(cfg.elements, (raw) => (isRecord(raw) && typeof raw.id === 'string' && isSafeElementId(raw.id)
    ? { value: rawValues[raw.id], slot: slots[raw.id] }
    : NOTHING_STORED));
  const elements = read.map(({ element }) => element);
  const byId = new Map(read.map((r) => [r.element.id, r]));

  const values = bareRecord<FieldValue>();
  const orphans = bareRecord<unknown>();
  const readValue = (element: ElementDef, raw: unknown) => {
    const value = raw === undefined ? undefined : elementKind(element).parseValue?.(raw, element);
    if (value !== undefined) values[element.id] = value;
  };
  // In the stored order, so that a block written back unchanged stays so.
  for (const id of Object.keys(rawValues)) {
    const known = byId.get(id);
    if (!known) {
      if (isSafeElementId(id)) orphans[id] = rawValues[id];
    } else if (!known.upgraded && elementKind(known.element).storage === 'value') {
      readValue(known.element, rawValues[id]);
    }
  }
  // What an upgrade made of a field, in the place its kind keeps it now.
  for (const { element, stored } of read.filter((r) => r.upgraded)) {
    delete slots[element.id];
    if (elementKind(element).storage === 'value') readValue(element, stored);
    else if (typeof stored === 'string' && stored.trim()) slots[element.id] = stored;
  }

  const model: FieldsModel = {
    broken, elements, display, values, orphans, slots,
    name: typeof cfg.name === 'string' ? cfg.name : '',
    icon: typeof cfg.icon === 'string' ? cfg.icon : '',
    // The harmless shape of a definition ID from a file (`isDefinitionId`).
    ...(typeof cfg.definition === 'string' && /^[\w-]{1,100}$/.test(cfg.definition) ? { definition: cfg.definition } : {}),
  };
  modelCache.set(block, model);
  return model;
}

/* ---------------- Prefills ---------------- */

/**
 * What a field holds with its prefill (`ElementDef.defaultValue`) — the value
 * or the slot markup its kind makes of it; `fresh` for a new copy. `undefined`
 * without one.
 */
export function prefillStored(element: ElementDef, fresh = false): FieldValue | undefined {
  const prefill = elementKind(element).prefill;
  return prefill && element.defaultValue !== undefined ? prefill.toStored(element.defaultValue, element, fresh) : undefined;
}

/** What the field's prefill points at, as its kind reports it (role `default`). */
export function reportPrefillRefs(element: ElementDef, report: RefReporter): void {
  const refs = fieldKindOf(element.kind)?.prefill?.refs;
  if (refs && element.defaultValue !== undefined) refs(element.defaultValue, report);
}

/**
 * The reverse, for the builder: the prefill an input yields — `undefined` for
 * empty or unusable input.
 */
export function prefillFromStored(element: ElementDef, stored: FieldValue | undefined): FieldValue | undefined {
  const prefill = elementKind(element).prefill;
  return prefill && stored !== undefined && stored !== '' ? prefill.fromStored(stored, element) : undefined;
}

/* ---------------- Empty / visible ---------------- */

/** Does the element have no (valid) value? Its kind says (yes/no is never empty: unset means "no"). */
export function isElementEmpty(element: ElementDef, model: FieldsModel): boolean {
  return elementKind(element).isEmpty(fieldRead(element, model));
}

/** Can an element of this kind be empty? Where not, there is no "hide when empty". */
export function canBeEmpty(kind: string): boolean {
  return fieldKindOf(kind)?.canBeEmpty !== false;
}

/** Does read mode hide this element? Empty AND (element or block rule). */
export function isHiddenInRead(element: ElementDef, model: FieldsModel): boolean {
  return isElementEmpty(element, model) && (element.hideWhenEmpty ?? model.display.readHideEmpty);
}

/* ---------------- Writing ---------------- */

/** The label of a field element in the language of `t`: its own, otherwise the name of its kind. */
export function elementLabel(t: (key: string) => string, element: ElementDef): string {
  const named = fieldLabel(element);
  return 'label' in named ? named.label : t(named.labelKey);
}

/** The texts with which `serializeFields` writes the readable fallback — in the language of `t`. */
export function fieldFallbackText(t: (key: string) => string): FallbackText {
  return { label: (element) => elementLabel(t, element), t };
}

/** The value of a field stored as `value`, as HTML for the readable fallback — `null` for empty. */
export function fieldValueHtml(element: ElementDef, model: FieldsModel, text: FallbackText): string | null {
  if (isElementEmpty(element, model)) return null;
  return elementKind(element).fallbackHtml?.(fieldRead(element, model), text) ?? null;
}

function slotRow(id: string, html: string): string {
  // Defused like editor HTML: a `<section` in the slot (from an import)
  // must not nest the block format on the next read.
  return `<dd data-block-slot="el:${escapeHtml(id)}">${neutralizeSectionTags(html)}</dd>`;
}

/**
 * The block with rewritten config/data JSON and fallback HTML. Do not call it
 * for a `broken` block — it would be overwritten with "empty".
 */
export function serializeFields(block: BlockInstance, model: FieldsModel, text: FallbackText): BlockInstance {
  const known = new Set(model.elements.map((e) => e.id));
  const rows = model.elements.map((element) => {
    const dt = `<dt>${escapeHtml(text.label(element))}</dt>`;
    if (elementKind(element).storage === 'slot') {
      const slot = model.slots[element.id];
      return slot ? `${dt}${slotRow(element.id, slot)}` : '';
    }
    const html = fieldValueHtml(element, model, text);
    return html === null ? '' : `${dt}<dd>${html}</dd>`;
  });
  // Slots without a known element stay, like the orphaned values —
  // otherwise a link and its backlink would be silently lost with them.
  for (const [id, html] of Object.entries(model.slots)) {
    if (!known.has(id)) rows.push(slotRow(id, html));
  }
  const body = rows.join('');

  const attrs: Record<string, string> = {
    ...block.attrs,
    [BLOCK_ATTR.config]: JSON.stringify({
      elements: model.elements,
      display: model.display,
      ...(model.name ? { name: model.name } : {}),
      ...(model.icon ? { icon: model.icon } : {}),
      ...(model.definition ? { definition: model.definition } : {}),
    }),
  };
  const values = { ...model.orphans, ...model.values };
  if (Object.keys(values).length > 0) attrs[BLOCK_ATTR.data] = JSON.stringify({ values });
  else delete attrs[BLOCK_ATTR.data];

  return { ...block, attrs, html: body ? `<dl>${body}</dl>` : '' };
}

/* ---------------- Without rewriting ---------------- */

// Label and slot of an element in the fallback — the same bounds as SLOT_RE.
const SLOT_ROW_RE = /(?:<dt>[^<]*<\/dt>)?<dd\b[^<>]{0,256}?\bdata-block-slot="el:([^"]{1,200})"[^<>]{0,256}>[\s\S]*?<\/dd>/gi;

/** The block's data JSON, or `null` if it is missing or unreadable. */
function readValuesJson(block: BlockInstance): Record<string, unknown> | null {
  const parsed = parseJson(block.attrs[BLOCK_ATTR.data]);
  return parsed.ok && isRecord(parsed.value) && isRecord(parsed.value.values) ? parsed.value.values : null;
}

/**
 * The block without value and slot of these elements — a picture taken out
 * of its image fields ("Images"). Without `FallbackText`: only the data JSON
 * and the rows in the fallback are dropped, everything else stays byte for byte.
 */
export function withoutElementContent(block: BlockInstance, ids: ReadonlySet<string>): BlockInstance {
  if (ids.size === 0) return block;
  const values = readValuesJson(block);
  const attrs = { ...block.attrs };
  if (values) {
    const kept = Object.fromEntries(Object.entries(values).filter(([id]) => !ids.has(id)));
    attrs[BLOCK_ATTR.data] = JSON.stringify({ values: kept });
  }
  const html = block.html.replace(SLOT_ROW_RE, (row, id: string) => (ids.has(decodeHtmlAttr(id)) ? '' : row));
  return { ...block, attrs, html };
}

/** A new element of this kind, with its kind's own start settings. */
export function newElement(kind: FieldKindDef, uses: FieldUses): ElementDef {
  return { id: generateId(), kind: kind.id, label: '', uses: { ...uses }, ...kind.initialConfig?.() };
}

/** A new field block with exactly one element of this kind — shown in its block only (`NO_USES`). */
export function createFieldsBlock(kind: string): BlockInstance {
  const def = fieldKindOf(kind);
  if (!def) throw new Error(`Unknown field kind: ${kind}`);
  return {
    id: generateId(),
    type: FIELDS_BLOCK_TYPE,
    html: '',
    attrs: { [BLOCK_ATTR.config]: JSON.stringify({ elements: [newElement(def, NO_USES)], display: DEFAULT_DISPLAY }) },
  };
}
