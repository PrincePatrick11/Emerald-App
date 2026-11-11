import { generateId } from '../helpers';
import { escapeHtml } from '../internalLinkHtml';
import { storedImageName } from '../schema';
import { createTextBlock, decodeHtmlAttr } from './blockHtml';
import { BLOCK_ATTR, type BlockInstance, type BlockTypeId } from './types';

/**
 * The canvas block: a scene of the canvas editor in an entry — pictures from
 * "Images", shapes, text, symbols and drawings on an artboard.
 *
 * The scene is the block's data JSON (`CanvasScene`): the artboard's size,
 * the elements as the canvas editor has them, and the background, guides and
 * their lock. A picture element keeps its stored file in `ref` and
 * `props.src` (the place turns it into a URL to show). What the block offers
 * — which parts — is its config JSON (`CanvasParts`), set in the block's
 * settings and in templates.
 *
 * The inner HTML holds the rendered picture of the scene first
 * (`data-canvas="render"`, for the export and the card), then every stored
 * file the scene uses (`data-canvas="image"`, `"background"`), so that
 * backups, exports and the image cleanup find them as they find every other
 * image.
 */
export const CANVAS_BLOCK_TYPE = 'core.canvas' satisfies BlockTypeId;
/**
 * The altar: the same canvas with "Images" below it to drag from, a type of
 * its own so that it is offered, named and iconed as one. Same data.
 */
export const ALTAR_BLOCK_TYPE = 'core.altar' satisfies BlockTypeId;

/** A canvas or an altar: both are scenes of the canvas editor. */
export function isCanvasBlockType(type: string): boolean {
  return type === CANVAS_BLOCK_TYPE || type === ALTAR_BLOCK_TYPE;
}

/** The artboard of a new canvas, in its own pixels. */
export const CANVAS_BLOCK_WIDTH = 1600;
export const CANVAS_BLOCK_HEIGHT = 1000;

/**
 * The parts a canvas block offers; painting covers the drawing element and
 * its tools. `images` is "Images" below the canvas; a picture can always be
 * inserted from the tool column.
 */
export interface CanvasParts {
  images: boolean;
  shapes: boolean;
  text: boolean;
  symbols: boolean;
  drawing: boolean;
}

export const ALL_CANVAS_PARTS: CanvasParts = { images: true, shapes: true, text: true, symbols: true, drawing: true };

/** What a block of the type offers until its settings say otherwise: a plain canvas without "Images" below. */
export function defaultCanvasParts(type: string): CanvasParts {
  return type === ALTAR_BLOCK_TYPE ? ALL_CANVAS_PARTS : { ...ALL_CANVAS_PARTS, images: false };
}
export const CANVAS_PART_KEYS = Object.keys(ALL_CANVAS_PARTS) as (keyof CanvasParts)[];

/** One element as stored: the canvas editor's element, with what its type keeps in `props`. */
export interface StoredCanvasElement {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  locked: boolean;
  hidden: boolean;
  z: number;
  ref?: string;
  group?: string;
  props: Record<string, unknown>;
}

export interface StoredGuide {
  id: string;
  orientation: 'horizontal' | 'vertical';
  at: number;
}

export interface CanvasScene {
  width: number;
  height: number;
  elements: StoredCanvasElement[];
  /** The canvas editor's background as JSON, read by the place (`parseCanvasBackground`). */
  background: unknown;
  guides: StoredGuide[];
  guidesLocked: boolean;
}

export interface CanvasBlock {
  /** Unreadable data: shown as it is, never overwritten. */
  broken: boolean;
  scene: CanvasScene;
  parts: CanvasParts;
  /** The rendered picture, or `null`. */
  render: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readJson(raw: string | undefined): { broken: boolean; value: Record<string, unknown> } {
  if (raw === undefined) return { broken: false, value: {} };
  try {
    const value: unknown = JSON.parse(raw);
    return isRecord(value) ? { broken: false, value } : { broken: true, value: {} };
  } catch {
    return { broken: true, value: {} };
  }
}

const finite = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const size = (v: unknown, fallback: number) => Math.max(16, Math.min(8192, Math.round(finite(v, fallback))));
const ID_RE = /^[\w-]{1,64}$/;

/** An element from foreign JSON: a frame of numbers, a type and props; anything else is left out. */
function readElement(v: unknown): StoredCanvasElement | null {
  if (!isRecord(v) || typeof v.id !== 'string' || !ID_RE.test(v.id) || typeof v.type !== 'string' || !v.type) return null;
  return {
    id: v.id,
    type: v.type.slice(0, 64),
    x: finite(v.x, 0),
    y: finite(v.y, 0),
    width: Math.max(1, finite(v.width, 100)),
    height: Math.max(1, finite(v.height, 100)),
    rotation: finite(v.rotation, 0),
    opacity: Math.max(0, Math.min(1, finite(v.opacity, 1))),
    locked: v.locked === true,
    hidden: v.hidden === true,
    z: finite(v.z, 0),
    ...(typeof v.ref === 'string' ? { ref: v.ref.slice(0, 200) } : {}),
    ...(typeof v.group === 'string' && ID_RE.test(v.group) ? { group: v.group } : {}),
    props: isRecord(v.props) ? v.props : {},
  };
}

function readGuide(v: unknown): StoredGuide | null {
  if (!isRecord(v) || typeof v.id !== 'string' || !ID_RE.test(v.id)) return null;
  if (v.orientation !== 'horizontal' && v.orientation !== 'vertical') return null;
  return { id: v.id, orientation: v.orientation, at: finite(v.at, 0) };
}

function readParts(value: Record<string, unknown>, type: string): CanvasParts {
  const parts = { ...defaultCanvasParts(type) };
  for (const key of CANVAS_PART_KEYS) if (typeof value[key] === 'boolean') parts[key] = value[key] as boolean;
  return parts;
}

const RENDER = 'render';
// Bounded: it runs over foreign markup.
const IMG_RE = /<img\b[^<>]{0,2048}>/gi;

export function parseCanvasBlock(block: BlockInstance): CanvasBlock {
  const data = readJson(block.attrs[BLOCK_ATTR.data]);
  const config = readJson(block.attrs[BLOCK_ATTR.config]);
  const d = data.value;
  let render: string | null = null;
  for (const [tag] of block.html.matchAll(IMG_RE)) {
    if (!/\bdata-canvas="render"/i.test(tag)) continue;
    const src = /\bsrc="([^"]*)"/i.exec(tag)?.[1];
    if (src) render = decodeHtmlAttr(src);
    break;
  }
  return {
    broken: data.broken,
    parts: readParts(config.value, block.type),
    render,
    scene: {
      width: size(d.width, CANVAS_BLOCK_WIDTH),
      height: size(d.height, CANVAS_BLOCK_HEIGHT),
      elements: (Array.isArray(d.elements) ? d.elements : []).map(readElement).filter((e): e is StoredCanvasElement => !!e),
      background: d.background ?? null,
      guides: (Array.isArray(d.guides) ? d.guides : []).map(readGuide).filter((g): g is StoredGuide => !!g),
      guidesLocked: d.guidesLocked === true,
    },
  };
}

