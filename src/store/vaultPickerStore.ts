import { create } from 'zustand';
import { resolveOpenEdits } from '../lib/openEdits';

/** The sections of the start page's right column. */
export type StartSection = 'server' | 'appearance' | 'updates' | 'about';

/**
 * Whether the start page (the vault picker grown into the app's home screen)
 * was asked for while a vault is open, and which section it shows.
 *
 * Without an open vault `AppShell` shows it anyway — on a first start, after
 * the last vault was removed, or when the vault to start with could not be
 * opened. `open` is only the way in by hand: menu Emerald → "Switch vault…",
 * "About Emerald App", "Check for Updates…", the vault button in the rail and
 * the update dot on the gear.
 */
interface VaultPickerStore {
  open: boolean;
  section: StartSection;
  /** Said once at the top of the list: why it came up instead of the vault. */
  notice: string | null;
}

export const useVaultPickerStore = create<VaultPickerStore>(() => ({ open: false, section: 'server', notice: null }));

/**
 * Settles the open edits first, as a switch does — the start page hides every
 * page, and a vault chosen there closes them all. `false` if someone keeps
 * editing. `section` picks the right column's section; without it, it stays.
 */
export async function openVaultPicker(section?: StartSection): Promise<boolean> {
  const state = useVaultPickerStore.getState();
  if (state.open) {
    if (section) useVaultPickerStore.setState({ section });
    return true;
  }
  if (!(await resolveOpenEdits())) return false;
  useVaultPickerStore.setState({ open: true, notice: null, ...(section ? { section } : {}) });
  return true;
}

export function showStartSection(section: StartSection): void {
  useVaultPickerStore.setState({ section });
}

export function closeVaultPicker(): void {
  useVaultPickerStore.setState({ open: false, notice: null });
}
