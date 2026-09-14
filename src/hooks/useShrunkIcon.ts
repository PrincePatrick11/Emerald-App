import { useRef } from 'react';
import { isImageIcon } from '../lib/helpers';
import { shrinkImageDataUrl } from '../lib/shrinkImage';

/**
 * Kantenlänge eines Bild-Icons. Icons eigener Blöcke und Vorlagen erscheinen
 * höchstens 20px groß — und das eines Blocks steckt in jeder Kopie in jedem
 * Eintrag. 64px reichen auch für hochauflösende Schirme.
 */
const ICON_MAX_EDGE = 64;

/**
 * Setzt ein Icon aus dem Icon-Feld (`Favicon`) in einen Entwurf: ein Bild wird
 * vorher verkleinert, ein Emoji direkt übernommen. Die letzte Wahl gewinnt —
 * ein Emoji, gewählt während ein Bild noch verkleinert wird, darf nicht vom
 * späten Bild überschrieben werden. Deshalb läuft jede Änderung des Icons
 * hierdurch, auch das Zurücksetzen auf den Standard.
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