/** The stored file a picture element shows, or `null`. */
export function canvasElementFile(element: Pick<StoredCanvasElement, 'type' | 'ref' | 'props'>): string | null {
  if (element.type !== 'image') return null;
  return storedImageName(element.ref) ?? storedImageName(typeof element.props.src === 'string' ? element.props.src : null);
}

/** The stored file of the background picture, or `null` (none, or one of the app's own). */
export function canvasBackgroundFile(background: unknown): string | null {
  if (!isRecord(background) || !isRecord(background.image)) return null;
  return storedImageName(typeof background.image.src === 'string' ? background.image.src : null);
}

/** The block with a new scene and rendered picture (`null`: none yet). */
export function withCanvasScene(block: BlockInstance, scene: CanvasScene, render: string | null): BlockInstance {
  const tags: string[] = [];
  if (render) tags.push(`<img src="${escapeHtml(render)}" alt="" data-canvas="${RENDER}">`);
  const files = new Set(scene.elements.map(canvasElementFile).filter((f): f is string => !!f));
  for (const file of files) tags.push(`<img src="${escapeHtml(file)}" alt="" data-canvas="image">`);
  const background = canvasBackgroundFile(scene.background);
  if (background) tags.push(`<img src="${escapeHtml(background)}" alt="" data-canvas="background">`);
  return { ...block, html: tags.join(''), attrs: { ...block.attrs, [BLOCK_ATTR.data]: JSON.stringify(scene) } };
}

export function withCanvasParts(block: BlockInstance, parts: CanvasParts): BlockInstance {
  return { ...block, attrs: { ...block.attrs, [BLOCK_ATTR.config]: JSON.stringify(parts) } };
}

/**
 * The block without a picture: its elements leave the scene, and the
 * rendered picture goes with them until the canvas is next edited (it would
 * still show it). A broken block stays as it is.
 */
export function withoutCanvasFile(block: BlockInstance, file: string): BlockInstance {
  const parsed = parseCanvasBlock(block);
  if (parsed.broken) return block;
  const elements = parsed.scene.elements.filter((el) => canvasElementFile(el) !== file);
  const background = canvasBackgroundFile(parsed.scene.background) === file && isRecord(parsed.scene.background)
    ? { ...parsed.scene.background, image: null }
    : parsed.scene.background;
  if (elements.length === parsed.scene.elements.length && background === parsed.scene.background) return block;
  return withCanvasScene(block, { ...parsed.scene, elements, background }, null);
}

export function createCanvasBlock(type: typeof CANVAS_BLOCK_TYPE | typeof ALTAR_BLOCK_TYPE = CANVAS_BLOCK_TYPE): BlockInstance {
  const block: BlockInstance = { id: generateId(), type, html: '', attrs: {} };
  return withCanvasParts(withCanvasScene(block, {
    width: CANVAS_BLOCK_WIDTH, height: CANVAS_BLOCK_HEIGHT, elements: [], background: null, guides: [], guidesLocked: false,
  }, null), defaultCanvasParts(type));
}

/** The night an altar starts on: a radial gradient from a dark blue, as the altars of old had. */
const ALTAR_NIGHT = { fill: { kind: 'radial', colors: ['#1e1e3c', '#0f0f1e', '#0a0a0f'], cx: 0.5, cy: 0.25 }, image: null, tint: null };

/** What an operation of the "Altars" category starts with (the template `core-altar`): an altar on its night, and a text for notes. */
export function altarBlockSet(): BlockInstance[] {
  const altar = createCanvasBlock(ALTAR_BLOCK_TYPE);
  const { scene, render } = parseCanvasBlock(altar);
  return [withCanvasScene(altar, { ...scene, background: ALTAR_NIGHT }, render), createTextBlock()];
}
