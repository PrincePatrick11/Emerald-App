import { escapeHtml, extractInternalLinks, internalLinkChipHtml, isValidLinkTarget } from '../internalLinkHtml';
import { generateId } from '../helpers';
import { storedImageName } from '../schema';
import { MOON_PHASE_ORDER, MOON_PHASE_SYMBOLS } from '../moonPhase';
import type { ContentType, MoonPhase } from '../../types';
import { decodeHtmlAttr, neutralizeSectionTags } from './blockHtml';
import { BLOCK_ATTR, type BlockInstance, type BlockTypeId } from './types';

/**
 * Der Feldblock (`core.fields`): eine Folge von Elementen — Kurztext, Zahl,
 * Datum, Auswahl, Ja/Nein, Checkliste, Verknüpfung, Bild, Mondphase, Altar
 * (eine Verknüpfung auf einen Altar, groß mit seinem Bild gezeigt) und die
 * drei Sigillen-Teile Rechner, Zeichnung, Ladung (siehe `isSigilKind`). Ein
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
  'shorttext', 'number', 'date', 'select', 'toggle', 'checklist', 'link', 'image', 'moon', 'altar',
  'sigilCalc', 'sigilCanvas', 'sigilCharge',
] as const;
export type ElementKind = (typeof ELEMENT_KINDS)[number];

const KIND_SET: ReadonlySet<string> = new Set(ELEMENT_KINDS);
/** Elementarten, deren Wert im Markup steht statt im JSON. */
const SLOT_KINDS: ReadonlySet<ElementKind> = new Set<ElementKind>(['link', 'image', 'altar']);

export function isSlotKind(kind: ElementKind): boolean {
  return SLOT_KINDS.has(kind);
}

export type SigilElementKind = 'sigilCalc' | 'sigilCanvas' | 'sigilCharge';

/**
 * Die Sigillen-Teile eines eigenen Blocks: Rechner, Zeichnung, Ladung — was
 * es sonst als eigene Blöcke gibt (`lib/blocks/sigil.ts`). Ein Teil speichert
 * genau das, was der Block speichert: sein Daten-JSON als Wert unter der
 * Element-ID, sein inneres HTML (Lesefassung, Zeichnung als `<img>`,
 * Ladetechnik als Chip) im Slot. `sigil.ts` behandelt ihn deshalb als
 * „virtuellen Block" mit der ID `<Block-ID>:<Element-ID>` — Laden, Verdecken
 * und Sperren gelten für Teile wie für Blöcke.
 */
export function isSigilKind(kind: ElementKind): kind is SigilElementKind {
  return kind === 'sigilCalc' || kind === 'sigilCanvas' || kind === 'sigilCharge';
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
  /**
   * Entfernt, aber nicht vergessen: in der Definition gelöscht oder bei einer
   * Aktualisierung weggefallen. Unsichtbar in Lesen, Bearbeiten und Fallback —
   * der Wert bleibt stehen und kommt zurück, wenn das Element es tut.
   */
  archived?: boolean;
  /**
   * Nur in einer eigenen Block-Definition: der Wert, mit dem jede neue Kopie
   * das Element vorbelegt (Checkliste mit Punkten, Ja/Nein auf „Ja", ein
   * verknüpfter Eintrag …). Die Kopie trägt ihn als Wert, nicht als Vorgabe.
   * Verknüpfung und Altar geben ihr Ziel an, Bild seinen Dateinamen — erst die
   * Kopie schreibt daraus Chip bzw. `<img>` in ihren Slot (`slotFromDefault`).
   * So steht in der Definition kein Markup, und Merge-Import und Bild-Aufräumen
   * finden Ziel-ID und Datei.
   */
  defaultValue?: ElementDefault;
  /** Nur Sigillen-Rechner: welche Wege zur Buchstabenbank er anbietet — fehlt = beide. */
  calcMode?: CalcMode;
  /** Nur Sigillen-Zeichnung: Farbe und Pinselgröße, mit denen das Zeichnen beginnt. */
  brushColor?: string;
  brushSize?: number;
}

