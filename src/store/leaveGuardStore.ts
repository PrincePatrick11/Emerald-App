import { create } from 'zustand';
import type { ActiveView } from '../types';

/**
 * An edit ends only with "Done" or "Cancel". Anyone who leaves it with
 * changes in any other way — elsewhere in the same tab, closing the tab, switching
 * vault, closing the window — is asked: save, discard or
 * keep editing. Switching to another tab does not ask, the
 * edit simply continues there.
 *
 * The page currently being edited registers its guard here
 * (`useEditActions`, `useDraftPage`). Whoever wants to leave the page asks via
 * `confirmLeave()`; the modal (`LeaveGuardModal`) answers the question.
 *
 * Import rule: this store imports no other — the others read
 * it, not the other way round.
 */
export interface EditGuard {
  /** The page the guard belongs to: `guardKey(view type, id)`. */
  key: string;
  /** The name of what is being edited — shown in the modal. */
  title: () => string;
  /** Has anything changed since entering, or is the entry new and never confirmed? */
  isDirty: () => boolean;
  /** Like "Done". */
  save: () => void | Promise<void>;
  /** Like "Cancel". */
  discard: () => void | Promise<void>;
}

export type LeaveChoice = 'save' | 'discard' | 'stay';

interface LeaveQuestion {
  title: string;
  answer: (choice: LeaveChoice) => void;
}

interface LeaveGuardState {
  guard: EditGuard | null;
  question: LeaveQuestion | null;
  /** Counts the "Keep editing" answers — how windows above the page notice that they should give way (`useCloseOnKeepEditing`). */
  stays: number;
  setGuard: (guard: EditGuard) => void;
  /** Clears only if the guard still belongs to this page — the next one may already have taken over. */
  clearGuard: (key: string) => void;
}

export const useLeaveGuardStore = create<LeaveGuardState>((set, get) => ({
  guard: null,
  question: null,
  stays: 0,
  setGuard: (guard) => set({ guard }),
  clearGuard: (key) => {
    if (get().guard?.key === key) set({ guard: null });
  },
}));

export const guardKey = (type: string, id: string) => `${type}:${id}`;

/**
 * The pages on which "Done", "Cancel" or "Delete" is currently running —
 * per page, not for all: a "Done" that is still writing must not suppress
 * the question for another page as well.
 */
const ending = new Map<string, number>();

/**
 * Runs the end of the edit of `key` without the navigation inside it
 * asking: "Done", "Cancel" and "Delete" switch the page themselves.
 */
export async function withoutLeaveGuard<T>(key: string, run: () => T | Promise<T>): Promise<T> {
  ending.set(key, (ending.get(key) ?? 0) + 1);
  try {
    return await run();
  } finally {
    const left = (ending.get(key) ?? 1) - 1;
    if (left > 0) ending.set(key, left);
    else ending.delete(key);
  }
}

/**
 * Is "Done", "Cancel" or "Delete" currently running on page `key`? Anyone who
 * would pull it out from under it — a type change — waits for that: its step
 * back to the list or to reading would otherwise fall into that lock
 * (`uiStore.editLocked`) and be dropped, or afterwards hit a type and id
 * pair that no longer exists.
 */
export const isEnding = (key: string): boolean => ending.has(key);

/** Would a question have to be asked before leaving the open page? */
export function leaveNeedsConfirm(): boolean {
  const guard = useLeaveGuardStore.getState().guard;
  if (!guard || ending.has(guard.key)) return false;
  try {
    return guard.isDirty();
  } catch (e) {
    // A guard that cannot answer holds nobody back.
    console.error('[leaveGuard] asking the page failed:', e);
    return false;
  }
}

/**
 * Asks if the open page carries unsaved changes, and carries out the
 * answer. `true`: the page may be left. `false`: keep
 * editing — or saving failed, in which case one stays as well.
 */
export async function confirmLeave(): Promise<boolean> {
  if (!leaveNeedsConfirm()) return true;
  const { guard, question } = useLeaveGuardStore.getState();
  // A question is already open: the second navigation does not wait beside it, it is dropped.
  if (!guard || question) return false;

  try {
    const title = guard.title();
    const choice = await new Promise<LeaveChoice>((answer) => {
      useLeaveGuardStore.setState({ question: { title, answer } });
    });
    useLeaveGuardStore.setState((s) => ({ question: null, stays: choice === 'stay' ? s.stays + 1 : s.stays }));
    if (choice === 'stay') return false;
    await withoutLeaveGuard(guard.key, () => (choice === 'save' ? guard.save() : guard.discard()));
    return true;
  } catch (e) {
    console.error('[leaveGuard] ending the edit failed:', e);
    useLeaveGuardStore.setState({ question: null });
    return false;
  }
}

/**
 * Waits until page `key` has registered its guard — after a
 * tab switch the view only mounts then, and its code may only be
 * loaded then. `false` if it does not do so in time.
 */
export function guardRegistered(key: string, timeoutMs = 3000): Promise<boolean> {
  if (useLeaveGuardStore.getState().guard?.key === key) return Promise.resolve(true);
  return new Promise((resolve) => {
    const done = (found: boolean) => {
      clearTimeout(timer);
      unsubscribe();
      resolve(found);
    };
    const unsubscribe = useLeaveGuardStore.subscribe((s) => {
      if (s.guard?.key === key) done(true);
    });
    const timer = setTimeout(() => done(false), timeoutMs);
  });
}

/**
 * Does a page that is not currently open carry unsaved changes? Whoever
 * keeps edits outside the view registers a probe here
 * (`draftStore`: a draft exists; `entryEdit`: the saved
 * state differs from the baseline). This way a background tab need not
 * be opened first just to find out that there is nothing to ask.
 */
type EditProbe = (view: ActiveView) => boolean;

const probes: EditProbe[] = [];

export function registerEditProbe(probe: EditProbe): void {
  probes.push(probe);
}

export function holdsOpenEdit(view: ActiveView): view is ActiveView & { id: string } {
  if (!view.id) return false;
  return probes.some((probe) => {
    try {
      return probe(view);
    } catch (e) {
      console.error('[leaveGuard] probing a page failed:', e);
      return false;
    }
  });
}
