import { useRef } from 'react';
import { isImageDataUrl, saveIcon } from '../lib/icons';

/**
 * Puts an icon from the icon field (`Favicon`, `MediaPropertyRow`) into a
 * draft or record: a picture (a data URL, cut to a square in `IconCropDialog`) is brought down
 * to 128px and stored as a file in the vault's `icons/` (`saveIcon`), and the
 * record gets its name; an emoji is taken as is. The last choice wins — an
 * emoji chosen while a picture is still being stored must not be overwritten
 * by the late picture. That is why every change of the icon runs through
 * here, including resetting to the default and removing it (`''`, which
 * `apply` turns into "no icon").
 *
 * The returned promise settles once `apply` — and the write it returns — is
 * done, so a caller can make Cancel wait for it.
 */
export function useShrunkIcon(
  apply: (icon: string) => void | Promise<unknown>,
  logTag: string,
): (value: string) => Promise<void> {
  const request = useRef(0);
  return async (value) => {
    const current = ++request.current;
    try {
      const icon = isImageDataUrl(value) ? await saveIcon(value) : value;
      if (current === request.current) await apply(icon);
    } catch (err) {
      console.error(`[${logTag}] setting the icon failed:`, err);
    }
  };
}
