import type { AltarItemCategory } from '../types';

export const DEFAULT_ALTAR_BACKGROUND = 'midnight' as const;

export const ALTAR_BACKGROUND_PRESETS = ['midnight', 'ember', 'forest', 'moon'] as const;

export const ALTAR_BACKGROUND_STYLES: Record<(typeof ALTAR_BACKGROUND_PRESETS)[number], string> = {
  midnight: 'radial-gradient(ellipse at 50% 30%, #1a1a2e 0%, #0d0d15 60%, #0a0a0f 100%)',
  ember: 'radial-gradient(circle at 50% 24%, #4a2917 0%, #25140f 42%, #120d10 100%)',
  forest: 'radial-gradient(circle at 50% 22%, #183126 0%, #0d1a16 48%, #09110f 100%)',
  moon: 'radial-gradient(circle at 50% 18%, #2b253d 0%, #171222 44%, #0b0a12 100%)',
};

export const ALTAR_CATEGORY_EMOJI: Record<AltarItemCategory, string> = {
  candle: '🕯️', crystal: '🔮', herb: '🌿', deity: '✨',
  symbol: '🌙', tool: '⚗️', table: '🪵', other: '📿',
};

export const ALTAR_CATEGORIES: AltarItemCategory[] = ['candle', 'crystal', 'herb', 'deity', 'symbol', 'tool', 'table', 'other'];

export const CATEGORY_EMOJIS: Record<AltarItemCategory, string[]> = {
  candle: ['🕯️', '🔥', '🕎', '💡', '🪔'],
  crystal: ['🔮', '💎', '💜', '🌟', '⭐', '🪨'],
  herb: ['🌿', '🍃', '🌱', '🌾', '🪴', '🌺', '🍀'],
  deity: ['👁️', '☀️', '🌙', '🦅', '🐉', '🦋', '🌟', '⚡'],
  symbol: ['☯️', '🔱', '⚡', '🌀', '🔯', '🪬', '☽', '🌈'],
  tool: ['⚗️', '🪄', '🗡️', '🏺', '📜', '🔑', '🪬', '🧿'],
  table: ['🪵', '🪑', '🧺', '🪟', '🛖', '🪜'],
  other: ['📿', '💫', '🌀', '🎭', '🌈', '🧿', '🫧', '✨'],
};
