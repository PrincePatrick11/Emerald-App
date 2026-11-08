import type { AltarPlacement, AltarShapeStyle, AltarShapeType, AltarSymbolStyle, AltarTextStyle } from '../types';
import { generateId, isValidHexColor } from './helpers';
import { MAX_SIDES, MIN_SIDES, emptyPaintDoc, paintDocFromJson, paintDocToJson } from './paint/document';
import { DEFAULT_WEIGHT, MAX_WEIGHT, MIN_WEIGHT, isSymbolPath } from '../components/editors/canvas/symbols/limits';
import { SYMBOLS_BY_ID } from '../components/editors/canvas/symbols/packs';

/**
 * Shapes, text and drawings made on an altar. They hang on no library item,
 * so they are not rows of `altar_placements` (whose `item_id` is required) but
 * a JSON list in `altars.elements` (since v56). In the store they are
 * placements with `kind` 'shape', 'text', 'drawing' or 'symbol', with the same position,
 * size, stacking and switches as an item's placement; `item_id` is empty.
 *
 * Positions and box sizes in the units of a placement (`x`/`y` in percent of
 * the altar, `width`/`height` as in `altarScene.ts`), font size, outline
 * width and corner radius in pixels at the reference width of 1920. A
 * drawing is stored as the paint document's JSON (`paintDocToJson`).
 */

const SHAPES: readonly AltarShapeType[] = ['rect', 'ellipse', 'polygon', 'triangle', 'star', 'hexagon'];
const FONTS: readonly AltarTextStyle['font'][] = ['serif', 'book', 'sans'];
const ALIGNS: readonly AltarTextStyle['align'][] = ['left', 'center', 'right'];

function num(v: unknown, fallback: number, min = -Infinity, max = Infinity): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}

const color = (v: unknown): string | null => (typeof v === 'string' && isValidHexColor(v) ? v : null);

function shapeStyle(raw: unknown): AltarShapeStyle {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    type: SHAPES.includes(s.type as AltarShapeType) ? (s.type as AltarShapeType) : 'rect',
    fill: color(s.fill),
    stroke: color(s.stroke),
    stroke_width: num(s.stroke_width, 0, 0, 400),
    corner_radius: num(s.corner_radius, 0, 0, 4000),
    ...(s.sides !== undefined ? { sides: Math.round(num(s.sides, 5, MIN_SIDES, MAX_SIDES)) } : {}),
  };
}

function textStyle(raw: unknown): AltarTextStyle {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    content: typeof s.content === 'string' ? s.content : '',
    font: FONTS.includes(s.font as AltarTextStyle['font']) ? (s.font as AltarTextStyle['font']) : 'serif',
    size: num(s.size, 48, 4, 4000),
    color: color(s.color) ?? '#f4ecd8',
    align: ALIGNS.includes(s.align as AltarTextStyle['align']) ? (s.align as AltarTextStyle['align']) : 'center',
    bold: s.bold === true,
    italic: s.italic === true,
  };
}

/** A symbol's style; a path that is not plain path data falls back to the library's for its id, or the first symbol's. */
function symbolStyle(raw: unknown): AltarSymbolStyle {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const id = typeof s.symbol === 'string' ? s.symbol : '';
  const known = SYMBOLS_BY_ID.get(id) ?? SYMBOLS_BY_ID.values().next().value!;
  return {
    symbol: isSymbolPath(s.d) || SYMBOLS_BY_ID.has(id) ? id : known.id,
    d: isSymbolPath(s.d) ? s.d : known.d,
    color: color(s.color) ?? '#d4af37',
    weight: num(s.weight, DEFAULT_WEIGHT, MIN_WEIGHT, MAX_WEIGHT),
    fill: color(s.fill),
  };
}

/**
 * The drawn elements of an altar from the content of `altars.elements`.
 * Anything unusable is left out or falls back to a default — the text may come
 * from a foreign file.
 */
