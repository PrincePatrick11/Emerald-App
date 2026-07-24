import { invoke } from '@tauri-apps/api/core';
import { save, message } from '@tauri-apps/plugin-dialog';
import { useAltarStore } from '../store/altarStore';
import { exportCurrentAltarImage } from '../components/altar/AltarCanvas';
import { DEFAULT_ALTAR_RESOLUTION, resolveResolutionPixels } from './altarConstants';

// Long edge of the generated PDF page, in inches — same ballpark as a
// Letter/A4 sheet. The short edge is derived from the altar's own pixel
// aspect ratio, so a 9:16 altar gets a portrait page and a 16:9 altar gets
// a landscape one, instead of always letterboxing onto a portrait page.
const PDF_LONG_EDGE_IN = 11;

function pdfPageSizeForResolution(resolution: string): [number, number] {
  const { w, h } = resolveResolutionPixels(resolution ?? DEFAULT_ALTAR_RESOLUTION);
  const aspect = w / h;
  return aspect >= 1
    ? [PDF_LONG_EDGE_IN, PDF_LONG_EDGE_IN / aspect]
    : [PDF_LONG_EDGE_IN * aspect, PDF_LONG_EDGE_IN];
}

const FILTER_MAP: Record<'jpeg' | 'png' | 'webp', { name: string; extensions: string[] }> = {
  jpeg: { name: 'JPEG Image', extensions: ['jpg'] },
  png: { name: 'PNG Image', extensions: ['png'] },
  webp: { name: 'WebP Image', extensions: ['webp'] },
};

export async function noAltarOpenMessage(): Promise<void> {
  await message('Please open an Altar first.', { title: 'Export', kind: 'info' });
}

export async function saveAltarImage(format: 'jpeg' | 'png' | 'webp'): Promise<void> {
  const { altars, activeAltarId } = useAltarStore.getState();
  const activeAltar = altars.find((a) => a.id === activeAltarId) ?? null;
  if (!activeAltar) {
    await noAltarOpenMessage();
    return;
  }

  const dataUrl = await exportCurrentAltarImage(format);
  if (!dataUrl) throw new Error('capture failed');

  const safeName = activeAltar.title.replace(/[^\w\s\-äöüÄÖÜß]/g, '').trim().replace(/\s+/g, '_') || 'altar';
  const dateStr = new Date().toISOString().slice(0, 10);
  const ext = format === 'jpeg' ? 'jpg' : format;

  const filePath = await save({
    defaultPath: `${safeName}_${dateStr}.${ext}`,
    filters: [FILTER_MAP[format]],
  });
  if (!filePath) return;

  await invoke('export_image', { path: filePath, dataUrl });
}

export async function saveAltarPDF(): Promise<void> {
  const { altars, activeAltarId } = useAltarStore.getState();
  const activeAltar = altars.find((a) => a.id === activeAltarId) ?? null;
  if (!activeAltar) {
    await noAltarOpenMessage();
    return;
  }

  const dataUrl = await exportCurrentAltarImage('png');
  if (!dataUrl) throw new Error('capture failed');

  const safeName = activeAltar.title.replace(/[^\w\s\-äöüÄÖÜß]/g, '').trim().replace(/\s+/g, '_') || 'altar';
  const dateStr = new Date().toISOString().slice(0, 10);

  const filePath = await save({
    defaultPath: `${safeName}_${dateStr}.pdf`,
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (!filePath) return;

  const [widthIn, heightIn] = pdfPageSizeForResolution(activeAltar.resolution);

  const escapedTitle = activeAltar.title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const html = `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <title>${escapedTitle}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    @page { size: ${widthIn}in ${heightIn}in; margin: 0; }
    html, body { width: 100%; height: 100%; background: #fff; overflow: hidden; }
    body { position: relative; }
    /* Slightly overscan + crop (cover) rather than fit exactly (contain) —
       page size vs. rendered size can be off by a hair at some aspect
       ratios (rounding inside the native PDF pipeline), which otherwise
       shows up as a thin white sliver along one edge. */
    img {
      position: absolute;
      top: -1%; left: -1%;
      width: 102%; height: 102%;
      object-fit: cover;
      object-position: center;
    }
  </style>
</head>
<body>
  <img src="${dataUrl}" alt="${escapedTitle}">
</body>
</html>`;

  await invoke('export_pdf', { html, path: filePath, pageSize: [widthIn, heightIn] });
}
