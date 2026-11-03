import { invoke } from '@tauri-apps/api/core';

// ── Embedded media files ────────────────────────────────────────────────────
//
// Entry content references images and sound files by absolute path into the
// app-data `images/` and `audio/` dirs. Exports and backups embed them as data
// URLs and restore them from there; these helpers pick the right command for
// either kind, so callers can treat both alike.

/**
 * Sound formats the editor accepts, with the MIME type each is saved as —
 * mirrors `AUDIO_EXTENSIONS` / `audio_ext_for_mime` in lib.rs.
 */
const AUDIO_MIME_BY_EXT = {
  mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', ogg: 'audio/ogg',
  oga: 'audio/ogg', opus: 'audio/opus', flac: 'audio/flac', webm: 'audio/webm',
} as const;

export const AUDIO_EXTENSIONS = Object.keys(AUDIO_MIME_BY_EXT) as (keyof typeof AUDIO_MIME_BY_EXT)[];

const AUDIO_PATH_RE = new RegExp(`\\.(${AUDIO_EXTENSIONS.join('|')})$`, 'i');
const IMAGE_PATH_RE = /\.(png|jpe?g|gif|webp|svg)$/i;

/** `accept` value for a file input that picks sound files. */
export const ACCEPTED_AUDIO = AUDIO_EXTENSIONS.map((e) => `.${e}`).join(',');

/** The accepted formats as a display list, e.g. for an error message. */
export const AUDIO_FORMATS_LABEL = ['MP3', 'M4A', 'AAC', 'WAV', 'OGG', 'Opus', 'FLAC', 'WebM'].join(', ');

export function isAudioPath(path: string): boolean {
  return AUDIO_PATH_RE.test(path);
}

export function isImagePath(path: string): boolean {
  return IMAGE_PATH_RE.test(path);
}

/** Decided by extension, like the backend: the MIME type a browser reports for a file is often empty or off. */
export function isAcceptedAudioFile(file: File): boolean {
  return isAudioPath(file.name);
}

/**
 * Rewrites a data URL read from a picked sound file so its MIME type follows
 * the file's extension — `save_audio` picks the stored extension from it, and
 * browsers report e.g. `video/webm` or nothing at all for some sound files.
 */
export function audioDataUrlFor(fileName: string, dataUrl: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() as keyof typeof AUDIO_MIME_BY_EXT | undefined;
  const mime = ext && AUDIO_MIME_BY_EXT[ext];
  const comma = dataUrl.indexOf(',');
  return mime && comma >= 0 ? `data:${mime};base64${dataUrl.slice(comma)}` : dataUrl;
}

/** Display name of an embedded sound file: its stored title, else the file name. */
export function audioTitle(src: string | null | undefined, title?: string | null): string {
  return title || src?.split(/[\\/]/).pop() || 'Audio';
}

/** A base64 data URL as a Blob, without fetch (the app CSP's connect-src has no data:). */
export function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(',');
  const mime = /^data:([^;,]+)/.exec(dataUrl)?.[1] ?? 'application/octet-stream';
  const binary = atob(dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/** Reads an embedded image or sound file as a data URL. Chosen by path extension — all a stored path has. */
export function readMediaAsBase64(path: string): Promise<string> {
  return invoke<string>(isAudioPath(path) ? 'read_audio_as_base64' : 'read_image_as_base64', { path });
}

/** Stores a data URL from an export or backup and returns its new local path. Chosen by MIME type — all a data URL has. */
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
