import { useRef } from 'react';
import { isImageIcon } from '../lib/helpers';
import { shrinkImageDataUrl } from '../lib/shrinkImage';

/**
 * Edge length of an image icon. Icons of custom blocks, templates, languages
 * and entries appear at most 24px large — and a block's icon sits in every
 * copy in every entry. 64px is enough even for high-resolution screens.
 */
const ICON_MAX_EDGE = 64;

/**
 * Puts an icon from the icon field (`Favicon`, `MediaPropertyRow`) into a
 * draft or record: an image is shrunk first, an emoji is taken as is. The
 * last choice wins — an emoji chosen while an image is still being shrunk
 * must not be overwritten by the late image. That is why every change of the
 * icon runs through here, including resetting to the default and removing
 * it (`''`, which `apply` turns into "no icon").
 *
 * The returned promise settles once `apply` — and the write it returns — is
 * done, so a caller can make Cancel wait for it.
 *
 * `maxEdge` for an icon shown larger than a row's.
 */
export function useShrunkIcon(
  apply: (icon: string) => void | Promise<unknown>,
  logTag: string,
  maxEdge: number = ICON_MAX_EDGE,
): (value: string) => Promise<void> {
  const request = useRef(0);
  return async (value) => {
    const current = ++request.current;
    try {
      const icon = isImageIcon(value) ? await shrinkImageDataUrl(value, maxEdge) : value;
      if (current === request.current) await apply(icon);
    } catch (err) {
      console.error(`[${logTag}] setting the icon failed:`, err);
    }
  };
}
