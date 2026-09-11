import { escapeHtml } from '../internalLinkHtml';
import { generateId } from '../helpers';
import { decodeHtmlAttr, neutralizeSectionTags, parseBlocks, serializeBlocks } from './blockHtml';
import {
  FIELDS_BLOCK_TYPE, isSigilKind, parseFields, withElementValue, withoutElementContent,
  type ElementDef, type FieldsModel, type SigilElementKind,
} from './fields';
import { BLOCK_ATTR, type BlockInstance, type BlockTypeId } from './types';

/**
 * Die drei Sigillen-Blöcke (seit v42; vorher eine eigene Ansicht mit eigenen
 * Spalten an `operations`):
 * - Rechner (`core.sigil.calc`): Absicht, Buchstabenbank, umgesetzte Buchstaben.
 * - Zeichnung (`core.sigil.canvas`): die Zeichnung als gespeichertes Bild —
 *   `<img src="{sha}.png">` im inneren HTML, damit das Bild-Aufräumen sie sieht.
 * - Ladung (`core.sigil.charge`): geladen, Zieldatum, Ladetechnik (als
 *   Link-Chip im Markup), was „geladen" sperrt und welche Rechner und
 *   Zeichnungen sie verdeckt.
 *
 * Der Zustand des Eintrags — gesperrt, welche Blöcke verborgen sind — ergibt
 * sich aus den Ladungen (`sigilState`), nicht mehr aus der Kategorie
 * „Sigillen".
 *
 * Dieselben drei gibt es als Teile eines eigenen Blocks (Feldarten
 * `sigilCalc`/`sigilCanvas`/`sigilCharge`). Ein Teil ist hier ein virtueller
 * Block mit der ID `<Block-ID>:<Element-ID>` (`sigilUnits`) — Laden, Verdecken
 * und Sperren unterscheiden nicht, ob eine Sigille ein Block oder ein Teil ist.
 *
 * Rein und DOM-frei wie der Rest von `lib/blocks`: die Migration benutzt es.
 */

export const SIGIL_CALC_TYPE = 'core.sigil.calc' satisfies BlockTypeId;
export const SIGIL_CANVAS_TYPE = 'core.sigil.canvas' satisfies BlockTypeId;
export const SIGIL_CHARGE_TYPE = 'core.sigil.charge' satisfies BlockTypeId;

/** Steht im Inhalt, sobald er einen Sigillen-Block trägt — der billige Vorfilter vor dem Parsen. */
export const SIGIL_BLOCK_MARKER = 'data-block="core.sigil.';

// Ein Sigillen-Teil steht im Config-JSON eines Feldblocks. Bewusst nur der
// Artname, ohne Anführungszeichen: die stehen entity-kodiert im Attribut, und
// ein importierter Inhalt kann sie anders kodieren (`&#34;`, einfache
// Anführungszeichen) — ein zu enger Vorfilter ließe verborgene Teile durch.
const SIGIL_ELEMENT_MARKERS = ['sigilCalc', 'sigilCanvas', 'sigilCharge'];

/** Kann der Inhalt eine Sigille tragen (Block oder Teil)? Der Vorfilter vor dem Parsen. */
export function mayHoldSigil(content: string): boolean {
  return content.includes('core.sigil.') || SIGIL_ELEMENT_MARKERS.some((m) => content.includes(m));
}

/** Kann der Inhalt eine Ladung tragen? Ohne Ladung ist nichts verborgen oder gesperrt. */
function mayHoldCharge(content: string): boolean {
  return content.includes(SIGIL_CHARGE_TYPE) || content.includes('sigilCharge');
}

/** Rechner und Zeichnung — was eine geladene Sigille verbirgt und sperrt. */
export function isSigilToolType(type: string): boolean {
  return type === SIGIL_CALC_TYPE || type === SIGIL_CANVAS_TYPE;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Die JSON-Daten eines Blocks. Unlesbares setzt `broken` — so ein Block wird nie überschrieben. */
function readData(block: BlockInstance): { broken: boolean; data: Record<string, unknown> } {
  const raw = block.attrs[BLOCK_ATTR.data];
  if (raw === undefined) return { broken: false, data: {} };
  try {
    const value: unknown = JSON.parse(raw);
    return isRecord(value) ? { broken: false, data: value } : { broken: true, data: {} };
  } catch {
    return { broken: true, data: {} };
  }
}

function withData(block: BlockInstance, data: Record<string, unknown>, html: string): BlockInstance {
  return { ...block, html, attrs: { ...block.attrs, [BLOCK_ATTR.data]: JSON.stringify(data) } };
}

/* ---------------- Datum und Text ---------------- */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && ISO_DATE.test(value);
}

