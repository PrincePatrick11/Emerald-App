import { escapeHtml, extractInternalLinks } from '../internalLinkHtml';
import { generateId } from '../helpers';
import { MOON_PHASE_ORDER, MOON_PHASE_SYMBOLS } from '../moonPhase';
import type { MoonPhase } from '../../types';
import { decodeHtmlAttr, neutralizeSectionTags } from './blockHtml';
import { BLOCK_ATTR, type BlockInstance, type BlockTypeId } from './types';

/**
 * Der Feldblock (`core.fields`): eine Folge von Elementen — Kurztext, Zahl,
 * Datum, Auswahl, Ja/Nein, Checkliste, Verknüpfung, Bild, Mondphase. Ein
 * einzelnes Feld ist ein Feldblock mit einem Element; eigene, zusammengesetzte
 * Blöcke (Blöcke-Ansicht) sind Feldblöcke mit mehreren.
 *
 * Wo was steht — dieselbe Konvention wie für alle Blöcke:
 * - `data-block-config` (JSON): die Elemente und die Anzeigeregeln.
 * - `data-block-data` (JSON): skalare Werte, unter der ID ihres Elements.
 * - Verweise und Bilder stehen NICHT im JSON, sondern als echter Link-Chip bzw.
 *   `<img src>` im inneren HTML, in einem `<dd data-block-slot="el:<id>">`.
 *   So finden Link-Tabelle, Backlinks, Merge-Import-Remap und Bild-Aufräumen
 *   sie ohne Sonderfall.
 * - Das innere HTML ist zugleich der lesbare Fallback (`<dl>` mit Beschriftung
 *   und Wert) für Suche, Export und eine App, die den Typ nicht kennt. Es wird
 *   bei jeder Änderung neu geschrieben; die Wahrheit für Skalare ist das JSON.
 *
 * Rein und DOM-frei wie der Rest von `lib/blocks`. Slot-Inhalte sind ein Chip
 * oder ein Bild, nie ein `</dd>` — deshalb reicht zum Lesen ein Regex.
 */

export const FIELDS_BLOCK_TYPE = 'core.fields' satisfies BlockTypeId;

export const ELEMENT_KINDS = [
  'shorttext', 'number', 'date', 'select', 'toggle', 'checklist', 'link', 'image', 'moon',
] as const;
export type ElementKind = (typeof ELEMENT_KINDS)[number];

const KIND_SET: ReadonlySet<string> = new Set(ELEMENT_KINDS);
/** Elementarten, deren Wert im Markup steht statt im JSON. */
const SLOT_KINDS: ReadonlySet<ElementKind> = new Set<ElementKind>(['link', 'image']);

export function isSlotKind(kind: ElementKind): boolean {
  return SLOT_KINDS.has(kind);
}

/** Der i18n-Key für den Namen einer Elementart — Picker, Beschriftung, Platzhalter. */
export function elementKindLabelKey(kind: ElementKind): string {
  return `blocks.kinds.${kind}`;
}

export interface SelectOption {
  id: string;
  label: string;
}

export interface ElementDef {
  id: string;
  kind: ElementKind;
  /** Leer = Name der Elementart in der aktuellen Sprache. */
  label: string;
  /** Nur Auswahl. Werte speichern die Options-ID, Umbenennen verliert nichts. */
  options?: SelectOption[];
  /** Überschreibt `display.readHideEmpty` für dieses Element. */
  hideWhenEmpty?: boolean;
}

export interface DisplayRules {
  /** Leere Elemente im Lesemodus ausblenden. */
  readHideEmpty: boolean;
  /** Auch im Lesemodus nichts abhaken oder umschalten. */
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
   * Config oder Daten sind vorhanden, aber nicht lesbar. Ein solcher Block wird
   * wie ein unbekannter angezeigt und NIE geschrieben — sonst überschriebe die
   * nächste Änderung die unlesbaren Originaldaten mit „leer".
   */
  broken: boolean;
  elements: ElementDef[];
  display: DisplayRules;
  /** Skalare Werte bekannter Elemente, geprüft nach ihrer Art. */
  values: Record<string, FieldValue>;
  /**
   * Werte ohne bekanntes Element — unverändert zurückgeschrieben. (Ein Wert der
   * falschen Art für ein bekanntes Element fällt dagegen weg; ein neues
   * Wertformat käme mit einer neuen `data-block-v` und würde gar nicht gelesen.)
   */
  orphans: Record<string, unknown>;
  /** Element-ID → inneres HTML seines Slots (Link-Chip oder `<img>`), auch ohne bekanntes Element. */
  slots: Record<string, string>;
}

