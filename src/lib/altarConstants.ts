export const DEFAULT_ALTAR_BACKGROUND = 'midnight' as const;

/** Fixed cap for custom backgrounds, in addition to the vault's image limits — on upload as on import. */
export const ALTAR_BACKGROUND_MAX_BYTES = 5 * 1024 * 1024;

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

/** Glyph of the "Uncategorized" header in the altar library. */
export const ALTAR_UNCATEGORIZED_EMOJI = '📦';

export const DEFAULT_GRID_SIZE = 32;
export const DEFAULT_GRID_OPACITY = 0.06;
export const DEFAULT_GRID_COLOR = '#dce8e2';

export const ALTAR_BACKGROUND_PRESETS = ['midnight', 'ember', 'forest', 'moon'] as const;

// The older preset names by the colour their gradient started from (`altarCanvasBackground`)
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

export const ALTAR_IMAGE_PRESETS = [
  // Forest & nature
  'sacred_grove_light',
  'bamboo_grove_bench',
  'light_forest_mist',
'world_tree_roots',
  // Mountains
  'mountain_altar_summit',
  'mountain_altar_night',
  // Caves & grottoes
  'dark_grotto_shrine',
  'stalactite_cave_mosaic',
  // Magic & portals
  'light_gate_magic',
  'magic_arch_violet',
  'magic_hall_portal',
  // Temples & halls
  'marble_temple_arch',
  'temple_dark_arch',
  'temple_stairway',
  'stone_hall_sun',
  'chapel_red_carpet',
] as const;

export type AltarImagePresetName = (typeof ALTAR_IMAGE_PRESETS)[number];

export const DEFAULT_OVERLAY_COLOR = 'dark';

/**
 * Whether an item should flicker like a candle. Until v38 this hung on the
 * built-in altar category `candle`; since then that is an ordinary category
 * that can be renamed and deleted, so the item's emoji decides. The variation
 * selector U+FE0F is optional — both spellings occur.
 */
export function isCandleEmoji(emoji: string | null | undefined): boolean {
  return (emoji ?? '').replace(/️/g, '') === '\u{1F56F}';
}
