import { escapeHtml } from '../internalLinkHtml';
import { generateId } from '../helpers';
import { decodeHtmlAttr, neutralizeSectionTags, parseBlocks, serializeBlocks } from './blockHtml';
import { BLOCK_ATTR, type BlockInstance, type BlockTypeId } from './types';

/**
 * Die drei Sigillen-Blöcke (seit v42; vorher eine eigene Ansicht mit eigenen
 * Spalten an `operations`):
 * - Rechner (`core.sigil.calc`): Absicht, Buchstabenbank, umgesetzte Buchstaben.
 * - Zeichnung (`core.sigil.canvas`): die Zeichnung als gespeichertes Bild —
 *   `<img src="{sha}.png">` im inneren HTML, damit das Bild-Aufräumen sie sieht.
 * - Ladung (`core.sigil.charge`): geladen, Zieldatum, Ladetechnik (als
 *   Link-Chip im Markup) und was „geladen" sperrt.
 *
 * Der Zustand des Eintrags — gesperrt, verborgen — ergibt sich aus dem
 * Ladung-Block (`sigilState`), nicht mehr aus der Kategorie „Sigillen".
 *
 * Rein und DOM-frei wie der Rest von `lib/blocks`: die Migration benutzt es.
 */

export const SIGIL_CALC_TYPE = 'core.sigil.calc' satisfies BlockTypeId;
export const SIGIL_CANVAS_TYPE = 'core.sigil.canvas' satisfies BlockTypeId;
export const SIGIL_CHARGE_TYPE = 'core.sigil.charge' satisfies BlockTypeId;

/** Steht im Inhalt, sobald er einen Sigillen-Block trägt — der billige Vorfilter vor dem Parsen. */
export const SIGIL_BLOCK_MARKER = 'data-block="core.sigil.';

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

/** Was eine geladene Sigille sperrt: den ganzen Eintrag (wie früher) oder nur Rechner und Zeichnung. */
export type SigilLockScope = 'entry' | 'sigil';

export interface SigilCharge {
  broken: boolean;
  loaded: boolean;
  /** `YYYY-MM-DD`; bis dahin bleibt eine geladene Sigille verborgen. */
  revealDate: string | null;
  lock: SigilLockScope;
  /** Inneres HTML des Ladetechnik-Slots (ein Link-Chip) — oder `null`. */
  technique: string | null;
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
  };
}

export function serializeSigilCharge(block: BlockInstance, charge: Omit<SigilCharge, 'broken'>): BlockInstance {
  const date = charge.revealDate ? `<p>${escapeHtml(charge.revealDate)}</p>` : '';
  // Entschärft wie Editor-HTML: ein `<section` im Chip darf das Blockformat nicht verschachteln.
  const technique = charge.technique ? `<p data-block-slot="technique">${neutralizeSectionTags(charge.technique)}</p>` : '';
  return withData(block, { loaded: charge.loaded, revealDate: charge.revealDate, lock: charge.lock }, date + technique);
}

/* ---------------- Zustand des Eintrags ---------------- */

export interface SigilState {
  /** Es gibt einen (lesbaren) Ladung-Block. */
  hasCharge: boolean;
  loaded: boolean;
  revealDate: string | null;
  lock: SigilLockScope;
  /** Geladen und das Zieldatum noch nicht erreicht: Rechner und Zeichnung bleiben verborgen — auch beim Bearbeiten. */
  concealed: boolean;
  /** Geladen mit Sperre „ganzer Eintrag": kein Bearbeiten, keine Änderung aus dem Lesemodus. */
  lockEntry: boolean;
  /** Geladen: Rechner und Zeichnung sind auch beim Bearbeiten schreibgeschützt. */
  lockSigil: boolean;
}

const NO_SIGIL: SigilState = {
  hasCharge: false, loaded: false, revealDate: null, lock: 'entry', concealed: false, lockEntry: false, lockSigil: false,
};

/** Der Zustand, den der erste lesbare Ladung-Block dem Eintrag gibt. */
export function sigilState(blocks: readonly BlockInstance[], today: string): SigilState {
  for (const block of blocks) {
    if (block.type !== SIGIL_CHARGE_TYPE) continue;
    const charge = parseSigilCharge(block);
    if (charge.broken) continue;
    const { loaded, revealDate, lock } = charge;
    return {
      hasCharge: true,
      loaded,
      revealDate,
      lock,
      concealed: loaded && (!revealDate || revealDate > today),
      lockEntry: loaded && lock === 'entry',
      lockSigil: loaded,
    };
  }
  return NO_SIGIL;
}

/** Der Inhalt ohne Rechner und Zeichnung, solange die Sigille verborgen ist — für Suche und Export. */
export function withoutConcealed(content: string, today: string): string {
  if (!content.includes(SIGIL_CHARGE_TYPE)) return content;
  const blocks = parseBlocks(content);
  if (!sigilState(blocks, today).concealed) return content;
  return serializeBlocks(blocks.filter((b) => !isSigilToolType(b.type)));
}

/** Der Inhalt mit entladener Sigille — eine Kopie des Eintrags soll sich bearbeiten lassen. */
export function withChargeUnloaded(content: string): string {
  if (!content.includes(SIGIL_CHARGE_TYPE)) return content;
  let changed = false;
  const blocks = parseBlocks(content).map((block) => {
    if (block.type !== SIGIL_CHARGE_TYPE) return block;
    const charge = parseSigilCharge(block);
    if (charge.broken || !charge.loaded) return block;
    changed = true;
    return serializeSigilCharge(block, { ...charge, loaded: false });
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
  return serializeSigilCharge(emptyBlock(SIGIL_CHARGE_TYPE), { loaded: false, revealDate: null, lock: 'entry', technique: null });
}

/** Das Sigillen-Set: Rechner, Zeichnung, Ladung — das Standardlayout der Kategorie „Sigillen". */
export function sigilBlockSet(): BlockInstance[] {
  return [createSigilCalcBlock(), createSigilCanvasBlock(), createSigilChargeBlock()];
}
