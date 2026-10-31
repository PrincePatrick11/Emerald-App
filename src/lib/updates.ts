import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

/**
 * The frontend side of the in-app updater.
 *
 * Checking and installing happen exclusively in Rust (`src-tauri/src/updates.rs`) —
 * here are only the four calls and the progress event. The reason
 * is stated over there: signature verification and network traffic do not belong in the
 * WebView, and the endpoints can only be overridden at runtime there.
 */

export interface UpdateSettings {
  version: number;
  /** Empty means: the app's compiled-in sources. */
  endpoint: string;
  auto_check: boolean;
}

export interface UpdateCheck {
  available: boolean;
  /** The version found; empty if nothing is pending. */
  version: string;
  current_version: string;
  notes: string | null;
  date: string | null;
  /** False on a `.deb` installation — there the updater replaces nothing. */
  installable: boolean;
}

/**
 * The error that the Rust side delivers: a code for translating and the
 * original text for the log. The original text is English and written for developers
 * — it belongs in the console, not in the window.
 *
 * Codes: `unreachable` (nobody answered), `unsupported-target` (this
 * platform is not in the manifest), `invalid-url`, `write-failed`,
 * `unsupported-install`, `nothing-to-install`, `failed`.
 */
export interface UpdateError {
  code: string;
  detail: string;
}

/** What comes out of a `catch` is `unknown` — here it becomes an error
 *  with a code, even if something quite different was thrown. */
export function asUpdateError(e: unknown): UpdateError {
  if (e && typeof e === 'object' && 'code' in e && typeof (e as UpdateError).code === 'string') {
    return e as UpdateError;
  }
  return { code: 'failed', detail: String(e) };
}

export interface UpdateProgress {
  downloaded: number;
  /** Missing if the source does not send a size. */
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

/** If it succeeds, the app restarts — this promise then never resolves. */
export function installUpdate(): Promise<void> {
  return invoke<void>('install_update');
}

export function onUpdateProgress(handler: (p: UpdateProgress) => void): Promise<UnlistenFn> {
  return listen<UpdateProgress>('update://progress', (e) => handler(e.payload));
}
