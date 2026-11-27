import {
  Calendar, ChevronsUpDown, Hash, Image, Link2, ListChecks, ListFilter, Moon, PanelRight, Rows3, TextCursorInput, ToggleLeft, Type,
  type LucideIcon,
} from 'lucide-react';
import { escapeHtml, internalLinkChipHtml, isBlankContent, isValidLinkTarget, linkTargetKindOf, decodeHtmlAttr } from '../internalLinkHtml';
import { generateId, isRecord } from '../helpers';
import { storedImageName } from '../schema';
import { MOON_PHASE_ORDER, MOON_PHASE_SYMBOLS } from '../moonPhase';
import type { LinkTargetKind, MoonPhase } from '../../types';
import { neutralizeSectionTags } from './blockHtml';
import { imageFromSlot, linkFromSlot, normalizeLinkCategoryFilter, translatedOr, type LinkCategoryFilter } from './toolkit';
import { BLOCK_ATTR, type BlockInstance, type BlockTypeId } from './types';

/**
 * The field block (`core.fields`): a sequence of elements — text, short text, number,
 * date, select, yes/no, checklist, link, image, moon phase. A
 * single field is a field block with one element; custom, composite
 * blocks (blocks view) are field blocks with several.
 *
 * Where things are — the same convention as for all blocks:
 * - `data-block-config` (JSON): the elements and the display rules.
 * - `data-block-data` (JSON): scalar values, under the ID of their element.
 * - References, images and text are NOT in the JSON, but stand as a real link chip,
 *   `<img src>` or the text editor's HTML in the inner HTML, in a
 *   `<dd data-block-slot="el:<id>">`.
 *   That way the link table, backlinks, merge-import remap and image cleanup
 *   find them without a special case.
 * - The inner HTML is also the readable fallback (`<dl>` with label
 *   and value) for search, export and an app that does not know the type. It is
 *   rewritten on every change; the truth for scalars is the JSON.
 *
 * Pure and DOM-free like the rest of `lib/blocks`. Slot contents are a chip,
 * an image or TipTap HTML (whose schema has no definition lists), never
 * a `</dd>` — so a regex is enough for reading.
 */

export const FIELDS_BLOCK_TYPE = 'core.fields' satisfies BlockTypeId;

export const ELEMENT_KINDS = [
  'text', 'shorttext', 'number', 'date', 'select', 'toggle', 'checklist', 'link', 'image', 'moon',
] as const;
export type ElementKind = (typeof ELEMENT_KINDS)[number];

const KIND_SET: ReadonlySet<string> = new Set(ELEMENT_KINDS);
/** Element kinds whose value is in the markup instead of the JSON. */
const SLOT_KINDS: ReadonlySet<ElementKind> = new Set<ElementKind>(['text', 'link', 'image']);

export function isSlotKind(kind: ElementKind): boolean {
  return SLOT_KINDS.has(kind);
}

/** The i18n key for the name of an element kind — picker, label, placeholder. */
export function elementKindLabelKey(kind: ElementKind): string {
  return `blocks.kinds.${kind}`;
}

/** The icon of an element kind — picker, builder, a single field's block. */
export const ELEMENT_KIND_ICONS: Record<ElementKind, LucideIcon> = {
  text: Type,
  shorttext: TextCursorInput,
  number: Hash,
  date: Calendar,
  select: ChevronsUpDown,
  toggle: ToggleLeft,
  checklist: ListChecks,
  link: Link2,
  image: Image,
  moon: Moon,
};

export interface SelectOption {
  id: string;
  label: string;
}

