import { useEffect, useRef, useState } from 'react';
import type { DraftStore } from '../store/draftStore';
import { guardKey, useLeaveGuardStore } from '../store/leaveGuardStore';

interface Options<T extends { name: string }> {
  store: DraftStore<T>;
  /** The view the page belongs to — for the guard (`leaveGuardStore`). */
  viewType: 'blocks' | 'templates';
  id: string;
  /** What the draft is called in the question when leaving. */
  label: (draft: T) => string;
  /** The saved state, mapped onto the draft's fields. */
  saved: T;
  /** Saves the changed fields — exactly those, nothing else. `base` is the state when opened. */
  save: (id: string, patch: Partial<T>, base: T) => Promise<unknown>;
  /** Back to the list. */
  onClose: () => void;
  /**
   * Only for a page that was just created with "New": what "Cancel" does — put
   * it in the trash, like a new entry (`useEntryEditor`).
   */
  onCancelNew?: () => void;
  logTag: string;
}

/** Trimmed, the way the stores save the name: a trailing space is not a change. */
function comparable<T extends { name: string }>(value: T, key: keyof T): string {
  return JSON.stringify(key === 'name' ? value.name.trim() : value[key]);
}

/**
 * The draft of a page that only saves with "Done" (custom blocks,
 * templates): on open it comes from the draft store or the saved state,
 * on every change it goes back into the store — an open tab keeps its work,
 * even when the view unmounts. "Done" writes only the fields that changed
 * compared to the state at open, and stays on the page on an error;
 * "Cancel" discards. Both lead back to the list.
 *
 * Anyone who leaves the page with a draft any other way is asked
 * (`leaveGuardStore`) — as with an entry being edited. Only switching to
 * another tab leaves the draft in place: the work continues there.
 */
export function useDraftPage<T extends { name: string }>({ store, viewType, id, label, saved, save, onClose, onCancelNew, logTag }: Options<T>) {
  const [base] = useState<T>(() => store.getState().drafts[id]?.base ?? saved);
  const [draft, setDraft] = useState<T>(() => store.getState().drafts[id]?.draft ?? saved);
  const [busy, setBusy] = useState(false);
  const { saveDraft, clearDraft } = store.getState();

  const changed = (Object.keys(draft) as (keyof T)[]).filter((key) => comparable(draft, key) !== comparable(base, key));
  const dirty = changed.length > 0;
  const changedKey = changed.join();

  useEffect(() => {
    if (dirty) saveDraft(id, { base, draft });
    else clearDraft(id);
    // `changedKey` instead of `changed`: the same list is a new array on every render.
  }, [id, base, draft, dirty, changedKey, saveDraft, clearDraft]);

  const patch = (p: Partial<T>) => setDraft((d) => ({ ...d, ...p }));

  const leave = () => {
    clearDraft(id);
    onClose();
  };

  /**
   * "Cancel": discards the draft — and a new, never confirmed page along
   * with it. The deletion then clears the draft, only once it has succeeded.
   */
  const cancel = () => (onCancelNew ? onCancelNew() : leave());

  const finish = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (dirty) {
        const changes: Partial<T> = {};
        for (const key of changed) changes[key] = draft[key];
        await save(id, changes, base);
      }
    } catch (err) {
      // Stay on the page: the draft is not saved.
      console.error(`[${logTag}] saving failed:`, err);
      setBusy(false);
      return;
    }
    leave();
  };

  // The guard always calls the handlers of the latest render. The probe for
  // background tabs is registered by the store itself (`draftStore`).
  const latest = useRef({ draft, label, finish, cancel });
  latest.current = { draft, label, finish, cancel };
  useEffect(() => {
    const key = guardKey(viewType, id);
    // Whether there is a draft is up to the store: "Done", "Cancel" and
    // delete clear it before they leave the page — and so do not ask.
    const hasDraft = () => id in store.getState().drafts;
    useLeaveGuardStore.getState().setGuard({
      key,
      title: () => latest.current.label(latest.current.draft),
      isDirty: hasDraft,
      save: async () => {
        await latest.current.finish();
        // `finish` stays on the page on an error — then stay here too.
        if (hasDraft()) throw new Error('draft could not be saved');
      },
      // Like "Cancel": a new, never confirmed page goes to the trash.
      discard: () => latest.current.cancel(),
    });
    return () => useLeaveGuardStore.getState().clearGuard(key);
  }, [viewType, id, store]);

  return { draft, setDraft, patch, dirty, busy, setBusy, finish, leave, cancel };
}
