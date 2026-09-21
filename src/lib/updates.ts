import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

/**
 * Die Frontend-Seite des In-App-Updaters.
 *
 * Geprüft und installiert wird ausschließlich in Rust (`src-tauri/src/updates.rs`) —
 * hier stehen nur die vier Aufrufe und das Fortschritts-Ereignis. Der Grund
 * steht drüben: die Signaturprüfung und der Netzverkehr gehören nicht in die
 * WebView, und die Endpoints lassen sich nur dort zur Laufzeit überschreiben.
 */

export interface UpdateSettings {
  version: number;
  /** Leer heißt: die einkompilierten Quellen der App. */
  endpoint: string;
  auto_check: boolean;
}

export interface UpdateCheck {
  available: boolean;
  /** Die gefundene Version; leer, wenn nichts anliegt. */
  version: string;
  current_version: string;
  notes: string | null;
  date: string | null;
  /** Falsch auf einer `.deb`-Installation — dort ersetzt der Updater nichts. */
  installable: boolean;
}

/**
 * Der Fehler, den die Rust-Seite liefert: ein Code zum Übersetzen und der
 * Originaltext fürs Log. Der Originaltext ist englisch und für Entwickler
 * geschrieben — er gehört in die Konsole, nicht ins Fenster.
 *
 * Codes: `unreachable` (niemand hat geantwortet), `unsupported-target` (diese
 * Plattform steht nicht im Manifest), `invalid-url`, `write-failed`,
 * `unsupported-install`, `nothing-to-install`, `failed`.
 */
export interface UpdateError {
  code: string;
  detail: string;
}

/** Was aus einem `catch` kommt, ist `unknown` — hier wird es zu einem Fehler
 *  mit Code, auch wenn etwas ganz anderes geflogen ist. */
export function asUpdateError(e: unknown): UpdateError {
  if (e && typeof e === 'object' && 'code' in e && typeof (e as UpdateError).code === 'string') {
    return e as UpdateError;
  }
  return { code: 'failed', detail: String(e) };
}

export interface UpdateProgress {
  downloaded: number;
  /** Fehlt, wenn die Quelle keine Größe mitschickt. */
  total: number | null;
}

export function updateSettings(): Promise<UpdateSettings> {
  return invoke<UpdateSettings>('update_settings');
}

export function setUpdateSettings(endpoint: string, autoCheck: boolean): Promise<UpdateSettings> {
  return invoke<UpdateSettings>('set_update_settings', { endpoint, autoCheck });
}

export function checkForUpdate(): Promise<UpdateCheck> {
  return invoke<UpdateCheck>('check_for_update');
}

/** Läuft es durch, startet die App neu — dieses Promise löst dann nie auf. */
export function installUpdate(): Promise<void> {
  return invoke<void>('install_update');
}

export function onUpdateProgress(handler: (p: UpdateProgress) => void): Promise<UnlistenFn> {
  return listen<UpdateProgress>('update://progress', (e) => handler(e.payload));
}