export interface ElementDef {
  id: string;
  kind: ElementKind;
  /** Empty = name of the element kind in the current language. */
  label: string;
  /** Select only. Values store the option ID, renaming loses nothing. */
  options?: SelectOption[];
  /** Overrides `display.readHideEmpty` for this element. */
  hideWhenEmpty?: boolean;
  /**
   * Only in a custom block definition: the value with which every new copy
   * prefills the element (checklist with items, yes/no set to "yes", a
   * linked entry …). The copy carries it as a value, not as a default.
   * Link gives its target, image its file name — only the
   * copy writes a chip or `<img>` from it into its slot (`slotFromDefault`).
   * That way the definition contains no markup, and merge import and image cleanup
   * find target ID and file.
   */
  defaultValue?: ElementDefault;
  /**
   * Link only: the search offers just entries and tasks of these categories (and,
   * with `includeUncategorized`, those without one). Missing = no filter.
   * A link already set stays, whatever its category.
   */
  linkCategories?: LinkCategoryFilter;
  /**
   * How the field shows outside its block (`FieldUse`) — set in the builder
   * and travelling with every copy like the rest of the element. A use not
   * stored is off: nothing shows outside unasked. The builder writes the
   * start values of a new field (`initialUses`) out.
   */
  uses?: Partial<FieldUses>;
}

/* ---------------- Uses outside the block ---------------- */

/**
 * The block's settings per field (interface 14, for user-built blocks): does
 * the field appear in the entry's info line in lists, in the properties
 * panel, among the values dashboards filter and sort by. The fields block
 * reads them in its interfaces 1, 3 and 4/9 (`kinds/fields.ts`).
 */
export const FIELD_USES = ['info', 'panel', 'values'] as const;
export type FieldUse = (typeof FIELD_USES)[number];
export type FieldUses = Record<FieldUse, boolean>;

/** How a field's setting is shown, alike in the builder and in the block's sidebar. */
export const FIELD_USE_SETTINGS: Readonly<Record<FieldUse, { icon: LucideIcon; labelKey: string; hintKey: string }>> = {
  info: { icon: Rows3, labelKey: 'blocks.fields.uses.info', hintKey: 'blocks.fields.uses.infoHint' },
  panel: { icon: PanelRight, labelKey: 'blocks.fields.uses.panel', hintKey: 'blocks.fields.uses.panelHint' },
  values: { icon: ListFilter, labelKey: 'blocks.fields.uses.values', hintKey: 'blocks.fields.uses.valuesHint' },
};

/** Kinds a new builder field offers to filter and sort by from the start (others may be switched on, as far as `canUse` allows). */
const VALUES_ON_AT_START: ReadonlySet<ElementKind> = new Set<ElementKind>(['date', 'number', 'select', 'toggle', 'link', 'shorttext']);

/**
 * Can a field of this kind be used so? A picture has no value to show or
 * filter by, a long text none to filter by.
 */
export function canUse(kind: ElementKind, use: FieldUse): boolean {
  if (kind === 'image') return false;
  return use !== 'values' || kind !== 'text';
}

/** The start values of a new field of a custom block: the panel on, filtering for short values, the info line off. */
export function initialUses(kind: ElementKind): FieldUses {
  return { info: false, panel: canUse(kind, 'panel'), values: VALUES_ON_AT_START.has(kind) };
}

/** A single field (added on its own) starts with every use off: it is shown in its block, not twice. */
export const NO_USES: FieldUses = { info: false, panel: false, values: false };

