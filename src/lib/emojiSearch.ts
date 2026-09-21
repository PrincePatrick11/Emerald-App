/** The built-in emoji set every picker offers until a vault chooses its own (Settings → Entries). */
export const DEFAULT_EMOJI_PICKER_EMOJIS = [
  '✨', '🌟', '⭐', '💫', '🌙', '☀️', '🌑', '🌕', '🌈', '🌀',
  '🔮', '☯️', '🔯', '🔱', '🪬', '🧿', '⚡', '👁️', '💀', '🎭',
  '🕯️', '🔥', '🪔', '🕎', '💡', '🔔', '📿', '🫧',
  '🌿', '🍃', '🌱', '🌾', '🪴', '🍀', '🌺', '🌸', '🦋', '🐉', '🦅', '🐍', '🐾',
  '⚗️', '🪄', '🗡️', '⚔️', '🛡️', '🔑', '📜', '🏺', '🪵', '🪑', '🧺', '🪟', '🛖', '🪜', '📦',
  '💎', '💜', '🪨',
  '📖', '📋', '📄', '📝', '✍️', '🗺️',
  '💼', '⏰', '🎯', '🧘', '💪', '🃏', '🧲', '🧹', '🧪', '🎵',
];

const MAX_SEARCH_RESULTS = 150;

// [emoji, searchable text] pairs generated from emojibase-data (compact.json per locale),
// covering the full standard Unicode emoji set (minus skin-tone variants and flag-building
// components) so search isn't limited to the curated set above.
// Loaded lazily per-locale so the ~100-140KB dataset is only fetched once it is needed.
const SEARCH_DATA_LOADERS: Record<string, () => Promise<{ default: string[][] }>> = {
  en: () => import('./emojiSearchData/en.json'),
  de: () => import('./emojiSearchData/de.json'),
  es: () => import('./emojiSearchData/es.json'),
  fr: () => import('./emojiSearchData/fr.json'),
};

// Module-level cache so re-opening a picker (or opening a second one) doesn't re-fetch.
const searchDataCache: Record<string, string[][]> = {};

/** The locale whose search data exists for an i18n language, falling back to English. */
export function emojiSearchLocale(language: string | undefined): string {
  const code = language?.slice(0, 2).toLowerCase();
  return code && SEARCH_DATA_LOADERS[code] ? code : 'en';
}

export function cachedEmojiSearchData(locale: string): string[][] | null {
  return searchDataCache[locale] ?? null;
}

export async function loadEmojiSearchData(locale: string): Promise<string[][]> {
  const cached = searchDataCache[locale];
  if (cached) return cached;
  const data = (await SEARCH_DATA_LOADERS[locale]()).default;
  searchDataCache[locale] = data;
  return data;
}

/** Emojis whose search text contains `query` (already trimmed and lower-cased). */
export function searchEmojis(data: string[][], query: string): string[] {
  return data
    .filter(([, text]) => text.includes(query))
    .slice(0, MAX_SEARCH_RESULTS)
    .map(([emoji]) => emoji);
}
