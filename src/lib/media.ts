import { invoke } from '@tauri-apps/api/core';

// ── Embedded media files ────────────────────────────────────────────────────
//
// Entry content references images and sound files by absolute path into the
// app-data `images/` and `audio/` dirs. Exports and backups embed them as data
// URLs and restore them from there; these helpers pick the right command for
// either kind, so callers can treat both alike.

/** Sound formats the editor accepts — mirrors `AUDIO_EXTENSIONS` in lib.rs. */
export const AUDIO_EXTENSIONS = ['mp3', 'm4a', 'aac', 'wav', 'ogg', 'oga', 'opus', 'flac', 'webm'] as const;

const AUDIO_PATH_RE = new RegExp(`\\.(${AUDIO_EXTENSIONS.join('|')})$`, 'i');

/** `accept` value for a file input that picks sound files. */
export const ACCEPTED_AUDIO = ['audio/*', ...AUDIO_EXTENSIONS.map((e) => `.${e}`)].join(',');

export function isAudioPath(path: string): boolean {
  return AUDIO_PATH_RE.test(path);
}

export function isAcceptedAudioFile(file: File): boolean {
  return isAudioPath(file.name) || (file.type.startsWith('audio/') && file.type !== 'audio/midi');
}

/** Reads an embedded image or sound file as a data URL. */
export function readMediaAsBase64(path: string): Promise<string> {
  return invoke<string>(isAudioPath(path) ? 'read_audio_as_base64' : 'read_image_as_base64', { path });
}

/** Stores a data URL from an export or backup and returns its new local path. */
export function saveMediaDataUrl(dataUrl: string): Promise<string> {
  return invoke<string>(dataUrl.startsWith('data:audio/') ? 'save_audio' : 'save_image', { dataUrl });
}

/** "mm:ss", or "h:mm:ss" from an hour on. */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  const m = Math.floor(seconds / 60) % 60;
  const h = Math.floor(seconds / 3600);
  return h ? `${h}:${m.toString().padStart(2, '0')}:${s}` : `${m}:${s}`;
}
