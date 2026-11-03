import { create } from 'zustand';
import { resolveOpenEdits } from '../lib/openEdits';

/**
 * Whether the vault picker was asked for while a vault is open.
 *
 * Without an open vault `AppShell` shows the picker anyway — on a first start,
 * after the last vault was removed, or when the vault to start with could not be
 * opened. This flag is only the way in by hand: menu Emerald → "Switch vault…"
 * and the vault button in the rail.
 */
interface VaultPickerStore {
  open: boolean;
  /** Said once at the top of the picker: why it came up instead of the vault. */
  notice: string | null;
}

export const useVaultPickerStore = create<VaultPickerStore>(() => ({ open: false, notice: null }));

/**
 * Settles the open edits first, as a switch does — the picker hides every page,
 * and a vault chosen there closes them all. `false` if someone keeps editing.
 */
export async function openVaultPicker(): Promise<boolean> {
  if (useVaultPickerStore.getState().open) return true;
  if (!(await resolveOpenEdits())) return false;
  useVaultPickerStore.setState({ open: true, notice: null });
  return true;
}

export function closeVaultPicker(): void {
  useVaultPickerStore.setState({ open: false, notice: null });
}
