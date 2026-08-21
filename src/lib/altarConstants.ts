import type { AltarRecord } from '../types';

export const DEFAULT_ALTAR_BACKGROUND = 'midnight' as const;

export const DEFAULT_ALTAR_RESOLUTION = '1920x1080';
// BASE_RESOLUTION_WIDTH is the reference width at which BASE_SIZE (40px) in AltarCanvas gives correct proportions.
export const BASE_RESOLUTION_WIDTH = 1920;
export const MAX_ALTAR_RESOLUTION_W = 7680;
export const MAX_ALTAR_RESOLUTION_H = 4320;

export const ALTAR_RATIOS = ['16:9', '4:3', '3:2', '1:1', '2:3', '9:16'] as const;
export type AltarRatio = (typeof ALTAR_RATIOS)[number];

export const ALTAR_SIZE_KEYS = ['sm', 'md', 'lg', 'xl'] as const;
export type AltarSizeKey = (typeof ALTAR_SIZE_KEYS)[number];

export const ALTAR_RESOLUTION_MAP: Record<AltarSizeKey, Record<AltarRatio, string>> = {
  sm: { '16:9': '640x360',   '4:3': '640x480',   '3:2': '600x400',   '1:1': '640x640',   '2:3': '400x600',   '9:16': '360x640'  },
  md: { '16:9': '1280x720',  '4:3': '1024x768',  '3:2': '1200x800',  '1:1': '1024x1024', '2:3': '800x1200',  '9:16': '720x1280' },
  lg: { '16:9': '1920x1080', '4:3': '1600x1200', '3:2': '1800x1200', '1:1': '1600x1600', '2:3': '1200x1800', '9:16': '1080x1920'},
  xl: { '16:9': '3840x2160', '4:3': '3200x2400', '3:2': '3600x2400', '1:1': '3200x3200', '2:3': '2400x3600', '9:16': '2160x3840'},
};

export function sizeAndRatioFromResolution(res: string): { size: AltarSizeKey; ratio: AltarRatio } | null {
  for (const size of ALTAR_SIZE_KEYS) {
    for (const ratio of ALTAR_RATIOS) {
      if (ALTAR_RESOLUTION_MAP[size][ratio] === res) return { size, ratio };
    }
  }
  return null;
}

// Format: 'WxH' with lowercase 'x', e.g. '1920x1080'. Values are clamped to MAX_ALTAR_RESOLUTION_W/H.
export function parseResolution(res: string): { w: number; h: number } {
  if (!/^\d+x\d+$/.test(res)) return { w: 1920, h: 1080 };
  const parts = res.split('x');
  const w = Math.max(1, Math.min(MAX_ALTAR_RESOLUTION_W, Number(parts[0])));
  const h = Math.max(1, Math.min(MAX_ALTAR_RESOLUTION_H, Number(parts[1])));
  return { w, h };
}

// Returns true if the string is a ratio like '16:9' rather than a WxH resolution.
export function isRatioFormat(res: string): boolean {
  return /^\d+:\d+$/.test(res);
}

// Resolves any resolution string (WxH or ratio like '4:3') to pixel dimensions.
// Ratio formats are mapped to their lg canonical size (e.g. '4:3' → 1600×1200).
export function resolveResolutionPixels(res: string): { w: number; h: number } {
  if (isRatioFormat(res) && ALTAR_RATIOS.includes(res as AltarRatio)) {
    return parseResolution(ALTAR_RESOLUTION_MAP.lg[res as AltarRatio]);
  }
  return parseResolution(res);
}

// Returns the AltarRatio for any stored resolution format (ratio string or WxH).
export function ratioFromResolution(res: string): AltarRatio | null {
  if (isRatioFormat(res)) {
    return ALTAR_RATIOS.includes(res as AltarRatio) ? (res as AltarRatio) : null;
  }
  return sizeAndRatioFromResolution(res)?.ratio ?? null;
}

export const DEFAULT_BACKGROUND_OVERLAY = 0.2;

export const DEFAULT_GRID_SIZE = 32;
export const DEFAULT_GRID_OPACITY = 0.06;
export const DEFAULT_GRID_COLOR = '#dce8e2';

export const ALTAR_BACKGROUND_PRESETS = ['midnight', 'ember', 'forest', 'moon'] as const;

// Swatch colors for the gradient picker — muted dark ROYGBIV
export const GRADIENT_PRESET_COLORS = ['#4a1a1a', '#4a2a10', '#3d3510', '#1a3d26', '#1a2a4a', '#1e1a4a', '#3d1a4a'] as const;

// Maps legacy preset names to their representative hex color for the gradient picker
export const LEGACY_GRADIENT_COLORS: Record<(typeof ALTAR_BACKGROUND_PRESETS)[number], string> = {
  midnight: '#1e1e3c',
  ember: '#4a2917',
  forest: '#183126',
  moon: '#2b253d',
};