/** Das heutige Datum als `YYYY-MM-DD`, lokal — so vergleicht es sich mit dem Zieldatum. */
export function todayIso(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Klartext als Absätze, eine Zeile je `<p>`, escaped. */
export function textParagraphs(text: string): string {
  return text.split('\n').map((line) => `<p>${escapeHtml(line)}</p>`).join('');
}

/* ---------------- Rechner ---------------- */

export interface SigilCalc {
  broken: boolean;
  intention: string;
  /** Die Buchstabenbank: jeder Buchstabe einmal, in der Reihenfolge seines Auftretens. */
  letters: string[];
  /** Die davon schon in der Zeichnung umgesetzten. */
  implemented: string[];
}

/**
 * Eine Buchstabenliste aus fremder Quelle: nur kurze Zeichenketten, höchstens
 * 500. Die Grenze schützt vor präparierten Importen — eine Bank aus
 * Hunderttausenden Einträgen legte sonst Migration und Rendern lahm.
 */
export function letterList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((l): l is string => typeof l === 'string' && l.length > 0 && l.length <= 8).slice(0, 500)
    : [];
}

/** Jeder Buchstabe einmal, großgeschrieben, ohne Akzente — wie die Sigillen-Ansicht es immer tat. */
export function extractUniqueLetters(input: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const char of input.normalize('NFKD').toUpperCase()) {
    if (!/\p{L}/u.test(char) || seen.has(char)) continue;
    seen.add(char);
    result.push(char);
  }
  return result;
}

/** Nur, was auch in der Bank steht. */
export function implementedIn(letters: readonly string[], implemented: readonly string[]): string[] {
  const bank = new Set(letters);
  return implemented.filter((l) => bank.has(l));
}

export function parseSigilCalc(block: BlockInstance): SigilCalc {
  const { broken, data } = readData(block);
  const letters = letterList(data.letters);
  return {
    broken,
    intention: typeof data.intention === 'string' ? data.intention : '',
    letters,
    implemented: implementedIn(letters, letterList(data.implemented)),
  };
}

/** Der Rechner mit neuen Daten; das innere HTML ist der lesbare Fallback (Absicht, Buchstaben). */
export function serializeSigilCalc(block: BlockInstance, calc: Omit<SigilCalc, 'broken'>): BlockInstance {
  const done = new Set(calc.implemented);
  const intention = calc.intention.trim() ? textParagraphs(calc.intention) : '';
  const letters = calc.letters.length
    ? `<p>${calc.letters.map((l) => (done.has(l) ? `<s>${escapeHtml(l)}</s>` : escapeHtml(l))).join(' ')}</p>`
    : '';
  return withData(block, { intention: calc.intention, letters: calc.letters, implemented: calc.implemented }, intention + letters);
}

/* ---------------- Zeichnung ---------------- */

/** Der Dateiname der Zeichnung — oder `null`. */
export function sigilImage(block: BlockInstance): string | null {
  const src = /\bsrc="([^"]*)"/i.exec(block.html)?.[1];
  return src ? decodeHtmlAttr(src) : null;
}

export function withSigilImage(block: BlockInstance, filename: string | null): BlockInstance {
  return { ...block, html: filename ? `<img src="${escapeHtml(filename)}" alt="">` : '' };
}

/* ---------------- Ladung ---------------- */

/** Was eine geladene Sigille sperrt: den ganzen Eintrag (wie früher) oder nur die verdeckten Rechner und Zeichnungen. */
export type SigilLockScope = 'entry' | 'sigil';

export interface SigilCharge {
  broken: boolean;
  loaded: boolean;
  /** `YYYY-MM-DD`; bis dahin bleibt eine geladene Sigille verborgen. Ohne Datum: bis zum Entladen. */
  revealDate: string | null;
  lock: SigilLockScope;
  /** Inneres HTML des Ladetechnik-Slots (ein Link-Chip) — oder `null`. */
  technique: string | null;
  /**
   * Die Block-IDs der Rechner und Zeichnungen, die diese Ladung verdeckt —
   * `null` heißt alle im Eintrag, auch später hinzugekommene (so verhielt sich
   * jede Ladung, bevor man wählen konnte).
   */
  targets: string[] | null;
}

// Eine Block-ID, oder `<Block-ID>:<Element-ID>` für den Teil eines eigenen Blocks.
const TARGET_ID_RE = /^[\w-]{1,64}(?::[\w-]{1,64})?$/;