export function parseAltarElements(raw: unknown, altarId: string): AltarPlacement[] {
  let list: unknown = raw;
  if (typeof raw === 'string') {
    try {
      list = JSON.parse(raw);
    } catch {
      list = [];
    }
  }
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const result: AltarPlacement[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    if (e.kind !== 'shape' && e.kind !== 'text' && e.kind !== 'drawing' && e.kind !== 'symbol') continue;
    const id = typeof e.id === 'string' && e.id && !seen.has(e.id) ? e.id : generateId();
    seen.add(id);
    const shape = e.kind === 'shape' ? shapeStyle(e.shape) : undefined;
    const text = e.kind === 'text' ? textStyle(e.text) : undefined;
    const symbol = e.kind === 'symbol' ? symbolStyle(e.symbol) : undefined;
    // A drawing without layer images: those come only from old sigil drawings.
    const drawing = e.kind === 'drawing' ? paintDocFromJson(e.drawing) ?? emptyPaintDoc() : undefined;
    result.push({
      id,
      altar_id: altarId,
      kind: e.kind,
      item_id: '',
      name: '',
      emoji: '',
      category_id: null,
      x: num(e.x, 50, 0, 100),
      y: num(e.y, 50, 0, 100),
      z_index: Math.round(num(e.z_index, 0, 0)),
      width: num(e.width, 40, 0.1, 2000),
      height: num(e.height, 40, 0.1, 2000),
      rotation: num(e.rotation, 0, -360, 360),
      opacity: num(e.opacity, 1, 0.05, 1),
      locked: e.locked === true,
      hidden: e.hidden === true,
      ...(typeof e.group === 'string' && e.group ? { group: e.group } : {}),
      ...(shape ? { shape } : {}),
      ...(text ? { text } : {}),
      ...(drawing ? { drawing } : {}),
      ...(symbol ? { symbol } : {}),
    });
  }
  return result;
}

export const isDrawn = (p: Pick<AltarPlacement, 'kind'>): boolean => p.kind !== 'item';

/** The content of `altars.elements` for the drawn ones among `placements`, in a fixed key order. */
export function altarElementsJson(placements: readonly AltarPlacement[]): string {
  return JSON.stringify(
    placements.filter(isDrawn).map((p) => ({
      id: p.id,
      kind: p.kind,
      x: p.x,
      y: p.y,
      z_index: p.z_index,
      width: p.width,
      height: p.height,
      rotation: p.rotation,
      opacity: p.opacity,
      locked: p.locked,
      hidden: p.hidden,
      ...(p.group ? { group: p.group } : {}),
      ...(p.kind === 'shape' ? { shape: p.shape ?? shapeStyle({}) } : {}),
      ...(p.kind === 'text' ? { text: p.text ?? textStyle({}) } : {}),
      ...(p.kind === 'drawing' ? { drawing: paintDocToJson(p.drawing ?? emptyPaintDoc()) } : {}),
      ...(p.kind === 'symbol' ? { symbol: p.symbol ?? symbolStyle({}) } : {}),
    })),
  );
}

/** The same elements under new ids, for a copied altar: ids are unique across all altars. */
export function withNewElementIds(raw: unknown, altarId: string): string {
  return altarElementsJson(parseAltarElements(raw, altarId).map((p) => ({ ...p, id: generateId() })));
}

/** What the sidebar calls a drawn element: its text, the kind of shape, `drawingName`, or the symbol's name. */
export function drawnLabel(
  p: AltarPlacement,
  shapeName: (type: AltarShapeType) => string,
  drawingName = '',
  symbolName: (id: string) => string = (id) => id,
): string {
  if (p.kind === 'drawing') return drawingName;
  if (p.kind === 'symbol') return symbolName(p.symbol?.symbol ?? '');
  if (p.kind === 'text') return p.text?.content.split('\n')[0].trim() || '…';
  return shapeName(p.shape?.type ?? 'rect');
}
