import { invoke } from '@tauri-apps/api/core';
import { save, message } from '@tauri-apps/plugin-dialog';
import { useAltarStore } from '../store/altarStore';
import { exportCurrentAltarImage } from '../components/altar/AltarCanvas';

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