/** How the field is used — as stored, off where nothing is; never what its kind cannot do. */
export function elementUses(element: ElementDef): FieldUses {
  const used = (use: FieldUse) => canUse(element.kind, use) && element.uses?.[use] === true;
  return { info: used('info'), panel: used('panel'), values: used('values') };
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

export { normalizeLinkCategoryFilter, passesLinkCategoryFilter, type LinkCategoryFilter } from './toolkit';

/** The default of a link: the target together with its name at the time of selection. */
interface LinkDefault {
  id: string;
  targetKind: LinkTargetKind;
  label: string;
}

export type ElementDefault = FieldValue | LinkDefault;

export interface DisplayRules {
  /** Hide empty elements in read mode. */
  readHideEmpty: boolean;
  /** Do not tick or toggle anything in read mode either. */
  readOnly: boolean;
}

export const DEFAULT_DISPLAY: DisplayRules = { readHideEmpty: true, readOnly: false };

export interface ChecklistItem {
  id: string;
  text: string;
  checked: boolean;
}

export type FieldValue = string | number | boolean | ChecklistItem[];

export interface FieldsModel {
  /**
   * Config or data are present but not readable. Such a block is displayed
   * like an unknown one and NEVER written — otherwise the next change would
   * overwrite the unreadable original data with "empty".
   */
  broken: boolean;
  elements: ElementDef[];
  display: DisplayRules;
  /** Scalar values of known elements, validated by their kind. */
  values: Record<string, FieldValue>;
  /**
   * Values without a known element — written back unchanged. (A value of the
   * wrong kind for a known element, on the other hand, is dropped; a new
   * value format would come with a new `data-block-v` and not be read at all.)
   */
  orphans: Record<string, unknown>;
  /** Element ID → inner HTML of its slot (link chip or `<img>`), also without a known element. */
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

function parseElement(raw: unknown): ElementDef | null {
  if (!isRecord(raw) || typeof raw.id !== 'string' || !isSafeElementId(raw.id)
    || typeof raw.kind !== 'string' || !KIND_SET.has(raw.kind)) {
    return null;
  }
  const element: ElementDef = {
    id: raw.id,
    kind: raw.kind as ElementKind,
    label: typeof raw.label === 'string' ? raw.label : '',
  };
  if (Array.isArray(raw.options)) {
    element.options = raw.options
      .filter((o): o is Record<string, unknown> => isRecord(o) && typeof o.id === 'string')
      .map((o) => ({ id: o.id as string, label: typeof o.label === 'string' ? o.label : '' }));
  }
  if (typeof raw.hideWhenEmpty === 'boolean') element.hideWhenEmpty = raw.hideWhenEmpty;
  if (element.kind === 'link' && isRecord(raw.linkCategories)) {
    const ids = Array.isArray(raw.linkCategories.categoryIds)
      ? raw.linkCategories.categoryIds.filter((i): i is string => typeof i === 'string')
      : [];
    const filter = normalizeLinkCategoryFilter({ categoryIds: ids, includeUncategorized: raw.linkCategories.includeUncategorized === true });
    if (filter) element.linkCategories = filter;
  }
  if (isRecord(raw.uses)) {
    const uses: Partial<FieldUses> = {};
    for (const use of FIELD_USES) if (typeof raw.uses[use] === 'boolean') uses[use] = raw.uses[use];
    element.uses = uses;
  }
  if (raw.defaultValue !== undefined) {
    const value = parseDefault(element, raw.defaultValue);
    if (value !== undefined) element.defaultValue = value;
  }
  return element;
}

/** An element list from an unreliable source (content, import, database): invalid entries and duplicate IDs are dropped. */
export function parseElements(raw: unknown): ElementDef[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  return raw.map(parseElement).filter((e): e is ElementDef => {
    if (!e || seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  });
}

/** Display rules from an unreliable source; anything missing falls back to `DEFAULT_DISPLAY`. */
export function parseDisplay(raw: unknown): DisplayRules {
  const rules = isRecord(raw) ? raw : {};
  return {
    readHideEmpty: typeof rules.readHideEmpty === 'boolean' ? rules.readHideEmpty : DEFAULT_DISPLAY.readHideEmpty,
    readOnly: typeof rules.readOnly === 'boolean' ? rules.readOnly : DEFAULT_DISPLAY.readOnly,
  };
}

function parseValue(kind: ElementKind, raw: unknown): FieldValue | undefined {
  switch (kind) {
    case 'shorttext':
    case 'date':
    case 'select':
    case 'moon':
      return typeof raw === 'string' ? raw : undefined;
    case 'number':
      return typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined;
    case 'toggle':
      return typeof raw === 'boolean' ? raw : undefined;
    case 'checklist':
      return Array.isArray(raw)
        ? raw
            .filter((i): i is Record<string, unknown> => isRecord(i) && typeof i.id === 'string')
            .map((i) => ({ id: i.id as string, text: typeof i.text === 'string' ? i.text : '', checked: i.checked === true }))
        : undefined;
    default:
      return undefined;
  }
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
    // An element of a kind this version does not know would be dropped on
    // reading and lost on the next save; the block stays as it is instead.
    || (isRecord(config.value) && Array.isArray(config.value.elements)
      && config.value.elements.some((e) => isRecord(e) && typeof e.kind === 'string' && !KIND_SET.has(e.kind)));

  const cfg = isRecord(config.value) ? config.value : {};
  const elements = parseElements(cfg.elements);
  const display = parseDisplay(cfg.display);

  const rawValues = isRecord(data.value) && isRecord(data.value.values) ? data.value.values : {};
  const values = bareRecord<FieldValue>();
  const orphans = bareRecord<unknown>();
  const byId = new Map(elements.map((e) => [e.id, e]));
  for (const [id, raw] of Object.entries(rawValues)) {
    const element = byId.get(id);
    if (!element) {
      if (isSafeElementId(id)) orphans[id] = raw;
      continue;
    }
    if (isSlotKind(element.kind)) continue;
    const value = parseValue(element.kind, raw);
    if (value !== undefined) values[id] = value;
  }

  const slots = bareRecord<string>();
  for (const m of block.html.matchAll(SLOT_RE)) {
    const id = decodeHtmlAttr(m[1]);
    if (isSafeElementId(id) && m[2].trim()) slots[id] = m[2];
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

/* ---------------- Defaults ---------------- */

/**
 * A default from an unreliable source (database, backup, `.emerald`), validated
 * by the element's kind — `undefined` for anything that does not fit.
 */
function parseDefault(element: ElementDef, raw: unknown): ElementDefault | undefined {
  switch (element.kind) {
    case 'link': {
      if (!isRecord(raw) || !isValidLinkTarget(raw)) return undefined;
      return {
        id: raw.id as string,
        // `isValidLinkTarget` has checked the kind against the list.
        targetKind: linkTargetKindOf(String(raw.targetKind)),
        label: typeof raw.label === 'string' ? raw.label : '',
      };
    }
    case 'image':
      return typeof raw === 'string' ? storedImageName(raw) ?? undefined : undefined;
    case 'text':
      return undefined; // Text starts empty.
    default: {
      const value = parseValue(element.kind, raw);
      // A select default only for an option that still exists — otherwise every copy would get a dead value.
      const stale = element.kind === 'select' && !element.options?.some((o) => o.id === value);
      return stale ? undefined : value;
    }
  }
}

function isLinkDefault(value: ElementDefault | undefined): value is LinkDefault {
  return isRecord(value) && typeof value.id === 'string';
}

/** The slot content that a default yields in the copy — chip or `<img>`; `null` for non-slot kinds. */
export function slotFromDefault(element: ElementDef): string | null {
  const value = element.defaultValue;
  if (element.kind === 'image') return typeof value === 'string' ? imageSlotHtml(value) : null;
  if (!isSlotKind(element.kind) || !isLinkDefault(value)) return null;
  return internalLinkChipHtml({ id: value.id, targetKind: value.targetKind, label: value.label });
}

/**
 * The reverse: the default that a slot content yields (builder) — `undefined`
 * for empty or unusable input. Through the same validation as when reading, so
 * that nothing is saved that `parseElement` would later discard.
 */
export function defaultFromSlot(element: ElementDef, html: string | null): ElementDefault | undefined {
  // Text has no default (it would be markup in the definition).
  if (!html || element.kind === 'text') return undefined;
  return parseDefault(element, element.kind === 'image' ? imageFromSlot(html) : linkFromSlot(html));
}

/** The slot of an image field: a real `<img src>` — that is how the image cleanup finds the file. */
export function imageSlotHtml(filename: string): string {
  return `<img src="${escapeHtml(filename)}">`;
}

/* ---------------- Empty / visible ---------------- */

/**
 * Does the element have no (valid) value? Yes/no is never empty: unset
 * means "no" — so input, read mode and fallback show the same.
 */
export function isElementEmpty(element: ElementDef, model: FieldsModel): boolean {
  const value = model.values[element.id];
  switch (element.kind) {
    case 'shorttext':
    case 'date':
      return typeof value !== 'string' || !value.trim();
    case 'number':
      return typeof value !== 'number';
    case 'select':
      return typeof value !== 'string' || !element.options?.some((o) => o.id === value);
    case 'toggle':
      return false;
    case 'checklist':
      return !Array.isArray(value) || value.length === 0;
    case 'moon':
      return !MOON_PHASE_ORDER.includes(value as MoonPhase);
    case 'text':
      // Visible content counts — an empty heading or an empty bullet point does not.
      return isBlankContent(model.slots[element.id] ?? '');
    case 'link':
    case 'image':
      return !model.slots[element.id];
  }
}

/** Can an element of this kind be empty? Yes/no never — for it there is no "hide when empty". */
export function canBeEmpty(kind: ElementKind): boolean {
  return kind !== 'toggle';
}

/** Does read mode hide this element? Empty AND (element or block rule). */
export function isHiddenInRead(element: ElementDef, model: FieldsModel): boolean {
  return isElementEmpty(element, model) && (element.hideWhenEmpty ?? model.display.readHideEmpty);
}

/* ---------------- Writing ---------------- */

/** What the readable fallback says in the current language — the callers pass `t` in. */
export interface FallbackText {
  label: (element: ElementDef) => string;
  yes: string;
  no: string;
  moonName: (phase: MoonPhase) => string;
}

/** The label of a field element in the language of `t`: its own, otherwise the name of its kind. */
export function elementLabel(t: (key: string) => string, element: ElementDef): string {
  const named = fieldLabel(element);
  return 'label' in named ? named.label : t(named.labelKey);
}

/** The texts with which `serializeFields` writes the readable fallback — in the language of `t`. */
export function fieldFallbackText(t: (key: string) => string): FallbackText {
  return {
    label: (element) => elementLabel(t, element),
    yes: translatedOr(t, 'blocks.fields.yes', 'Yes'),
    no: translatedOr(t, 'blocks.fields.no', 'No'),
    moonName: (phase) => translatedOr(t, `moonPhase.${phase}`, phase),
  };
}

/** A checklist as readable markup — fallback and export alike. */
export function checklistHtml(items: readonly ChecklistItem[]): string {
  return `<ul>${items.map((item) => `<li>${item.checked ? '☑' : '☐'} ${escapeHtml(item.text)}</li>`).join('')}</ul>`;
}

/** The value of a field as HTML (not a slot) — `null` for empty — for the readable fallback. The export maps the same kinds to values (`fieldExportValue` in `kinds/fields.ts`). */
export function fieldValueHtml(element: ElementDef, model: FieldsModel, text: FallbackText): string | null {
  if (isElementEmpty(element, model)) return null;
  const value = model.values[element.id];
  switch (element.kind) {
    case 'shorttext':
    case 'date':
      return escapeHtml(value as string);
    case 'number':
      return String(value);
    case 'select':
      return escapeHtml(element.options!.find((o) => o.id === value)!.label);
    case 'toggle':
      return escapeHtml(value === true ? text.yes : text.no);
    case 'checklist':
      return checklistHtml(value as ChecklistItem[]);
    case 'moon':
      return `${MOON_PHASE_SYMBOLS[value as MoonPhase]} ${escapeHtml(text.moonName(value as MoonPhase))}`;
    default:
      return null;
  }
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
    if (isSlotKind(element.kind)) {
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

/** A new field block with exactly one element of this kind — shown in its block only (`NO_USES`). */
export function createFieldsBlock(kind: ElementKind): BlockInstance {
  const element: ElementDef = { id: generateId(), kind, label: '', uses: { ...NO_USES } };
  if (kind === 'select') element.options = [];
  return {
    id: generateId(),
    type: FIELDS_BLOCK_TYPE,
    html: '',
    attrs: { [BLOCK_ATTR.config]: JSON.stringify({ elements: [element], display: DEFAULT_DISPLAY }) },
  };
}
