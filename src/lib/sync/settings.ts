import type { VaultSettings } from '../vaultSettings';

/**
 * A vault's settings between devices, key by key, so that a theme picked on one
 * and a trash retention picked on the other both stay. They live in
 * `settings.json`, not in a table, so they travel as a change of their own.
 *
 * DOM-free and without stores: it also runs in node (`scripts/sync-check.mjs`).
 */

export const SETTINGS_TABLE = '_settings';

/**
 * What belongs to one device: the scale depends on the screen in front of you,
 * and whether and how often a device backs up depends on that device.
 */
const THIS_DEVICE_ONLY = (path: string) => path === 'appearance.uiScale' || path.startsWith('backup.');

export type FlatSettings = Record<string, unknown>;

export function flattenSettings(settings: VaultSettings): FlatSettings {
  const flat: FlatSettings = {};
  for (const [group, values] of Object.entries(settings)) {
    if (typeof values !== 'object' || values === null) continue;
    for (const [key, value] of Object.entries(values)) {
      const path = `${group}.${key}`;
      if (!THIS_DEVICE_ONLY(path)) flat[path] = value;
    }
  }
  return flat;
}

/** What `current` holds differently from `base`. */
export function settingsDiff(base: FlatSettings, current: FlatSettings): FlatSettings {
  const diff: FlatSettings = {};
  for (const [path, value] of Object.entries(current)) {
    if (JSON.stringify(base[path]) !== JSON.stringify(value)) diff[path] = value;
  }
  return diff;
}

/**
 * Incoming values on top of these settings, except where this device changed the
 * same key since `base`: its value stands and goes out with its next push. The
 * result still has to pass `normalizeVaultSettings`, as anything from outside does.
 */
export function mergeIncomingSettings(
  settings: VaultSettings,
  base: FlatSettings,
  incoming: FlatSettings
): { settings: VaultSettings; base: FlatSettings; changed: boolean } {
  const mine = settingsDiff(base, flattenSettings(settings));
  const next = structuredClone(settings) as unknown as Record<string, Record<string, unknown>>;
  let changed = false;
  for (const [path, value] of Object.entries(incoming)) {
    if (THIS_DEVICE_ONLY(path) || path in mine) continue;
    const dot = path.indexOf('.');
    const [group, key] = [path.slice(0, dot), path.slice(dot + 1)];
    if (typeof next[group] !== 'object' || next[group] === null) next[group] = {};
    if (JSON.stringify(next[group][key]) !== JSON.stringify(value)) changed = true;
    next[group][key] = value;
  }
  return { settings: next as unknown as VaultSettings, base: { ...base, ...incoming }, changed };
}
