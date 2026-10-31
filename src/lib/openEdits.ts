import { askInTab, useUIStore } from '../store/uiStore';
import { confirmLeave, holdsOpenEdit, leaveNeedsConfirm } from '../store/leaveGuardStore';
import { flushDrafts } from '../store/draftStore';
import { drainSerialized } from './serialize';

/**
 * Before anything that closes every open page at once — vault switch,
 * replacing from a backup, update, closing the window: asks in turn about
 * each running editing session with changes (`leaveGuardStore`), first the open
 * page, then the background tabs. The view switches there so that one
 * can see what it is about; once all are settled, one is back in the tab from the start.
 *
 * `false` as soon as someone chooses "Keep editing": then one is on exactly
 * that page, and the caller drops its plan.
 */
export async function resolveOpenEdits(): Promise<boolean> {
  const origin = useUIStore.getState().activeTabId;
  if (!(await confirmLeave())) return false;

  // Checked afresh per tab (`askInTab`): "Done" on the open page also ends its tab.
  const pending = useUIStore.getState().tabs.filter((tab) => holdsOpenEdit(tab.view)).map((tab) => tab.id);
  for (const id of pending) {
    if (!(await askInTab(id))) return false;
  }

  const { tabs, activeTabId, selectTab } = useUIStore.getState();
  if (origin && origin !== activeTabId && tabs.some((tab) => tab.id === origin)) selectTab(origin);
  return true;
}

/** Is there an editing session anywhere that `resolveOpenEdits` would ask about? */
export function hasOpenEdits(): boolean {
  return leaveNeedsConfirm() || useUIStore.getState().tabs.some((tab) => holdsOpenEdit(tab.view));
}

/**
 * Before anything that ends the app without further questions — closing the
 * window, installing an update: settle the open editing sessions, then wait for
 * whatever is still being written (what "Save" and stepping through the tabs
 * triggered, and that a draft just discarded is also gone from the file).
 * `false`: keep editing.
 */
export async function settleBeforeExit(): Promise<boolean> {
  if (!(await resolveOpenEdits())) return false;
  await Promise.all([drainSerialized(), flushDrafts()]);
  return true;
}
