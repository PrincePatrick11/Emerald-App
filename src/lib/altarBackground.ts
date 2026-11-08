import type { CanvasBackground } from '../components/editors/canvas/background';
import type { AltarRecord } from '../types';
import {
  ALTAR_IMAGE_PRESETS, DEFAULT_BACKGROUND_OVERLAY, DEFAULT_OVERLAY_COLOR, getGradientColor, isGradientPreset,
  LEGACY_GRADIENT_COLORS, type AltarImagePresetName,
} from './altarConstants';
import { imageSrc } from './images';

/** The darkest colour of the older presets, where their gradients end. */
const NIGHT = '#0a0a0f';

function half(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.round(v * 0.5).toString(16).padStart(2, '0');
  return `#${c((n >> 16) & 255)}${c((n >> 8) & 255)}${c(n & 255)}`;
}

/**
 * The altar's background as the canvas editor shows and changes it: the one
 * set there, or else, close to it, what the older preset, picture and
 * overlay showed.
 */
export function altarCanvasBackground(
  altar: Pick<AltarRecord, 'canvas_background' | 'background_preset' | 'background_image_data' | 'background_overlay' | 'background_overlay_color'>,
): CanvasBackground {
  if (altar.canvas_background) return altar.canvas_background;
  const preset = altar.background_preset;
  const legacy = LEGACY_GRADIENT_COLORS[preset as keyof typeof LEGACY_GRADIENT_COLORS];
  const hex = isGradientPreset(preset) ? getGradientColor(preset) : legacy ?? LEGACY_GRADIENT_COLORS.midnight;
  const base = hex ?? LEGACY_GRADIENT_COLORS.midnight;
  const image = altar.background_image_data
    ? { src: altar.background_image_data, fit: 'cover' as const }
    : ALTAR_IMAGE_PRESETS.includes(preset as AltarImagePresetName)
      ? { src: `/backgrounds/${preset}.webp`, fit: 'cover' as const }
      : null;
  const overlay = altar.background_overlay ?? DEFAULT_BACKGROUND_OVERLAY;
  const light = (altar.background_overlay_color ?? DEFAULT_OVERLAY_COLOR) === 'light';
  return {
    fill: { kind: 'radial', colors: [base, half(base), NIGHT], cx: 0.5, cy: 0.25 },
    image,
    // The overlay ran from 60 % of its strength at the top to all of it at the bottom.
    tint: overlay > 0 ? { color: light ? '#ffffff' : NIGHT, opacity: Math.round(overlay * 80) / 100 } : null,
  };
}

/** Whether a background picture is one of the app's own (`public/backgrounds`), not an image of the vault. */
export function isAppBackground(src: string): boolean {
  return /^\/backgrounds\/[a-z0-9_]+\.webp$/.test(src);
}

/**
 * A background picture's reference as a URL to show: one of the app's own as
 * it is, anything else through `imageSrc()`, which passes only a stored image
 * or an inline source and gives `''` for the rest, so a foreign file cannot
 * make the stage load from elsewhere.
 */
export function altarBackgroundUrl(src: string): string {
  return isAppBackground(src) ? src : imageSrc(src);
}