/** Block-IDs aus fremder Quelle: nur kurze, harmlose Zeichenketten, höchstens 100. */
function targetList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const ids = value.filter((id): id is string => typeof id === 'string' && TARGET_ID_RE.test(id));
  return [...new Set(ids)].slice(0, 100);
}

// Die Attribut-Abschnitte begrenzt: ungebremst liefe der Regex auf präpariertem
// Markup („<p " hunderttausendfach) quadratisch — und er läuft für jede Karte.
const TECHNIQUE_RE = /<p\b[^<>]{0,256}?\bdata-block-slot="technique"[^<>]{0,256}>([\s\S]*?)<\/p>/i;

export function parseSigilCharge(block: BlockInstance): SigilCharge {
  const { broken, data } = readData(block);
  const technique = TECHNIQUE_RE.exec(block.html)?.[1];
  return {
    broken,
    loaded: data.loaded === true,
    revealDate: isIsoDate(data.revealDate) ? data.revealDate : null,
    lock: data.lock === 'sigil' ? 'sigil' : 'entry',
    technique: technique?.trim() ? technique : null,
    targets: targetList(data.targets),
  };
}

export function serializeSigilCharge(block: BlockInstance, charge: Omit<SigilCharge, 'broken'>): BlockInstance {
  const date = charge.revealDate ? `<p>${escapeHtml(charge.revealDate)}</p>` : '';
  // Entschärft wie Editor-HTML: ein `<section` im Chip darf das Blockformat nicht verschachteln.
  const technique = charge.technique ? `<p data-block-slot="technique">${neutralizeSectionTags(charge.technique)}</p>` : '';
  const data: Record<string, unknown> = { loaded: charge.loaded, revealDate: charge.revealDate, lock: charge.lock };
  if (charge.targets) data.targets = charge.targets;
  return withData(block, data, date + technique);
}

/** Verdeckt die Ladung gerade: geladen, und das Zieldatum ist nicht erreicht (oder es gibt keins). */
export function chargeConceals(charge: Pick<SigilCharge, 'loaded' | 'revealDate'>, today: string): boolean {
  return charge.loaded && (!charge.revealDate || charge.revealDate > today);
}

/** Verdeckt diese Ladung den Rechner oder die Zeichnung mit dieser ID? */
export function chargeCovers(charge: Pick<SigilCharge, 'targets'>, blockId: string): boolean {
  return charge.targets === null || charge.targets.includes(blockId);
}

/* ---------------- Teile eigener Blöcke ---------------- */

const KIND_TYPES: Record<SigilElementKind, string> = {
  sigilCalc: SIGIL_CALC_TYPE,
  sigilCanvas: SIGIL_CANVAS_TYPE,
  sigilCharge: SIGIL_CHARGE_TYPE,
};

/** Die ID, unter der ein Teil als Sigille geführt wird — auch das Ziel, das eine Ladung speichert. */
export function sigilPartId(blockId: string, elementId: string): string {
  return `${blockId}:${elementId}`;
}

/** Der Teil als virtueller Block: sein Wert als Daten-JSON, sein Slot als inneres HTML. */
export function sigilPartBlock(
  block: BlockInstance,
  element: ElementDef & { kind: SigilElementKind },
  model: FieldsModel,
): BlockInstance {
  const value = model.values[element.id];
  return {
    id: sigilPartId(block.id, element.id),
    type: KIND_TYPES[element.kind],
    html: model.slots[element.id] ?? '',
    attrs: value !== undefined ? { [BLOCK_ATTR.data]: JSON.stringify(value) } : {},
  };
}

/** Zurück in das Modell: Daten-JSON als Wert, inneres HTML als Slot (leer = kein Slot). */
export function withSigilPart(model: FieldsModel, element: ElementDef, part: BlockInstance): FieldsModel {
  const values = { ...model.values };
  const slots = { ...model.slots };
  const raw = part.attrs[BLOCK_ATTR.data];
  if (raw !== undefined) values[element.id] = JSON.parse(raw) as Record<string, unknown>;
  if (part.html) slots[element.id] = part.html;
  else delete slots[element.id];
  return { ...model, values, slots };
}

/** Eine Sigille des Eintrags: ein Block, oder der Teil eines eigenen Blocks (dann mit Element und Feldblock). */
export interface SigilUnit {
  block: BlockInstance;
  part?: { parent: BlockInstance; element: ElementDef };
}

/**
 * Alle Sigillen des Eintrags in Stapelreihenfolge, Teile als virtuelle Blöcke.
 * Archivierte Rechner und Zeichnungen zählen mit — ihr Inhalt steht noch im
 * Block und muss verborgen bleiben; eine archivierte Ladung nicht, sie ließe
 * sich nirgends mehr entladen.
 */