/* ---------------- Lesen ---------------- */

function parseJson(raw: string | undefined): { ok: boolean; value: unknown } {
  if (raw === undefined) return { ok: true, value: undefined };
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false, value: undefined };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Eine Element-ID muss harmlos sein: sie wird Schlüssel in `values`/`slots`
 * und Attributwert im Markup. Ein Name wie `constructor` oder `__proto__` aus
 * einer präparierten Import-Datei läse sonst eingebaute Objekt-Eigenschaften
 * als Slot-Inhalt — und das Rendern bräche ab.
 */
const ELEMENT_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function isSafeElementId(id: string): boolean {
  return ELEMENT_ID_RE.test(id) && !(id in Object.prototype);
}

/** Ein Schlüssel-Wert-Objekt ohne Prototyp — was darin nicht steht, gibt es nicht. */
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
  return element;
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

const SLOT_RE = /<dd\b[^>]*?\bdata-block-slot="el:([^"]+)"[^>]*>([\s\S]*?)<\/dd>/gi;

// Blöcke sind unveränderliche Werte: dasselbe Objekt, dasselbe Modell. Der
// Stapel, die Seitenleiste, Name und Icon lesen denselben Block pro Render
// mehrfach — ohne Cache hieße das mehrmals JSON.parse pro Tastendruck.
const modelCache = new WeakMap<BlockInstance, FieldsModel>();

/** Das Modell eines Feldblocks. Wirft nie — Unlesbares setzt `broken`. */
export function parseFields(block: BlockInstance): FieldsModel {
  const cached = modelCache.get(block);
  if (cached) return cached;

  const config = parseJson(block.attrs[BLOCK_ATTR.config]);
  const data = parseJson(block.attrs[BLOCK_ATTR.data]);
  const broken = !config.ok || !data.ok
    || (config.value !== undefined && (!isRecord(config.value)
      || (config.value.elements !== undefined && !Array.isArray(config.value.elements))))
    || (data.value !== undefined && (!isRecord(data.value)
      || (data.value.values !== undefined && !isRecord(data.value.values))));

  const cfg = isRecord(config.value) ? config.value : {};
  const elements = Array.isArray(cfg.elements)
    ? cfg.elements.map(parseElement).filter((e): e is ElementDef => e !== null)
    : [];
  const rawDisplay = isRecord(cfg.display) ? cfg.display : {};
  const display: DisplayRules = {
    readHideEmpty: typeof rawDisplay.readHideEmpty === 'boolean' ? rawDisplay.readHideEmpty : DEFAULT_DISPLAY.readHideEmpty,
    readOnly: typeof rawDisplay.readOnly === 'boolean' ? rawDisplay.readOnly : DEFAULT_DISPLAY.readOnly,
  };

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

  const model: FieldsModel = { broken, elements, display, values, orphans, slots };
  modelCache.set(block, model);
  return model;
}

/** Ziel des Link-Chips in einem Slot, samt gespeichertem Label — oder `null`. */
export function linkFromSlot(html: string | undefined): { id: string; entryType: string; label: string } | null {
  if (typeof html !== 'string' || !html) return null;
  const [link] = extractInternalLinks(html);
  if (!link) return null;
  const label = /\bdata-label="([^"]*)"/i.exec(html)?.[1];
  return { ...link, label: label !== undefined ? decodeHtmlAttr(label) : '' };
}

/** Der gespeicherte Bild-Dateiname in einem Slot — oder `null`. */
export function imageFromSlot(html: string | undefined): string | null {
  const src = typeof html === 'string' ? /\bsrc="([^"]*)"/i.exec(html)?.[1] : undefined;
  return src ? decodeHtmlAttr(src) : null;
}

