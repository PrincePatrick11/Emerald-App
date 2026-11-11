import type { AltarGuide, AltarRecord } from '../types';
import {
  DEFAULT_ALTAR_BACKGROUND, DEFAULT_ALTAR_RESOLUTION, DEFAULT_BACKGROUND_OVERLAY, DEFAULT_GRID_COLOR,
  DEFAULT_GRID_OPACITY, DEFAULT_GRID_SIZE, DEFAULT_OVERLAY_COLOR, isRatioFormat,
} from './altarConstants';
import { isValidHexColor } from './helpers';
import { parseCanvasBackground } from '../components/editors/canvas/background';

/**
 * How an altar looks — background, grid, snapping, resolution. Since v51
 * a JSON column `altars.settings` instead of twelve separate columns: they are
 * only read and written together, and no query filters on them.
 * `AltarRecord` stays flat — `fromRow.altar` unpacks, `altarSettingsJson`
 * packs. The image columns (`background_image_data` …) stay columns,
 * because the image cleanup and `IMAGE_FIELDS` look for columns.
 */
export const ALTAR_SETTING_KEYS = [
  'background_preset', 'background_overlay', 'background_overlay_color',
  'grid_enabled', 'grid_size', 'grid_opacity', 'grid_color',
  'snap_to_grid', 'rotation_snap_enabled', 'rotation_snap_angle', 'snap_scale_to_grid',
  'resolution',
] as const;

/** The settings that were never columns, only ever part of `settings`. */
export type AltarSettings = Pick<AltarRecord, (typeof ALTAR_SETTING_KEYS)[number] | 'guides' | 'guides_locked' | 'canvas_background'>;

/** At most this many guides; more would be a foreign file. */
const MAX_GUIDES = 200;

function guideList(v: unknown): AltarGuide[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const out: AltarGuide[] = [];
  for (const g of v.slice(0, MAX_GUIDES)) {
    if (!g || typeof g !== 'object') continue;
    const e = g as Record<string, unknown>;
    const at = finite(e.at, NaN);
    if (typeof e.id !== 'string' || !e.id || seen.has(e.id) || (e.orientation !== 'vertical' && e.orientation !== 'horizontal') || !Number.isFinite(at)) continue;
    seen.add(e.id);
    out.push({ id: e.id, orientation: e.orientation, at: Math.max(0, Math.min(100, Math.round(at * 1000) / 1000)) });
  }
  return out;
}

const flag = (v: unknown): boolean => (typeof v === 'boolean' ? v : v != null && Number(v) !== 0);

function finite(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

const text = (v: unknown): string => (typeof v === 'string' ? v : '');

function isResolution(v: string): boolean {
  return /^\d+x\d+$/.test(v) || isRatioFormat(v);
}

/**
 * The settings from a JSON text or an object — the content of `settings` or,
 * for v51 and backups up to format 11, an altar row with the old individual
 * columns (switches there as 0/1). Anything missing or unusable falls back to
 * the default; the file may be foreign.
 */
export function parseAltarSettings(raw: unknown): AltarSettings {
  let source: unknown = raw;
  if (typeof raw === 'string') {
    try {
      source = JSON.parse(raw);
    } catch {
      source = {};
    }
  }
  const s = (typeof source === 'object' && source !== null ? source : {}) as Record<string, unknown>;
  const gridColor = text(s.grid_color);
  const resolution = text(s.resolution);
  return {
    background_preset: text(s.background_preset) || DEFAULT_ALTAR_BACKGROUND,
    background_overlay: finite(s.background_overlay, DEFAULT_BACKGROUND_OVERLAY),
    background_overlay_color: text(s.background_overlay_color) || DEFAULT_OVERLAY_COLOR,
    grid_enabled: flag(s.grid_enabled),
    grid_size: finite(s.grid_size, DEFAULT_GRID_SIZE),
    grid_opacity: finite(s.grid_opacity, DEFAULT_GRID_OPACITY),
    grid_color: isValidHexColor(gridColor) ? gridColor : DEFAULT_GRID_COLOR,
    snap_to_grid: flag(s.snap_to_grid),
    rotation_snap_enabled: flag(s.rotation_snap_enabled),
    rotation_snap_angle: finite(s.rotation_snap_angle, 15),
    snap_scale_to_grid: flag(s.snap_scale_to_grid),
    resolution: isResolution(resolution) ? resolution : DEFAULT_ALTAR_RESOLUTION,
    guides: guideList(s.guides),
    guides_locked: flag(s.guides_locked),
    canvas_background: parseCanvasBackground(s.canvas_background),
  };
}

/**
 * The content of `altars.settings` — validated as on reading, always all
 * keys in a fixed order. Takes an altar, a row with the old individual
 * columns, or a JSON text.
 */
export function altarSettingsJson(source: unknown): string {
  return JSON.stringify(parseAltarSettings(source));
}