/** Wie der Rechner zur Buchstabenbank kommt: aus der Absicht, von Hand oder beides. */
export type CalcMode = 'auto' | 'manual' | 'both';
export const CALC_MODES: readonly CalcMode[] = ['both', 'auto', 'manual'];

/** Die Grenzen des Pinsels — dieselben wie der Regler der Zeichnung. */
export const BRUSH_SIZE_MIN = 2;
export const BRUSH_SIZE_MAX = 48;

/**
 * Die Vorgabe einer Ladung: was „geladen" sperrt und was sie verdeckt — `null`
 * heißt alle Sigillen im Eintrag, sonst Element-IDs der Rechner und
 * Zeichnungen desselben Blocks. Erst die Kopie macht daraus Ziele
 * (`<Block-ID>:<Element-ID>`), denn ihre Block-ID steht vorher nicht fest.
 */
export interface ChargeDefault {
  lock: 'entry' | 'sigil';
  targets: string[] | null;
}

/** Die Vorgabe einer Verknüpfung (oder eines Altars): das Ziel samt dem Namen zum Zeitpunkt der Wahl. */
export interface LinkDefault {
  id: string;
  entryType: ContentType;
  label: string;
}

export type ElementDefault = FieldValue | LinkDefault | ChargeDefault;

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

/** Das Daten-JSON eines Sigillen-Teils — geprüft wird es erst von `sigil.ts`, beim Lesen des virtuellen Blocks. */
export type SigilData = Record<string, unknown>;

export type FieldValue = string | number | boolean | ChecklistItem[] | SigilData;

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
  /** Name und Icon (Emoji) der eigenen Block-Definition, aus der der Block kopiert wurde — leer bei einzelnen Feldern. */
  name: string;
  icon: string;
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
  if (raw.archived === true) element.archived = true;
  if (element.kind === 'sigilCalc' && CALC_MODES.includes(raw.calcMode as CalcMode)) element.calcMode = raw.calcMode as CalcMode;
  if (element.kind === 'sigilCanvas') {
    if (typeof raw.brushColor === 'string' && /^#[0-9a-f]{6}$/i.test(raw.brushColor)) element.brushColor = raw.brushColor;
    if (Number.isInteger(raw.brushSize) && (raw.brushSize as number) >= BRUSH_SIZE_MIN && (raw.brushSize as number) <= BRUSH_SIZE_MAX) {
      element.brushSize = raw.brushSize as number;
    }
  }
  if (raw.defaultValue !== undefined) {
    const value = parseDefault(element, raw.defaultValue);
    if (value !== undefined) element.defaultValue = value;
  }
  return element;
}

/** Eine Elementliste aus unsicherer Quelle (Inhalt, Import, Datenbank): Ungültiges und doppelte IDs fallen weg. */
export function parseElements(raw: unknown): ElementDef[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  return raw.map(parseElement).filter((e): e is ElementDef => {
    if (!e || seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  });
}

/** Anzeigeregeln aus unsicherer Quelle; Fehlendes nach `DEFAULT_DISPLAY`. */
export function parseDisplay(raw: unknown): DisplayRules {
  const rules = isRecord(raw) ? raw : {};
  return {
    readHideEmpty: typeof rules.readHideEmpty === 'boolean' ? rules.readHideEmpty : DEFAULT_DISPLAY.readHideEmpty,
    readOnly: typeof rules.readOnly === 'boolean' ? rules.readOnly : DEFAULT_DISPLAY.readOnly,
  };
}

/** Die Elemente, die der Block zeigt — ohne die archivierten. */
export function activeElements(model: FieldsModel): ElementDef[] {
  return model.elements.filter((e) => !e.archived);
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
    case 'sigilCalc':
    case 'sigilCanvas':
    case 'sigilCharge':
      return isRecord(raw) ? raw : undefined;
    default:
      return undefined;
  }
}

