/**
 * Ein Bild als Data-URL auf höchstens `maxEdge` Pixel Kantenlänge zeichnen.
 * Passt es schon, kommt es unverändert zurück.
 *
 * `mime` bestimmt das Ausgabeformat: ohne Angabe das des Bildes (ein
 * JPEG-Foto als PNG würde größer statt kleiner), `quality` gilt nur für die
 * verlustbehafteten Formate. Die eine Zeichenfläche für beide Aufrufer —
 * `shrinkImageDataUrl` für Icons und `prepareImageDataUrl` für die Grenzen
 * eines Vaults (`lib/imageLimits.ts`).
 */
export async function scaleToMaxEdge(
  dataUrl: string,
  maxEdge: number,
  options: { mime?: string; quality?: number } = {},
): Promise<string> {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const longest = Math.max(img.naturalWidth, img.naturalHeight);
  if (longest <= maxEdge) return dataUrl;
  return drawScaled(img, maxEdge / longest, options);
}

function drawScaled(img: HTMLImageElement, scale: number, options: { mime?: string; quality?: number }): string {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No 2D canvas context');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL(options.mime, options.quality);
}

/**
 * Ein Icon verkleinern (PNG, damit Transparenz bleibt). Ist es in Maß und
 * Größe schon klein genug, kommt es unverändert zurück — ein kurzes animiertes
 * GIF bleibt dann animiert.
 *
 * Für Icons, die viele Male mitreisen: das Icon eines eigenen Blocks steckt in
 * jeder Kopie in jedem Eintrag, ein Foto in voller Größe blähte jeden davon auf.
 */
export async function shrinkImageDataUrl(dataUrl: string, maxEdge: number): Promise<string> {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const longest = Math.max(img.naturalWidth, img.naturalHeight);
  // Klein, aber schwer (eingebettete Metadaten, lange GIF-Animation): auch
  // das wird neu kodiert. Die Grenze liegt über einem 64px-PNG.
  if (longest <= maxEdge && dataUrl.length <= maxEdge * maxEdge * 8) return dataUrl;
  return drawScaled(img, Math.min(1, maxEdge / longest), { mime: 'image/png' });
}
