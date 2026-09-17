import { create } from 'zustand';
import { changeAppLanguage } from '../i18n';
import { applyEditorFont, applyTheme, applyUIFont } from '../themes/theme';
import { serialized } from '../lib/serialize';
import {
  APPEARANCE_MIRROR_KEYS, DEFAULT_VAULT_SETTINGS, initialSettingsFor, normalizeVaultSettings,
  readVaultSettings, writeVaultSettings,
  type AppearanceSettings, type SettingsGroup, type VaultSettings,
} from '../lib/vaultSettings';

interface SettingsState {
  /** Der Vault, dem `settings` gehört; `null` vor dem ersten Laden. */
  vaultId: string | null;
  settings: VaultSettings;

  /** Liest die Einstellungen eines Vaults und wendet sie an. Läuft beim Start
   *  und bei jedem Vault-Wechsel VOR dem Öffnen der Datenbank: die Migration
   *  v39 übersetzt einen Kategorienamen in die Sprache des Boot-Spiegels, und
   *  den schreibt erst `changeAppLanguage` hier. */
  loadForVault: (vaultId: string) => Promise<void>;
  /** Übernimmt ganze Einstellungen, etwa aus einem Backup, und schreibt sie. */
  replaceSettings: (settings: VaultSettings) => Promise<void>;
  update: <G extends SettingsGroup>(group: G, patch: Partial<VaultSettings[G]>) => void;
}

/**
 * Das Aussehen gilt sofort — und landet zusätzlich unter den alten
 * localStorage-Schlüsseln. Die liest der Start, bevor ein Vault offen ist
 * (`index.html`, `main.tsx`), damit die App nicht erst in Noctis und Englisch
 * aufblitzt und dann umspringt.
 */
async function applyAppearance(appearance: AppearanceSettings): Promise<void> {
  applyTheme(appearance.theme);
  applyUIFont(appearance.uiFont);
  applyEditorFont(appearance.editorFont);
  try {
    localStorage.setItem(APPEARANCE_MIRROR_KEYS.theme, appearance.theme);
    localStorage.setItem(APPEARANCE_MIRROR_KEYS.uiFont, appearance.uiFont);
    localStorage.setItem(APPEARANCE_MIRROR_KEYS.editorFont, appearance.editorFont);
  } catch {
    // Ohne Spiegel blitzt beim nächsten Start höchstens das Standard-Theme auf.
  }
  // Schreibt seinen Spiegel selbst, sobald das Bundle geladen ist.
  await changeAppLanguage(appearance.language).catch((err) => {
    console.error('[settings] language switch failed', err);
  });
}

/** Schreibaufträge laufen hintereinander, sonst überholt ein früher Stand den späteren. */
function persist(vaultId: string, settings: VaultSettings): Promise<void> {
  // Geloggt wird schon in `serialized`.
  return serialized('settings', () => writeVaultSettings(vaultId, settings)).catch(() => {});
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  vaultId: null,
  settings: DEFAULT_VAULT_SETTINGS,

  loadForVault: async (vaultId) => {
    const { settings: stored, corrupt } = await readVaultSettings(vaultId);
    const settings = stored ?? initialSettingsFor(vaultId);
    set({ vaultId, settings });
    await applyAppearance(settings.appearance);
    // Die Startwerte gleich festhalten: sonst bekäme der Vault beim nächsten
    // Öffnen erneut den Umstiegs-Schnappschuss statt dem, was galt.
    if (!stored && !corrupt) await persist(vaultId, settings);
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
