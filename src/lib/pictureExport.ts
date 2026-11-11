import { invoke } from '@tauri-apps/api/core';
import { message, save } from '@tauri-apps/plugin-dialog';
import type { CanvasExportFormat } from '../components/editors/canvas';
import { exportFilename } from './export';

const FILTERS: Record<CanvasExportFormat, { name: string; extensions: string[] }> = {
  png: { name: 'PNG Image', extensions: ['png'] },
  jpeg: { name: 'JPEG Image', extensions: ['jpg'] },
  svg: { name: 'SVG Image', extensions: ['svg'] },
};

/** Text as a base64 data URL — what `export_image` decodes. */
export function textDataUrl(text: string, mime: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${mime};base64,${btoa(binary)}`;
}

/**
 * A picture saved where the user chooses (the canvas editor's export
 * dialog): the save dialog under the exports' default name, then `export_image`,
 * which writes only inside the allowed folders. False when cancelled.
 */
export async function savePictureAs(dataUrl: string, kind: CanvasExportFormat, name: string): Promise<boolean> {
  const filter = FILTERS[kind];
  const path = await save({ defaultPath: exportFilename(name, new Date().toISOString(), filter.extensions[0]), filters: [filter] });
  if (!path) return false;
  await invoke('export_image', { path, dataUrl });
  await message(`Image saved:\n${path}`, { title: 'Export', kind: 'info' });
  return true;
}
