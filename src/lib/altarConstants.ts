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

// Returns the AltarRatio for any stored resolution format (ratio string or WxH).
export function ratioFromResolution(res: string): AltarRatio | null {
  if (isRatioFormat(res)) {
    return ALTAR_RATIOS.includes(res as AltarRatio) ? (res as AltarRatio) : null;
  }
  return sizeAndRatioFromResolution(res)?.ratio ?? null;
}

export const DEFAULT_GRID_SIZE = 32;
export const DEFAULT_GRID_OPACITY = 0.06;
export const DEFAULT_GRID_COLOR = '#dce8e2';

export const ALTAR_BACKGROUND_PRESETS = ['midnight', 'ember', 'forest', 'moon'] as const;

export const ALTAR_BACKGROUND_STYLES: Record<(typeof ALTAR_BACKGROUND_PRESETS)[number], string> = {
  midnight: 'radial-gradient(ellipse at 50% 30%, #1a1a2e 0%, #0d0d15 60%, #0a0a0f 100%)',
  ember: 'radial-gradient(circle at 50% 24%, #4a2917 0%, #25140f 42%, #120d10 100%)',
  forest: 'radial-gradient(circle at 50% 22%, #183126 0%, #0d1a16 48%, #09110f 100%)',
  moon: 'radial-gradient(circle at 50% 18%, #2b253d 0%, #171222 44%, #0b0a12 100%)',
};

const OVERLAY_GRADIENT = 'linear-gradient(rgba(10, 10, 15, 0.35), rgba(10, 10, 15, 0.55))';

/**
 * Returns a CSS `background` value for an altar canvas or card preview.
 * Only `data:image/` URIs are accepted as image sources — anything else falls
 * back to the altar's preset so that no arbitrary content is interpolated into
 * the CSS string.
 */
export function getAltarBackgroundStyle(
  altar: Pick<AltarRecord, 'background_preset'> | null,
  imageSrc: string | null | undefined,
): string {
  if (!altar) return ALTAR_BACKGROUND_STYLES[DEFAULT_ALTAR_BACKGROUND];
  if (imageSrc?.startsWith('data:image/')) {
    return `${OVERLAY_GRADIENT}, url("${imageSrc}") center / cover no-repeat`;
  }
  const preset = ALTAR_BACKGROUND_PRESETS.includes(altar.background_preset as (typeof ALTAR_BACKGROUND_PRESETS)[number])
    ? altar.background_preset as (typeof ALTAR_BACKGROUND_PRESETS)[number]
    : DEFAULT_ALTAR_BACKGROUND;
  return ALTAR_BACKGROUND_STYLES[preset];
}

// Emoji suggestions per category name (for the item edit emoji picker).
// Only covers the default category names; custom categories fall back to FALLBACK_CATEGORY_EMOJIS.
export const CATEGORY_EMOJIS: Record<string, string[]> = {
  candle: ['🕯️', '🔥', '🕎', '💡', '🪔'],
  crystal: ['🔮', '💎', '💜', '🌟', '⭐', '🪨'],
  herb: ['🌿', '🍃', '🌱', '🌾', '🪴', '🌺', '🍀'],
  deity: ['👁️', '☀️', '🌙', '🦅', '🐉', '🦋', '🌟', '⚡'],
  symbol: ['☯️', '🔱', '⚡', '🌀', '🔯', '🪬', '🌙', '🌈'],
  tool: ['⚗️', '🪄', '🗡️', '🏺', '📜', '🔑', '🪬', '🧿'],
  table: ['🪵', '🪑', '🧺', '🪟', '🛖', '🪜'],
  other: ['📿', '💫', '🌀', '🎭', '🌈', '🧿', '🫧', '✨'],
};

export const FALLBACK_CATEGORY_EMOJIS = ['✨', '🌟', '💫', '🔮', '🌙', '⚡', '🌀', '🎭'];

// Emoji palette for the altar category picker
export const ALTAR_CAT_EMOJIS = [
  '🕯️','🔮','🌿','✨','🌙','🔔','🪵','📦',
  '🔥','💎','🌺','👁️','☀️','🌕','⚡','🌀',
  '⚗️','🗡️','📜','🔑','🪄','🧿','🌊','💀',
  '🐍','🦅','🌈','⭐','🪬','☯️','🔱','🌑',
  '📖','🌸','🦋','🐉','🏺','💫','🎭','🐾',
];
