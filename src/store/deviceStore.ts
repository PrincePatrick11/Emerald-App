import { create } from 'zustand';
import { changeAppLanguage, type AppLanguage } from '../i18n';
import { applyTheme, customThemeSelection, DEFAULT_THEME_ID, type ThemeSelection } from '../themes/theme';
import { MAX_CUSTOM_THEMES, normalizeCustomThemes, type CustomTheme } from '../themes/customTheme';
import { serialized } from '../lib/serialize';
import {
  hasDeviceMirror, normalizeDeviceSettings, readDeviceMirror, readDeviceSettings,
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
  /**
   * `device.json` did not read (Rust set it aside): the mirror stands in, and
   * nothing is written until the user chooses something.
   */
  corrupt: boolean;
  load: () => Promise<void>;
  setLanguage: (language: AppLanguage) => void;
  setTheme: (theme: ThemeSelection) => void;
  /** Adds one theme and selects it. `false` when the list is full. */
  addCustomTheme: (theme: CustomTheme) => boolean;
  removeCustomTheme: (id: string) => void;
  /** A backup's themes join the list (up to the cap); the selection stays. */
  adoptCustomThemes: (raw: unknown) => void;
  /**
   * What a vault's `settings.json` still holds from when language and theme
   * were vault settings: its custom themes join the list once per vault, and on
   * the first start without a mirror its language and theme apply as well.
   * Resolves once they are applied: migration v39 needs the language.
   */
  adoptFromVault: (vaultId: string, appearance: unknown) => Promise<void>;
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

function themesJoined(current: CustomTheme[], raw: unknown): CustomTheme[] {
  const own = new Set(current.map((theme) => theme.id));
  const added = normalizeCustomThemes(raw).filter((theme) => !own.has(theme.id));
  return [...current, ...added].slice(0, MAX_CUSTOM_THEMES);
}

export const useDeviceStore = create<DeviceStore>((set, get) => {
  /**
   * `byUser`: a choice made here. It outranks what an old vault would lend
   * later, and it is what ends a corrupt file's read-only state.
   */
  const commit = (next: DeviceSettings, { byUser = true } = {}): Promise<void> => {
    const writable = byUser || !get().corrupt;
    set({ settings: next, ...(byUser ? { awaitsVault: false, corrupt: false } : {}) });
    if (writable) persist(next);
    return apply(next);
  };

  async function loadFile(): Promise<void> {
    let read: Awaited<ReturnType<typeof readDeviceSettings>>;
    try {
      read = await readDeviceSettings();
    } catch (err) {
      console.error('[device] reading device.json failed', err);
      set({ loaded: true, corrupt: true });
      return;
    }
    if (read.kind === 'found') {
      set({ settings: read.settings, loaded: true });
      await apply(read.settings);
      return;
    }
    // Unreadable: keep what the mirror says, and keep it there — writing
    // the defaults now would cost the theme and the custom themes.
    if (read.kind === 'corrupt') {
      set({ settings: readDeviceMirror(), loaded: true, corrupt: true });
      return;
    }
    // First start with this version: the mirror holds what the last open
    // vault applied. Without one, the first vault opened decides.
    const migrated = readDeviceMirror();
    set({ settings: migrated, loaded: true, awaitsVault: !hasDeviceMirror() });
    persist(migrated);
  }

  let loading: Promise<void> | null = null;

  return {
    // The mirror until the file is read: what `main.tsx` already applied.
    settings: readDeviceMirror(),
    loaded: false,
    awaitsVault: false,
    corrupt: false,

    // Once per run: StrictMode starts the boot effect twice, and a second read
    // after Rust set an unreadable file aside would find it missing and take
    // that for a first start.
    load: () => (loading ??= loadFile()),


    setLanguage: (language) => { void commit({ ...get().settings, language }); },

    setTheme: (theme) => { void commit({ ...get().settings, theme }); },

    addCustomTheme: (theme) => {
      const current = get().settings;
      if (current.customThemes.length >= MAX_CUSTOM_THEMES) return false;
      void commit({ ...current, customThemes: [...current.customThemes, theme], theme: customThemeSelection(theme.id) });
      return true;
    },

    removeCustomTheme: (id) => {
      const current = get().settings;
      const wasActive = current.theme === customThemeSelection(id);
      void commit({
        ...current,
        customThemes: current.customThemes.filter((theme) => theme.id !== id),
        theme: wasActive ? DEFAULT_THEME_ID : current.theme,
      });
    },

    adoptCustomThemes: (raw) => {
      const current = get().settings;
      const customThemes = themesJoined(current.customThemes, raw);
      if (customThemes.length === current.customThemes.length) return;
      void commit({ ...current, customThemes });
    },

    adoptFromVault: async (vaultId, appearance) => {
      const record = appearance && typeof appearance === 'object' ? (appearance as Record<string, unknown>) : {};
      const current = get().settings;
      const lendsAll = get().awaitsVault && ('theme' in record || 'language' in record);
      set({ awaitsVault: false });
      if (current.adoptedFrom.includes(vaultId) && !lendsAll) return;
      const customThemes = themesJoined(current.customThemes, record.customThemes);
      const base = lendsAll
        ? normalizeDeviceSettings({ ...current, language: record.language, theme: record.theme, customThemes })
        : { ...current, customThemes };
      const next = { ...base, adoptedFrom: [...new Set([...current.adoptedFrom, vaultId])] };
      await commit(next, { byUser: false });
    },
  };
});