// Die Attribut-Abschnitte begrenzt (IDs sind ohnehin höchstens 64 Zeichen):
// ungebremst liefe der Regex auf präpariertem Markup quadratisch.
const SLOT_RE = /<dd\b[^<>]{0,256}?\bdata-block-slot="el:([^"]{1,200})"[^<>]{0,256}>([\s\S]*?)<\/dd>/gi;

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
  };
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

/* ---------------- Vorgaben ---------------- */

/**
 * Eine Vorgabe aus unsicherer Quelle (Datenbank, Backup, `.emerald`), geprüft
 * nach der Art des Elements — `undefined` für alles, was nicht passt.
 */
function parseDefault(element: ElementDef, raw: unknown): ElementDefault | undefined {
  switch (element.kind) {
    case 'link':
    case 'altar': {
      if (!isRecord(raw) || !isValidLinkTarget(raw)) return undefined;
      if (element.kind === 'altar' && raw.entryType !== 'altar') return undefined;
      return {
        id: raw.id as string,
        // `isValidLinkTarget` hat die Art gegen die Liste geprüft.
        entryType: String(raw.entryType).trim() as ContentType,
        label: typeof raw.label === 'string' ? raw.label : '',
      };
    }
    case 'image':
      return typeof raw === 'string' ? storedImageName(raw) ?? undefined : undefined;
    case 'sigilCharge': {
      if (!isRecord(raw)) return undefined;
      const targets = Array.isArray(raw.targets)
        ? [...new Set(raw.targets.filter((id): id is string => typeof id === 'string' && isSafeElementId(id)))].slice(0, 100)
        : null;
      return { lock: raw.lock === 'sigil' ? 'sigil' : 'entry', targets };
    }
    case 'sigilCalc':
    case 'sigilCanvas':
      return undefined; // Rechner und Zeichnung beginnen leer.
    default: {
      const value = parseValue(element.kind, raw);
      // Eine Auswahl-Vorgabe nur auf eine Option, die es noch gibt — sonst bekäme jede Kopie einen toten Wert.
      const stale = element.kind === 'select' && !element.options?.some((o) => o.id === value);
      return stale ? undefined : value;
    }
  }
}

function isLinkDefault(value: ElementDefault | undefined): value is LinkDefault {
  return isRecord(value) && typeof value.id === 'string';
}

/** Der Slot-Inhalt, den eine Vorgabe in der Kopie ergibt — Chip oder `<img>`; `null` für Nicht-Slot-Arten. */
export function slotFromDefault(element: ElementDef): string | null {
  const value = element.defaultValue;
  if (element.kind === 'image') return typeof value === 'string' ? imageSlotHtml(value) : null;
  if (!isSlotKind(element.kind) || !isLinkDefault(value)) return null;
  return internalLinkChipHtml({ id: value.id, entryType: value.entryType, label: value.label });
}

/**
 * Umgekehrt: die Vorgabe, die ein Slot-Inhalt ergibt (Baukasten) — `undefined`
 * für leer oder Unbrauchbares. Durch dieselbe Prüfung wie beim Lesen, damit
 * nichts gespeichert wird, was `parseElement` später verwürfe.
 */
export function defaultFromSlot(element: ElementDef, html: string | null): ElementDefault | undefined {
  if (!html) return undefined;
  return parseDefault(element, element.kind === 'image' ? imageFromSlot(html) : linkFromSlot(html));
}

/** Der Slot eines Bildfelds: ein echtes `<img src>` — so findet das Bild-Aufräumen die Datei. */
export function imageSlotHtml(filename: string): string {
  return `<img src="${escapeHtml(filename)}">`;
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
    case 'altar':
    case 'sigilCalc':
      return !model.slots[element.id];
    case 'sigilCanvas':
    case 'sigilCharge':
      // Die Ladung: Laden und Entladen gehören in den Lesemodus. Die Zeichnung:
      // ihr Speichern überdauert „Fertig" und braucht die montierte Komponente.
      return false;
  }
}