export function sigilUnits(blocks: readonly BlockInstance[]): SigilUnit[] {
  const units: SigilUnit[] = [];
  for (const block of blocks) {
    if (block.type.startsWith('core.sigil.')) {
      units.push({ block });
      continue;
    }
    if (block.type !== FIELDS_BLOCK_TYPE) continue;
    const model = parseFields(block);
    if (model.broken) continue;
    for (const element of model.elements) {
      if (!isSigilKind(element.kind) || (element.archived && element.kind === 'sigilCharge')) continue;
      units.push({ block: sigilPartBlock(block, { ...element, kind: element.kind }, model), part: { parent: block, element } });
    }
  }
  return units;
}

/* ---------------- Zustand des Eintrags ---------------- */

export interface SigilState {
  /** Das Zieldatum der ersten geladenen Ladung, sonst der ersten — was die Karte in der Liste zeigt. */
  revealDate: string | null;
  /** Eine geladene Ladung mit Sperre „ganzer Eintrag": kein Bearbeiten, keine Änderung aus dem Lesemodus. */
  lockEntry: boolean;
  /**
   * Die verborgenen Rechner und Zeichnungen — Block-ID → das Datum, bis zu dem
   * sie verborgen bleiben (`null`: bis zum Entladen). Verborgen auch beim
   * Bearbeiten, sonst zeigte „Bearbeiten" (Sperre „nur Sigille") sie vorzeitig.
   */
  concealed: ReadonlyMap<string, string | null>;
  /** Rechner und Zeichnungen, die eine geladene Ladung auch beim Bearbeiten schreibgeschützt macht. */
  locked: ReadonlySet<string>;
}

/** Sperrt eine geladene Ladung den Block selbst oder einen seiner Teile? Dann kein Duplizieren — die Kopie wäre nicht verdeckt. */
export function blockHoldsLocked(state: SigilState, blockId: string): boolean {
  if (state.locked.has(blockId)) return true;
  const prefix = `${blockId}:`;
  for (const id of state.locked) if (id.startsWith(prefix)) return true;
  return false;
}

/**
 * Darf der Block nicht umgebaut werden — aktualisieren auf eine neue Revision,
 * aus Einträgen entfernen? So lange er einen gesperrten Teil trägt oder selbst
 * eine geladene Ladung ist bzw. enthält: fiele die Ladung beim Umbau weg (ein
 * archivierter Teil zählt nicht), wäre die Sigille entladen, ohne dass jemand
 * „Entladen" gedrückt hat.
 */
export function isSigilFrozen(block: BlockInstance, state: SigilState): boolean {
  return blockHoldsLocked(state, block.id)
    || sigilUnits([block]).some((u) => u.block.type === SIGIL_CHARGE_TYPE && parseSigilCharge(u.block).loaded);
}

/**
 * Ein duplizierter Feldblock: die Ladung-Teile der Kopie zielen auf die Teile
 * der Kopie, nicht mehr auf die des Originals — sonst verbärge das Laden der
 * Kopie das Original und ließe die eigenen Teile offen.
 */
export function withRenamedPartTargets(block: BlockInstance, oldId: string, newId: string): BlockInstance {
  const from = `${oldId}:`;
  let result = block;
  for (const unit of sigilUnits([block])) {
    if (!unit.part || unit.block.type !== SIGIL_CHARGE_TYPE) continue;
    const charge = parseSigilCharge(unit.block);
    if (charge.broken || !charge.targets?.some((id) => id.startsWith(from))) continue;
    const targets = charge.targets.map((id) => (id.startsWith(from) ? `${newId}:${id.slice(from.length)}` : id));
    const next = serializeSigilCharge(unit.block, { ...charge, targets });
    result = withElementValue(result, unit.part.element.id, JSON.parse(next.attrs[BLOCK_ATTR.data]));
  }
  return result;
}

const NO_SIGIL: SigilState = { revealDate: null, lockEntry: false, concealed: new Map(), locked: new Set() };

/** Von zwei Ladungen, die denselben Block verbergen, gilt die längere — „bis zum Entladen" am längsten. */
function laterReveal(a: string | null, b: string | null): string | null {
  return a === null || b === null ? null : a > b ? a : b;
}

/**
 * Der Zustand, den die Ladungen dem Eintrag geben — Blöcke und Teile gleich.
 * Jede geladene Ladung wirkt auf die Rechner und Zeichnungen, die sie
 * verdeckt; unlesbare zählen nicht.
 */