/* ---------------- Leer / sichtbar ---------------- */

/**
 * Hat das Element keinen (gültigen) Wert? Ja/Nein ist nie leer: ungesetzt
 * heißt „Nein" — so zeigen Eingabe, Lesemodus und Fallback dasselbe.
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
    case 'link':
    case 'image':
      return !model.slots[element.id];
  }
}

/** Blendet der Lesemodus dieses Element aus? Leer UND (Element- oder Blockregel). */
export function isHiddenInRead(element: ElementDef, model: FieldsModel): boolean {
  return isElementEmpty(element, model) && (element.hideWhenEmpty ?? model.display.readHideEmpty);
}

/* ---------------- Schreiben ---------------- */

/** Was der lesbare Fallback in der aktuellen Sprache sagt — die Aufrufer reichen `t` hinein. */
export interface FallbackText {
  label: (element: ElementDef) => string;
  yes: string;
  no: string;
  moonName: (phase: MoonPhase) => string;
}

function valueHtml(element: ElementDef, model: FieldsModel, text: FallbackText): string | null {
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
      return `<ul>${(value as ChecklistItem[])
        .map((item) => `<li>${item.checked ? '☑' : '☐'} ${escapeHtml(item.text)}</li>`)
        .join('')}</ul>`;
    case 'moon':
      return `${MOON_PHASE_SYMBOLS[value as MoonPhase]} ${escapeHtml(text.moonName(value as MoonPhase))}`;
    default:
      return null;
  }
}

function slotRow(id: string, html: string): string {
  // Entschärft wie Editor-HTML: ein `<section` im Slot (aus einem Import)
  // darf das Blockformat beim nächsten Lesen nicht verschachteln.
  return `<dd data-block-slot="el:${escapeHtml(id)}">${neutralizeSectionTags(html)}</dd>`;
}

/**
 * Der Block mit neu geschriebenem Config-/Daten-JSON und Fallback-HTML. Für
 * einen `broken` Block nicht aufrufen — er würde mit „leer" überschrieben.
 */
export function serializeFields(block: BlockInstance, model: FieldsModel, text: FallbackText): BlockInstance {
  const known = new Set(model.elements.map((e) => e.id));
  const rows = model.elements.map((element) => {
    const dt = `<dt>${escapeHtml(text.label(element))}</dt>`;
    if (isSlotKind(element.kind)) {
      const slot = model.slots[element.id];
      return slot ? `${dt}${slotRow(element.id, slot)}` : '';
    }
    const html = valueHtml(element, model, text);
    return html === null ? '' : `${dt}<dd>${html}</dd>`;
  });
  // Slots ohne bekanntes Element bleiben stehen, wie die verwaisten Werte —
  // mit ihnen ginge sonst ein Link samt Rückverweis still verloren.
  for (const [id, html] of Object.entries(model.slots)) {
    if (!known.has(id)) rows.push(slotRow(id, html));
  }
  const body = rows.join('');

  const attrs: Record<string, string> = {
    ...block.attrs,
    [BLOCK_ATTR.config]: JSON.stringify({ elements: model.elements, display: model.display }),
  };
  const values = { ...model.orphans, ...model.values };
  if (Object.keys(values).length > 0) attrs[BLOCK_ATTR.data] = JSON.stringify({ values });
  else delete attrs[BLOCK_ATTR.data];

  return { ...block, attrs, html: body ? `<dl>${body}</dl>` : '' };
}

/** Ein neuer Feldblock mit genau einem Element dieser Art. */
export function createFieldsBlock(kind: ElementKind): BlockInstance {
  const element: ElementDef = { id: generateId(), kind, label: '' };
  if (kind === 'select') element.options = [];
  return {
    id: generateId(),
    type: FIELDS_BLOCK_TYPE,
    html: '',
    attrs: { [BLOCK_ATTR.config]: JSON.stringify({ elements: [element], display: DEFAULT_DISPLAY }) },
  };
}