/** Kann ein Element dieser Art leer sein? Ja/Nein, Zeichnung und Ladung nie — für sie gibt es kein „leer ausblenden". */
export function canBeEmpty(kind: ElementKind): boolean {
  return kind !== 'toggle' && kind !== 'sigilCanvas' && kind !== 'sigilCharge';
}

/** Blendet der Lesemodus dieses Element aus? Archiviert, oder leer UND (Element- oder Blockregel). */
export function isHiddenInRead(element: ElementDef, model: FieldsModel): boolean {
  return !!element.archived
    || (isElementEmpty(element, model) && (element.hideWhenEmpty ?? model.display.readHideEmpty));
}

/* ---------------- Schreiben ---------------- */

/** Was der lesbare Fallback in der aktuellen Sprache sagt — die Aufrufer reichen `t` hinein. */
export interface FallbackText {
  label: (element: ElementDef) => string;
  yes: string;
  no: string;
  moonName: (phase: MoonPhase) => string;
}

/** Der Wert eines Feldes als HTML (kein Slot) — `null` für leer. Fallback und Export teilen ihn. */
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
    if (isSlotKind(element.kind) || isSigilKind(element.kind)) {
      const slot = model.slots[element.id];
      // Archiviert: ohne Beschriftung, aber der Slot bleibt — mit ihm Link und Bild.
      if (!slot) return '';
      return element.archived ? slotRow(element.id, slot) : `${dt}${slotRow(element.id, slot)}`;
    }
    if (element.archived) return '';
    const html = fieldValueHtml(element, model, text);
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
    [BLOCK_ATTR.config]: JSON.stringify({
      elements: model.elements,
      display: model.display,
      ...(model.name ? { name: model.name } : {}),
      ...(model.icon ? { icon: model.icon } : {}),
    }),
  };
  const values = { ...model.orphans, ...model.values };
  if (Object.keys(values).length > 0) attrs[BLOCK_ATTR.data] = JSON.stringify({ values });
  else delete attrs[BLOCK_ATTR.data];

  return { ...block, attrs, html: body ? `<dl>${body}</dl>` : '' };
}

/* ---------------- Ohne Neuschreiben ---------------- */

// Beschriftung und Slot eines Elements im Fallback — dieselben Grenzen wie SLOT_RE.
const SLOT_ROW_RE = /(?:<dt>[^<]*<\/dt>)?<dd\b[^<>]{0,256}?\bdata-block-slot="el:([^"]{1,200})"[^<>]{0,256}>[\s\S]*?<\/dd>/gi;

/** Das Daten-JSON des Blocks, oder `null`, wenn es fehlt oder unlesbar ist. */
function readValuesJson(block: BlockInstance): Record<string, unknown> | null {
  const parsed = parseJson(block.attrs[BLOCK_ATTR.data]);
  return parsed.ok && isRecord(parsed.value) && isRecord(parsed.value.values) ? parsed.value.values : null;
}

/**
 * Der Block ohne Wert und Slot dieser Elemente — für Suche und Export, wenn
 * eine Sigille Teile verbirgt. Ohne `FallbackText`: nur Daten-JSON und die
 * Zeilen im Fallback fallen weg, sonst bleibt alles Byte für Byte.
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

/** Der Block mit einem neuen Wert für dieses Element — nur im Daten-JSON, der Fallback bleibt. */
export function withElementValue(block: BlockInstance, id: string, value: FieldValue): BlockInstance {
  const values = readValuesJson(block) ?? {};
  return { ...block, attrs: { ...block.attrs, [BLOCK_ATTR.data]: JSON.stringify({ values: { ...values, [id]: value } }) } };
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
