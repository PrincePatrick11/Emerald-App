/**
 * Gemeinsame Thumbnail-Erzeugung fuer Altar-Karten und Sigil-Listen.
 *
 * Beide rendern auf THUMBNAIL_W Breite und pressen das Ergebnis unter
 * THUMBNAIL_MAX_BYTES: erst WebP ueber eine Qualitaetsleiter, dann das
 * verlustfreie bzw. verlustbehaftete Fallback-Format des Aufrufers.
 * Altaere nehmen JPEG (deckende Szene), Sigille PNG — ihre Zeichnungen
 * liegen auf transparentem Grund, den JPEG schwarz fuellen wuerde.
 *
 * Die 512-KB-Grenze war frueher ein vierfach kopiertes Literal (drei
 * Capture-Stellen in AltarView plus die Downscale-Schleife hier) — sie
 * lebt jetzt ausschliesslich in dieser Datei.
 */
export const THUMBNAIL_W = 640;
export const THUMBNAIL_MAX_BYTES = 524288;

function toDataUrl(
  canvas: HTMLCanvasElement,
  format: string,
  quality: number
): Promise<string | null> {
  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          resolve(null);
          return;
        }
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(blob);
      },
      format,
      quality
    );
  });
}

export async function canvasToCappedThumbnail(
  canvas: HTMLCanvasElement,
  fallback: 'jpeg' | 'png'
): Promise<string | null> {
  // Ein Aufruf sondiert die WebP-Unterstuetzung: liefert die Runtime kein
  // echtes WebP, ist sie still auf PNG ausgewichen (verlustfrei, Quality
  // wirkungslos) — dann direkt zum Fallback-Format mit verlaesslicher
  // Groessensteuerung.
  const probe = await toDataUrl(canvas, 'image/webp', 0.85);
  if (probe !== null) {
    if (probe.startsWith('data:image/webp')) {
      if (probe.length <= THUMBNAIL_MAX_BYTES) return probe;
      for (const q of [0.65, 0.45]) {
        const r = await toDataUrl(canvas, 'image/webp', q);
        if (r !== null && r.length <= THUMBNAIL_MAX_BYTES) return r;
      }
    } else if (probe.length <= THUMBNAIL_MAX_BYTES) {
      return probe;
    }
  }

  if (fallback === 'jpeg') {
    for (const q of [0.85, 0.65, 0.45]) {
      const r = await toDataUrl(canvas, 'image/jpeg', q);
      if (r !== null && r.length <= THUMBNAIL_MAX_BYTES) return r;
    }
    return null;
  }

  // PNG kennt keine Quality-Leiter; ein 640px-Strichbild bleibt ohnehin weit
  // unter der Grenze. Faellt es doch darueber, gibt es keinen Thumbnail.
  const png = await toDataUrl(canvas, 'image/png', 1);
  return png !== null && png.length <= THUMBNAIL_MAX_BYTES ? png : null;
}
