import { create } from 'zustand';
import { changeAppLanguage } from '../i18n';
import { applyEditorFont, applyEditorFontSize, applyTheme, applyUIFont, applyUIScale } from '../themes/theme';
import { serialized } from '../lib/serialize';
import {
  APPEARANCE_MIRROR_KEYS, DEFAULT_VAULT_SETTINGS, initialSettingsFor, normalizeVaultSettings,
  readVaultSettings, writeVaultSettings,
  type AppearanceSettings, type SettingsGroup, type VaultSettings,
} from '../lib/vaultSettings';

interface SettingsState {
  /** The vault that `settings` belongs to; `null` before the first load. */
  vaultId: string | null;
  settings: VaultSettings;

  /** Reads a vault's settings and applies them. Runs at startup
   *  and on every vault switch BEFORE the database is opened: migration
   *  v39 translates a category name into the language of the boot mirror, and
   *  only `changeAppLanguage` writes that here. */
  loadForVault: (vaultId: string) => Promise<void>;
  /** No vault open any more (failed switch, last vault removed):
   *  back to the defaults. Otherwise the interface would keep running with the
   *  settings of a vault that is no longer being written to. */
  clear: () => Promise<void>;
  /** Adopts a complete set of settings, e.g. from a backup, and writes them. */
  replaceSettings: (settings: VaultSettings) => Promise<void>;
  update: <G extends SettingsGroup>(group: G, patch: Partial<VaultSettings[G]>) => void;
}

/**
 * The appearance applies immediately — and is additionally stored under the old
 * localStorage keys. Startup reads those before a vault is open
 * (`index.html`, `main.tsx`), so the app does not flash Noctis and English
 * first and then switch.
 */
async function applyAppearance(appearance: AppearanceSettings): Promise<void> {
  applyTheme(appearance.theme, appearance.customThemes);
  applyUIFont(appearance.uiFont);
  applyEditorFont(appearance.editorFont);
  applyUIScale(appearance.uiScale);
  applyEditorFontSize(appearance.editorFontSize);
  try {
    localStorage.setItem(APPEARANCE_MIRROR_KEYS.theme, appearance.theme);
    localStorage.setItem(APPEARANCE_MIRROR_KEYS.customThemes, JSON.stringify(appearance.customThemes));
    localStorage.setItem(APPEARANCE_MIRROR_KEYS.uiFont, appearance.uiFont);
    localStorage.setItem(APPEARANCE_MIRROR_KEYS.editorFont, appearance.editorFont);
    localStorage.setItem(APPEARANCE_MIRROR_KEYS.uiScale, String(appearance.uiScale));
    localStorage.setItem(APPEARANCE_MIRROR_KEYS.editorFontSize, String(appearance.editorFontSize));
  } catch {
    // Without the mirror, at worst the default theme flashes on the next start.
  }
  // Writes its mirror itself once the bundle is loaded.
  await changeAppLanguage(appearance.language).catch((err) => {
    console.error('[settings] language switch failed', err);
  });
}

/** Write jobs run one after another, otherwise an early state overtakes a later one. */
function persist(vaultId: string, settings: VaultSettings): Promise<void> {
  // Logging already happens in `serialized`.
  return serialized('settings', () => writeVaultSettings(vaultId, settings)).catch(() => {});
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  vaultId: null,
  settings: DEFAULT_VAULT_SETTINGS,

  loadForVault: async (vaultId) => {
    const { settings: stored, corrupt } = await readVaultSettings(vaultId);
    // For an unreadable file the defaults step in — except for the
    // trash retention period: 30 days that nobody chose must not empty a trash
    // set to "never", neither now nor after the next change has rewritten
    // the file along with these values.
    const fallback = initialSettingsFor(vaultId);
    const settings = stored ?? (corrupt ? { ...fallback, trash: { ...fallback.trash, retentionDays: null } } : fallback);
    set({ vaultId, settings });
    await applyAppearance(settings.appearance);
    // Persist the initial values right away: otherwise the vault would get the
    // migration snapshot again on the next open instead of what applied.
    if (!stored && !corrupt) await persist(vaultId, settings);
  },

  clear: async () => {
    const settings = structuredClone(DEFAULT_VAULT_SETTINGS);
    set({ vaultId: null, settings });
    await applyAppearance(settings.appearance);
  },

  replaceSettings: async (next) => {
    const { vaultId } = get();
    const settings = normalizeVaultSettings(next);
    set({ settings });
    await applyAppearance(settings.appearance);
    if (vaultId) await persist(vaultId, settings);
  },

  update: (group, patch) => {
    const { vaultId, settings: prev } = get();
    const settings = { ...prev, [group]: { ...prev[group], ...patch } } as VaultSettings;
    set({ settings });
    if (group === 'appearance') void applyAppearance(settings.appearance);
    if (vaultId) void persist(vaultId, settings);
  },
}));
