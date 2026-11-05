import { invoke } from '@tauri-apps/api/core';
import { LANGUAGE_OPTIONS, LANGUAGE_STORAGE_KEY, type AppLanguage } from '../i18n';
import { DEFAULT_THEME_ID, normalizeThemeSelection, type ThemeSelection } from '../themes/theme';
import { normalizeCustomThemes, type CustomTheme } from '../themes/customTheme';
import type { VaultFileRead } from './vaultSettings';

/**
 * What belongs to this installation rather than to a vault: the language and
 * the theme, custom themes included.
 *
 * `{appDataDir}/device.json`, next to `vaults.json`, `update.json` and
 * `sync.json`, so it is there before any vault is unlocked — the start page
 * and the loading screen already show it — and no vault, backup or sync
 * brings it along. localStorage keeps a mirror of it for the first frame
 * (`index.html` and `main.tsx` read it before the file can be).
 */
export interface DeviceSettings {
  version: 1;
  language: AppLanguage;
  theme: ThemeSelection;
  customThemes: CustomTheme[];
}

export const DEFAULT_DEVICE_SETTINGS: DeviceSettings = {
  version: 1,
  language: 'en',
  theme: DEFAULT_THEME_ID,
  customThemes: [],
};

const LANGUAGES = new Set<string>(LANGUAGE_OPTIONS.map((o) => o.code));

/** The localStorage keys of the mirror. `theme-id` is read by hand in `index.html`. */
export const DEVICE_MIRROR_KEYS = {
  language: LANGUAGE_STORAGE_KEY,
  theme: 'theme-id',
  customThemes: 'custom-themes',
} as const;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/**
 * Anything in the shape of these settings — the file, the mirror, or the
 * `appearance` group a vault's `settings.json` held before they moved here.
 */
export function normalizeDeviceSettings(raw: unknown): DeviceSettings {
  const root = asRecord(raw);
  const language = asString(root.language);
  const customThemes = normalizeCustomThemes(root.customThemes);
  return {
    version: 1,
    language: language && LANGUAGES.has(language) ? (language as AppLanguage) : DEFAULT_DEVICE_SETTINGS.language,
    theme: normalizeThemeSelection(asString(root.theme), customThemes),
    customThemes,
  };
}

function readMirrorKey(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Whether the mirror holds anything at all — an installation that ran before. */
export function hasDeviceMirror(): boolean {
  return Object.values(DEVICE_MIRROR_KEYS).some((key) => readMirrorKey(key) !== null) || readMirrorKey('theme') !== null;
}

/** The settings according to the mirror, validated like the file. */
export function readDeviceMirror(): DeviceSettings {
  let customThemes: unknown = [];
  try {
    customThemes = JSON.parse(readMirrorKey(DEVICE_MIRROR_KEYS.customThemes) ?? '[]');
  } catch {
    // A broken mirror is no theme.
  }
  return normalizeDeviceSettings({
    language: readMirrorKey(DEVICE_MIRROR_KEYS.language),
    // `theme` is the key from before the theme ids ('light'/'dark').
    theme: readMirrorKey(DEVICE_MIRROR_KEYS.theme) ?? readMirrorKey('theme'),
    customThemes,
  });
}

/** The language is mirrored by `changeAppLanguage` itself. */
export function writeDeviceMirror(settings: DeviceSettings): void {
  try {
    localStorage.setItem(DEVICE_MIRROR_KEYS.theme, settings.theme);
    localStorage.setItem(DEVICE_MIRROR_KEYS.customThemes, JSON.stringify(settings.customThemes));
  } catch {
    // Without the mirror, at worst the default theme flashes on the next start.
  }
}

/** `null` while the file does not exist yet: the first start with this version. */
export async function readDeviceSettings(): Promise<DeviceSettings | null> {
  const read = await invoke<VaultFileRead>('read_device_settings');
  if (read.kind === 'missing') return null;
  if (read.kind === 'found') {
    try {
      return normalizeDeviceSettings(JSON.parse(read.contents));
    } catch (err) {
      console.warn('[device] unreadable device.json, using defaults', err);
    }
  }
  return structuredClone(DEFAULT_DEVICE_SETTINGS);
}

export function writeDeviceSettings(settings: DeviceSettings): Promise<void> {
  return invoke('write_device_settings', { contents: JSON.stringify(settings, null, 2) });
}