/** Returns true if the preset uses the new `gradient:#rrggbb` format. */
export function isGradientPreset(preset: string): boolean {
  return preset.startsWith('gradient:');
}

/** Extracts and validates the hex color from a `gradient:#rrggbb` preset string. Returns null if the color is not a valid 6-digit hex. */
export function getGradientColor(preset: string): string | null {
  const color = preset.slice('gradient:'.length);
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color : null;
}

/** Generates a radial-gradient CSS value from a hex color. */
export function generateGradientStyle(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const r2 = Math.round(r * 0.5).toString(16).padStart(2, '0');
  const g2 = Math.round(g * 0.5).toString(16).padStart(2, '0');
  const b2 = Math.round(b * 0.5).toString(16).padStart(2, '0');
  return `radial-gradient(circle at 50% 25%, ${hex} 0%, #${r2}${g2}${b2} 50%, #0a0a0f 100%)`;
}


export const ALTAR_IMAGE_PRESETS = [
  // Wald & Natur
  'sacred_grove_light',
  'bamboo_grove_bench',
  'light_forest_mist',
'world_tree_roots',
  // Berge
  'mountain_altar_summit',
  'mountain_altar_night',
  // Höhlen & Grotten
  'dark_grotto_shrine',
  'stalactite_cave_mosaic',
  // Magie & Portale
  'light_gate_magic',
  'magic_arch_violet',
  'magic_hall_portal',
  // Tempel & Hallen
  'marble_temple_arch',
  'temple_dark_arch',
  'temple_stairway',
  'stone_hall_sun',
  'chapel_red_carpet',
] as const;

export type AltarImagePresetName = (typeof ALTAR_IMAGE_PRESETS)[number];

export const ALTAR_BACKGROUND_STYLES: Record<(typeof ALTAR_BACKGROUND_PRESETS)[number], string> = {
  midnight: 'radial-gradient(ellipse at 50% 30%, #1a1a2e 0%, #0d0d15 60%, #0a0a0f 100%)',
  ember: 'radial-gradient(circle at 50% 24%, #4a2917 0%, #25140f 42%, #120d10 100%)',
  forest: 'radial-gradient(circle at 50% 22%, #183126 0%, #0d1a16 48%, #09110f 100%)',
  moon: 'radial-gradient(circle at 50% 18%, #2b253d 0%, #171222 44%, #0b0a12 100%)',
};

export const DEFAULT_OVERLAY_COLOR = 'dark';

function buildOverlayGradient(opacity: number, color: string = DEFAULT_OVERLAY_COLOR): string {
  const top = Math.round(opacity * 60) / 100;
  const bottom = opacity;
  const rgb = color === 'light' ? '255,255,255' : '10,10,15';
  return `linear-gradient(rgba(${rgb},${top}),rgba(${rgb},${bottom}))`;
}

/**
 * Returns a CSS `background` value for an altar canvas or card preview.
 * `backgroundSrc` must come from `imageSrc()`. That yields an empty string for
 * anything it does not recognise, and otherwise a stored image's
 * `emerald-img://` URL or an inline `data:` / `blob:` / `http` source passed
 * through unchanged — so only those four shapes reach the CSS `url()`.
 */
export function getAltarBackgroundStyle(
  altar: Pick<AltarRecord, 'background_preset' | 'background_overlay' | 'background_overlay_color'> | null,
  backgroundSrc: string | null | undefined,
): string {
  if (!altar) return ALTAR_BACKGROUND_STYLES[DEFAULT_ALTAR_BACKGROUND];
  const overlay = altar.background_overlay ?? DEFAULT_BACKGROUND_OVERLAY;
  const overlayLayer = overlay > 0 ? `${buildOverlayGradient(overlay, altar.background_overlay_color)}, ` : '';
  // A custom background resolves to an `emerald-img://` URL, a legacy one to a
  // data-URL. Either way, having a source at all is what makes it custom.
  if (backgroundSrc) {
    return `${overlayLayer}url("${backgroundSrc}") center / cover no-repeat`;
  }
  if (ALTAR_IMAGE_PRESETS.includes(altar.background_preset as AltarImagePresetName)) {
    return `${overlayLayer}url("/backgrounds/${altar.background_preset}.webp") center / cover no-repeat`;
  }
  if (isGradientPreset(altar.background_preset)) {
    const hex = getGradientColor(altar.background_preset);
    if (!hex) return ALTAR_BACKGROUND_STYLES[DEFAULT_ALTAR_BACKGROUND];
    return `${overlayLayer}${generateGradientStyle(hex)}`;
  }
  // Legacy preset names — keep using the original hardcoded styles
  const preset = ALTAR_BACKGROUND_PRESETS.includes(altar.background_preset as (typeof ALTAR_BACKGROUND_PRESETS)[number])
    ? altar.background_preset as (typeof ALTAR_BACKGROUND_PRESETS)[number]
    : DEFAULT_ALTAR_BACKGROUND;
  return `${overlayLayer}${ALTAR_BACKGROUND_STYLES[preset]}`;
}
