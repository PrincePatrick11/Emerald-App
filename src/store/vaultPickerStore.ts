import { create } from 'zustand';
import { resolveOpenEdits } from '../lib/openEdits';

/** What the start page turns to when it opens: the server's card, or a check for updates. */
export type StartFocus = 'server' | 'updates';

/**
 * Whether the start page (the vault picker grown into the app's home screen)
 * was asked for while a vault is open, and what it should turn to.
 *
 * Without an open vault `AppShell` shows it anyway — on a first start, after
 * the last vault was removed, or when the vault to start with could not be
 * opened. `open` is only the way in by hand: menu Emerald → "Switch vault…",
 * "About Emerald App", "Check for Updates…", and the start page button at the
 * bottom of the rail (with its update dot, the page opens checking).
 */
interface VaultPickerStore {
  open: boolean;
  /** Taken by the part it names (`takeStartFocus`), so it acts once. */
  focus: StartFocus | null;
  /** Said once at the top of the list: why it came up instead of the vault. */
  notice: string | null;
}

export const useVaultPickerStore = create<VaultPickerStore>(() => ({ open: false, focus: null, notice: null }));

/**
 * Settles the open edits first, as a switch does — the start page hides every
 * page, and a vault chosen there closes them all. `false` if someone keeps
 * editing.
 */
export async function openVaultPicker(focus?: StartFocus): Promise<boolean> {
  const state = useVaultPickerStore.getState();
  if (state.open) {
    if (focus) useVaultPickerStore.setState({ focus });
    return true;
  }
  if (!(await resolveOpenEdits())) return false;
  useVaultPickerStore.setState({ open: true, notice: null, focus: focus ?? null });
  return true;
}

/** Clears the focus once its part has acted on it. */
export function takeStartFocus(): void {
  useVaultPickerStore.setState({ focus: null });
}

export function closeVaultPicker(): void {
  useVaultPickerStore.setState({ open: false, notice: null, focus: null });
}
