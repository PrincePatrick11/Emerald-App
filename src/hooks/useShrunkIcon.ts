import { useRef } from 'react';
import { isImageIcon } from '../lib/helpers';
import { shrinkImageDataUrl } from '../lib/shrinkImage';

/**
 * Edge length of an image icon. Icons of custom blocks and templates appear
 * at most 20px large — and a block's icon sits in every copy in every
 * entry. 64px is enough even for high-resolution screens.
 */
const ICON_MAX_EDGE = 64;

/**
 * Puts an icon from the icon field (`Favicon`) into a draft: an image is
 * shrunk first, an emoji is taken as is. The last choice wins —
 * an emoji chosen while an image is still being shrunk must not be
 * overwritten by the late image. That is why every change of the icon runs
 * through here, including resetting to the default.
 */
export function useShrunkIcon(apply: (icon: string) => void, logTag: string): (value: string) => Promise<void> {
  const request = useRef(0);
  return async (value) => {
    const current = ++request.current;
    try {
      const icon = isImageIcon(value) ? await shrinkImageDataUrl(value, ICON_MAX_EDGE) : value;
      if (current === request.current) apply(icon);
    } catch (err) {
      console.error(`[${logTag}] reading the icon failed:`, err);
    }
  };
}
