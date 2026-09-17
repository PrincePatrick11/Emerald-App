import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cachedEmojiSearchData, emojiSearchLocale, loadEmojiSearchData } from '../lib/emojiSearch';

/** The emoji search data for the current language — `null` until loaded, and
 *  not fetched at all while `enabled` is false (a closed picker). */
export function useEmojiSearchData(enabled: boolean): string[][] | null {
  const { i18n } = useTranslation();
  const locale = emojiSearchLocale(i18n.language);
  const [data, setData] = useState<string[][] | null>(() => cachedEmojiSearchData(locale));

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    loadEmojiSearchData(locale).then((loaded) => {
      if (!cancelled) setData(loaded);
    });
    return () => { cancelled = true; };
  }, [enabled, locale]);

  return data;
}
