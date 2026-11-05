import { create } from 'zustand';
import { changeAppLanguage, type AppLanguage } from '../i18n';
import { applyTheme, customThemeSelection, DEFAULT_THEME_ID, type ThemeSelection } from '../themes/theme';
import { MAX_CUSTOM_THEMES, normalizeCustomThemes, type CustomTheme } from '../themes/customTheme';
import { serialized } from '../lib/serialize';
import {
  DEFAULT_DEVICE_SETTINGS, hasDeviceMirror, normalizeDeviceSettings, readDeviceMirror, readDeviceSettings,
  writeDeviceMirror, writeDeviceSettings, type DeviceSettings,
} from '../lib/deviceSettings';

/**
 * Language and theme of this installation (`lib/deviceSettings.ts`). Applied
 * the moment they change, written to `device.json` and its mirror.
 */
interface DeviceStore {
  settings: DeviceSettings;
  loaded: boolean;
  /**
   * The first start with `device.json` found no mirror to take the values
   * from: the first vault opened lends its old ones (`adoptFromVault`).
   */
  awaitsVault: boolean;
  load: () => Promise<void>;
  setLanguage: (language: AppLanguage) => void;
  setTheme: (theme: ThemeSelection) => void;
  /** Adds one theme and selects it. `false` when the list is full. */
  addCustomTheme: (theme: CustomTheme) => boolean;
  removeCustomTheme: (id: string) => void;
  /** A backup's themes join the list (up to the cap); the selection stays. */
  adoptCustomThemes: (raw: unknown) => void;
  /** The appearance a vault's `settings.json` held before these moved here. */
  adoptFromVault: (appearance: unknown) => void;
}

async function apply(settings: DeviceSettings): Promise<void> {
  applyTheme(settings.theme, settings.customThemes);
  writeDeviceMirror(settings);
  await changeAppLanguage(settings.language).catch((err) => {
    console.error('[device] language switch failed', err);
  });
}

function persist(settings: DeviceSettings): void {
  // Logging already happens in `serialized`.
  void serialized('device-settings', () => writeDeviceSettings(settings)).catch(() => {});
}

export const useDeviceStore = create<DeviceStore>((set, get) => {
  // A choice made here outranks what an old vault would lend later.
  const commit = (next: DeviceSettings) => {
    set({ settings: next, awaitsVault: false });
    void apply(next);
    persist(next);
  };

  return {
    // The mirror until the file is read: what `main.tsx` already applied.
    settings: readDeviceMirror(),
    loaded: false,
    awaitsVault: false,

    load: async () => {
      let stored: DeviceSettings | null = null;
      try {
        stored = await readDeviceSettings();
      } catch (err) {
        console.error('[device] reading device.json failed', err);
        set({ loaded: true });
        return;
      }
      if (stored) {
        set({ settings: stored, loaded: true });
        await apply(stored);
        return;
      }
      // First start with this version: the mirror holds what the last open
      // vault applied. Without one, the first vault opened decides.
      const migrated = readDeviceMirror();
      set({ settings: migrated, loaded: true, awaitsVault: !hasDeviceMirror() });
      persist(migrated);
    },

    setLanguage: (language) => commit({ ...get().settings, language }),

    setTheme: (theme) => commit({ ...get().settings, theme }),

    addCustomTheme: (theme) => {
      const current = get().settings;
      if (current.customThemes.length >= MAX_CUSTOM_THEMES) return false;
      commit({ ...current, customThemes: [...current.customThemes, theme], theme: customThemeSelection(theme.id) });
      return true;
    },

    removeCustomTheme: (id) => {
      const current = get().settings;
      const wasActive = current.theme === customThemeSelection(id);
      commit({
        ...current,
        customThemes: current.customThemes.filter((theme) => theme.id !== id),
        theme: wasActive ? DEFAULT_THEME_ID : current.theme,
      });
    },

    adoptCustomThemes: (raw) => {
      const incoming = normalizeCustomThemes(raw);
      const current = get().settings;
      const own = new Set(current.customThemes.map((theme) => theme.id));
      const added = incoming.filter((theme) => !own.has(theme.id));
      if (!added.length) return;
      commit({ ...current, customThemes: [...current.customThemes, ...added].slice(0, MAX_CUSTOM_THEMES) });
    },

    adoptFromVault: (appearance) => {
      if (!get().awaitsVault) return;
      set({ awaitsVault: false });
      const record = appearance && typeof appearance === 'object' ? (appearance as Record<string, unknown>) : {};
      if (!('theme' in record) && !('language' in record) && !('customThemes' in record)) return;
      commit(normalizeDeviceSettings({ ...DEFAULT_DEVICE_SETTINGS, ...record }));
    },
  };
});
