import { create } from 'zustand';
import { applyEditorFont, applyEditorFontSize, applyUIFont, applyUIScale } from '../themes/theme';
import { serialized } from '../lib/serialize';
import { useDeviceStore } from './deviceStore';
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
   *  and on every vault switch after the gate has checked the database and
   *  before `getDb()`: its purge of the trash needs the retention period. */
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
 * The vault's fonts and sizes apply immediately — and are additionally stored
 * under the old localStorage keys, which startup reads before a vault is open
 * (`main.tsx`). Language and theme belong to the device (`deviceStore`).
 */
async function applyAppearance(appearance: AppearanceSettings): Promise<void> {
  applyUIFont(appearance.uiFont);
  applyEditorFont(appearance.editorFont);
  applyUIScale(appearance.uiScale);
  applyEditorFontSize(appearance.editorFontSize);
  try {
    localStorage.setItem(APPEARANCE_MIRROR_KEYS.uiFont, appearance.uiFont);
    localStorage.setItem(APPEARANCE_MIRROR_KEYS.editorFont, appearance.editorFont);
    localStorage.setItem(APPEARANCE_MIRROR_KEYS.uiScale, String(appearance.uiScale));
    localStorage.setItem(APPEARANCE_MIRROR_KEYS.editorFontSize, String(appearance.editorFontSize));
  } catch {
    // Without the mirror, at worst the default fonts flash on the next start.
  }
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
    // What this vault still holds from when language and theme were vault
    // settings: its custom themes join the device's, once; on the first start
    // without a mirror its language and theme too.
    await useDeviceStore.getState().adoptFromVault(vaultId, stored?.appearance);
    await applyAppearance(settings.appearance);
    // Persist the initial values right away: otherwise the vault would get the
    // snapshot of the old device settings again on the next open instead of what applied.
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
