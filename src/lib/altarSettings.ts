import type { AltarRecord } from '../types';
import {
  DEFAULT_ALTAR_BACKGROUND, DEFAULT_ALTAR_RESOLUTION, DEFAULT_BACKGROUND_OVERLAY, DEFAULT_GRID_COLOR,
  DEFAULT_GRID_OPACITY, DEFAULT_GRID_SIZE, DEFAULT_OVERLAY_COLOR, isRatioFormat,
} from './altarConstants';
import { isValidHexColor } from './helpers';

/**
 * Wie ein Altar aussieht — Hintergrund, Raster, Einrasten, Auflösung. Seit v51
 * eine JSON-Spalte `altars.settings` statt zwölf eigener Spalten: gelesen und
 * geschrieben werden sie nur zusammen, und keine Abfrage filtert danach.
 * `AltarRecord` bleibt flach — `fromRow.altar` packt aus, `altarSettingsJson`
 * packt ein. Die Bildspalten (`background_image_data` …) bleiben Spalten,
 * weil das Bild-Aufräumen und `IMAGE_FIELDS` in Spalten suchen.
 */
export const ALTAR_SETTING_KEYS = [
  'background_preset', 'background_overlay', 'background_overlay_color',
  'grid_enabled', 'grid_size', 'grid_opacity', 'grid_color',
  'snap_to_grid', 'rotation_snap_enabled', 'rotation_snap_angle', 'snap_scale_to_grid',
  'resolution',
] as const;

export type AltarSettings = Pick<AltarRecord, (typeof ALTAR_SETTING_KEYS)[number]>;

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
 * Die Einstellungen aus einem JSON-Text oder einem Objekt — dem Inhalt von
 * `settings` oder, für v51 und Sicherungen bis Format 11, einer Altarzeile mit
 * den alten Einzelspalten (Schalter dort als 0/1). Fehlendes und Unbrauchbares
 * fällt auf den Standard; die Datei kann fremd sein.
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
  };
}

/**
 * Der Inhalt von `altars.settings` — geprüft wie beim Lesen, immer alle
 * Schlüssel in fester Reihenfolge. Nimmt einen Altar, eine Zeile mit den alten
 * Einzelspalten oder einen JSON-Text.
 */
export function altarSettingsJson(source: unknown): string {
  return JSON.stringify(parseAltarSettings(source));
}