export function sigilState(blocks: readonly BlockInstance[], today: string): SigilState {
  const units = sigilUnits(blocks).map((u) => u.block);
  const charges = units
    .filter((b) => b.type === SIGIL_CHARGE_TYPE)
    .map(parseSigilCharge)
    .filter((c) => !c.broken);
  if (charges.length === 0) return NO_SIGIL;

  const concealed = new Map<string, string | null>();
  const locked = new Set<string>();
  let lockEntry = false;
  for (const charge of charges) {
    if (!charge.loaded) continue;
    if (charge.lock === 'entry') lockEntry = true;
    const hides = chargeConceals(charge, today);
    for (const block of units) {
      if (!isSigilToolType(block.type) || !chargeCovers(charge, block.id)) continue;
      locked.add(block.id);
      if (!hides) continue;
      concealed.set(block.id, concealed.has(block.id)
        ? laterReveal(concealed.get(block.id)!, charge.revealDate)
        : charge.revealDate);
    }
  }
  const shown = charges.find((c) => c.loaded) ?? charges[0];
  return { revealDate: shown.revealDate, lockEntry, concealed, locked };
}

/** Die Element-IDs der verborgenen Teile dieses Feldblocks. */
function concealedParts(block: BlockInstance, concealed: ReadonlyMap<string, string | null>): Set<string> {
  const prefix = `${block.id}:`;
  const ids = new Set<string>();
  for (const id of concealed.keys()) if (id.startsWith(prefix)) ids.add(id.slice(prefix.length));
  return ids;
}

/**
 * Ein Feldblock ohne Wert und Slot seiner verborgenen Teile — für jede Stelle,
 * die sein gespeichertes HTML zeigt statt ihn zu lesen (unbekannter Typ, zu
 * neues Format, Export des Fallbacks).
 */
export function withoutConcealedParts(block: BlockInstance, concealed: ReadonlyMap<string, string | null>): BlockInstance {
  return block.type === FIELDS_BLOCK_TYPE ? withoutElementContent(block, concealedParts(block, concealed)) : block;
}

/** Der Inhalt ohne die verborgenen Rechner und Zeichnungen (Blöcke und Teile) — für Suche und Export. */
export function withoutConcealed(content: string, today: string): string {
  if (!mayHoldCharge(content)) return content;
  const blocks = parseBlocks(content);
  const { concealed } = sigilState(blocks, today);
  if (concealed.size === 0) return content;
  return serializeBlocks(blocks.filter((b) => !concealed.has(b.id)).map((b) => withoutConcealedParts(b, concealed)));
}

/** Der Inhalt mit entladener Sigille — eine Kopie des Eintrags soll sich bearbeiten lassen. */
export function withChargeUnloaded(content: string): string {
  if (!mayHoldCharge(content)) return content;
  let changed = false;
  const unload = (block: BlockInstance): BlockInstance | null => {
    const charge = parseSigilCharge(block);
    return charge.broken || !charge.loaded ? null : serializeSigilCharge(block, { ...charge, loaded: false });
  };
  const blocks = parseBlocks(content).map((block) => {
    if (block.type === SIGIL_CHARGE_TYPE) {
      const next = unload(block);
      if (next) changed = true;
      return next ?? block;
    }
    let result = block;
    for (const unit of sigilUnits([block])) {
      if (!unit.part || unit.block.type !== SIGIL_CHARGE_TYPE) continue;
      const next = unload(unit.block);
      if (!next) continue;
      changed = true;
      // Nur das Daten-JSON: „geladen" steht nicht in der Lesefassung des Slots.
      result = withElementValue(result, unit.part.element.id, JSON.parse(next.attrs[BLOCK_ATTR.data]));
    }
    return result;
  });
  return changed ? serializeBlocks(blocks) : content;
}

/* ---------------- Neu ---------------- */

function emptyBlock(type: string): BlockInstance {
  return { id: generateId(), type, html: '', attrs: {} };
}

export function createSigilCalcBlock(): BlockInstance {
  return serializeSigilCalc(emptyBlock(SIGIL_CALC_TYPE), { intention: '', letters: [], implemented: [] });
}

export function createSigilCanvasBlock(): BlockInstance {
  return emptyBlock(SIGIL_CANVAS_TYPE);
}

export function createSigilChargeBlock(): BlockInstance {
  return serializeSigilCharge(emptyBlock(SIGIL_CHARGE_TYPE), {
    loaded: false, revealDate: null, lock: 'entry', technique: null, targets: null,
  });
}

/** Das Sigillen-Set: Rechner, Zeichnung, Ladung — das Standardlayout der Kategorie „Sigillen". */
export function sigilBlockSet(): BlockInstance[] {
  return [createSigilCalcBlock(), createSigilCanvasBlock(), createSigilChargeBlock()];
}
