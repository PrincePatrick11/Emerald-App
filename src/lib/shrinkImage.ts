/**
 * Ein Bild als Data-URL auf höchstens `maxEdge` Pixel Kantenlänge verkleinern
 * (PNG, damit Transparenz bleibt). Ist es in Maß und Größe schon klein
 * genug, kommt es unverändert zurück — ein kurzes animiertes GIF bleibt dann
 * animiert.
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

  const scale = Math.min(1, maxEdge / longest);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No 2D canvas context');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
}
