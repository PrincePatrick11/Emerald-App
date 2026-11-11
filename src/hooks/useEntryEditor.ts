import { useCallback, useEffect, useRef } from 'react';
import { editorSavesSuspended } from '../lib/editorLock';
import { entryTypeForView, type ViewId } from '../lib/modules';
import { revertEntryType } from '../lib/entryTypeChange';
import { serialKey, settled } from '../lib/serialize';
import {
  baselineKey, baselineOf, baselines, beginDiscard, editIsDirty, endDiscard, isDiscarding, pendingEntryWrites, type BaselineFields,
} from '../store/entryEdit';
import { useUIStore, withEditLock } from '../store/uiStore';
import type { WriteOptions } from '../lib/stamp';

/**
 * What `restoreOnCancel` reports instead of a state when the view no longer
 * shows this entry and editing has already ended: Cancel reverted a type
 * change, the user switched to another tab while the write-back was running,
 * or an earlier Cancel was faster. The view must then do nothing more — its
 * own `setActiveView(…)` would point to a type/id pair that no longer
 * exists, or would take the WRONG tab there, and its local state already
 * belongs to the next entry.
 */
export const EDIT_ENDED = 'edit-ended';

/**
 * Debounced autosave, saving on navigating away and saving on unmount —
 * the editor lifecycle that JournalView, WikiView and OperationsView
 * previously each kept as their own ~80-line copy, with quietly drifting
 * details.
 *
 * `buildPatch` is only called at the moment of saving and reads the view's
 * current local state plus the editor's content-mirror ref there. The hook
 * keeps the newest closure in a ref on every render; saving on navigating
 * away thus still sees the values of the PREVIOUS entry, because the views'
 * load effects only run after this hook's effects (the hook call comes
 * before them in the component body).
 *
 * `ready` arms the nav/unmount saves only once the view has loaded its local
 * state from the entry (`loadedEntryId === entry.id`). Without the gate, a
 * mount directly in edit mode (StrictMode double mount, edit tab restored
 * from localStorage) would write the still-empty title to the DB.
 */
interface UseEntryEditorOptions<TPatch extends BaselineFields, TRestore extends BaselineFields = TPatch> {
  /** The view the entries belong to — distinguishes the baselines (`baselines`). */
  scope: ViewId;
  entityId: string | undefined;
  isEditing: boolean;
  ready: boolean;
  /** Receives the current editor content (the hook's content-mirror ref) as its argument. */
  buildPatch: (content: string) => TPatch;
  /**
   * What Cancel resets — the whole entry as it was on entering edit mode:
   * title and content, plus everything the sidebar saves directly while
   * editing (tags, category, icon, cover image). More than `buildPatch`,
   * because the autosave does not touch these fields. Default: buildPatch.
   */
  buildRestorePatch?: (content: string) => TRestore;
  /**
   * The saved state of the entry, in the shape of `buildRestorePatch` —
   * what Cancel and the guard measure against to see whether anything has
   * changed. Not the local state: typed, written by the autosave, typed back
   * and cancelled right away, that would look unchanged. `null` if the entry
   * no longer exists. May only read from stores — the probe for background
   * tabs also calls it when the view is no longer mounted.
   */
  readStored: (id: string) => TRestore | null;
  /** "Last modified" of the saved entry — Cancel restores the state from when editing was entered. */
  readStamp: (id: string) => string | undefined;
  update: (id: string, patch: TPatch | TRestore, options?: WriteOptions) => Promise<void>;
  debounceMs?: number;
}

export function useEntryEditor<TPatch extends BaselineFields, TRestore extends BaselineFields = TPatch>({
  scope,
  entityId,
  isEditing,
  ready,
  buildPatch,
  buildRestorePatch,
  readStored,
  readStamp,
  update,
  debounceMs = 1500,
}: UseEntryEditorOptions<TPatch, TRestore>) {
  const buildPatchRef = useRef(buildPatch);
  buildPatchRef.current = buildPatch;
  const buildRestorePatchRef = useRef(buildRestorePatch);
  buildRestorePatchRef.current = buildRestorePatch;
  const readStoredRef = useRef(readStored);
  readStoredRef.current = readStored;
  const readStampRef = useRef(readStamp);
  readStampRef.current = readStamp;
  const updateRef = useRef(update);
  updateRef.current = update;
  const isEditingRef = useRef(isEditing);
  isEditingRef.current = isEditing;
  const idRef = useRef(entityId);
  idRef.current = entityId;

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevRef = useRef<{ id: string; isEditing: boolean } | null>(null);

  // The editor content is mirrored into this ref on every keystroke instead
  // of into state — a state update would have re-rendered the whole view on
  // every keystroke. It is only read when saving (as the buildPatch argument).
  // The view sets it to the saved state on load and on Cancel.
  const contentRef = useRef('');

  // `timer.current === null` means "no save pending" — Done and Cancel
  // call cancelAutoSave() and thereby make the flush below a no-op; merely
  // leaving the dead handle behind would make that question unanswerable.
  const cancelAutoSave = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const triggerAutoSave = useCallback(() => {
    // Outside of editing there is nothing to defer: the block stack also
    // reports read-mode changes (ticking a checklist) through
    // handleContentChange so that the content mirror knows them — it has
    // already saved them itself by then.
    if (!isEditingRef.current) return;
    if (timer.current) clearTimeout(timer.current);
    const id = idRef.current;
    timer.current = setTimeout(() => {
      timer.current = null;
      if (!isEditingRef.current || !id || editorSavesSuspended() || isDiscarding(id)) return;
      // Fire-and-forget: while `withDbClosed` is running (vault files are
      // being deleted) `getDb()` rejects, and the change belongs to the
      // vault that is disappearing anyway.
      void updateRef.current(id, buildPatchRef.current(contentRef.current)).catch(() => {});
    }, debounceMs);
  }, [debounceMs]);

  const handleContentChange = useCallback((html: string) => {
    contentRef.current = html;
    triggerAutoSave();
  }, [triggerAutoSave]);

  // The state of the entry on entering edit mode. Cancel cannot rely on
  // the store — after the first debounced autosave the store IS already the
  // edited state, a "reset" to it would be a no-op.
  // On entry the local state still mirrors exactly what is saved, so the
  // restore patch yields the before-values here. The `ready` gate holds
  // the capture back until the view has loaded its state from the entry
  // — the hook effects run before the view's load effects. If a state
  // already exists, the editing is still running (see `baselines`): it stays.
  const restoreFields = (content: string): TRestore =>
    (buildRestorePatchRef.current ?? (buildPatchRef.current as unknown as (c: string) => TRestore))(content);
  useEffect(() => {
    if (!isEditing || !ready || !entityId) return;
    const key = baselineKey(scope, entityId);
    const running = baselines.get(key);
    if (running) {
      // Editing is already running. From now on this view reads the saved
      // state: after a type change the state came along from another view,
      // and that view's reader would no longer find the entry.
      running.stored = () => readStoredRef.current(entityId);
      return;
    }
    // A new editing session: an earlier Cancel is over, including one that
    // reverted the type. Not further up — the view that mounts between a type
    // change and its reversal finds a state and must not save anything.
    endDiscard(entityId);
    const patch = restoreFields(contentRef.current);
    baselines.set(key, {
      scope,
      id: entityId,
      patch,
      stamp: readStampRef.current(entityId),
      stored: () => readStoredRef.current(entityId),
    });
  }, [isEditing, ready, entityId, scope]);

  /**
   * The Cancel path: defuses the timer and writes the entry's entry-time
   * state back to store and DB, "last modified" included — whether anything
   * needs to be written at all is decided by the store (`needsWrite`). Returns
   * the baseline so the view can set its local state from it; null if there
   * is nothing to return (no entry open, the write or the reversal failed) —
   * the view then falls back to the store state and leaves edit mode anyway.
   *
   * If the entry changed type during this editing session, it goes back to
   * its module with the entry-time state (`revertEntryType`). If the open
   * page at the end no longer shows this entry in this view, the result is
   * `EDIT_ENDED` (see there).
   *
   * While it writes, editing is locked (`withEditLock`) and no view saves
   * for this entry any more (`isDiscarding`).
   */
  const restoreOnCancel = useCallback(async (): Promise<TRestore | typeof EDIT_ENDED | null> => {
    cancelAutoSave();
    const id = idRef.current;
    if (!id) return null;
    const tabId = useUIStore.getState().activeTabId;
    beginDiscard(id);
    type Outcome = { restored: TRestore | null; reverted: boolean };
    const { restored, reverted } = await withEditLock(async (): Promise<Outcome> => {
      // An icon still being shrunk drops itself now that discarding has begun;
      // inside the lock, so the page stays locked from the click on.
      await pendingEntryWrites(id);
      // A type change that is still writing already belongs to the editing
      // session: only after it is it clear under which view its baseline lies.
      await settled(serialKey('entry', id));
      const baseline = baselineOf(id);
      // Only journal, wiki and operations change type — `type` then always exists.
      const type = baseline && entryTypeForView(baseline.scope);
      if (baseline?.origin && type) {
        return { restored: null, reverted: await revertEntryType(id, type, baseline.origin, baseline.patch, baseline.stamp) };
      }
      if (baseline) {
        await updateRef.current(id, baseline.patch as TRestore, { touch: baseline.stamp ?? true });
        return { restored: baseline.patch as TRestore, reverted: false };
      }
      // No baseline any more: an earlier Cancel has already ended the editing.
      // What is saved is then the restored entry — not what the view still
      // had in front of it at the click.
      return { restored: readStoredRef.current(id), reverted: false };
    }).catch((e: unknown): Outcome => {
      console.error('[useEntryEditor] restore on cancel failed:', e);
      return { restored: null, reverted: false };
    });
    // A keystroke during the await would have armed the timer again.
    cancelAutoSave();

    // The entry no longer belongs to this view: reverted (also by an earlier
    // Cancel) or deleted. Views are then still being torn down —
    // the mark stays until the next editing session clears it.
    const leftView = reverted || readStoredRef.current(id) === null;
    if (!leftView) endDiscard(id);
    const ui = useUIStore.getState();
    const stillOpen = ui.activeTabId === tabId && ui.activeView.type === scope && ui.activeView.id === id;
    if (leftView || !stillOpen) {
      ui.endEditInTab(tabId, id);
      return EDIT_ENDED;
    }
    return restored;
  }, [cancelAutoSave, scope]);

  /**
   * Does the running editing session carry changes (`editIsDirty`)? That is
   * what the guard asks when the page is left (`leaveGuardStore`).
   */
  const isDirty = useCallback((isNew: boolean): boolean => {
    const id = idRef.current;
    if (!id) return false;
    return editIsDirty(readStoredRef.current(id), baselines.get(baselineKey(scope, id)), isNew, timer.current !== null);
  }, [scope]);

  useEffect(() => {
    const prev = prevRef.current;
    if (prev?.isEditing && !editorSavesSuspended()) {
      // If Cancel is discarding the entry right now, only the write is
      // skipped: timer and `prevRef` are cleared anyway — otherwise a later
      // run would write the state of the NEXT entry under the old id.
      // The same if the entry no longer belongs to this view: after a type
      // change `changeEntryType` has saved beforehand, and the state here
      // still carries the chips with the old type.
      const discarded = isDiscarding(prev.id) || readStoredRef.current(prev.id) === null;
      if (prev.id !== entityId) {
        // Navigated away while editing: the id has already changed in this
        // render, but buildPatch still reads the state of the previous entry
        // (see the header comment).
        cancelAutoSave();
        if (!discarded) void updateRef.current(prev.id, buildPatchRef.current(contentRef.current)).catch(console.error);
        prevRef.current = null;
      } else if (!isEditing && timer.current !== null) {
        // Edit mode left without Done/Cancel — since the guard
        // (`leaveGuardStore`) only via paths that do not ask, e.g. when
        // a sigil lock takes the entry out of editing: the armed timer would
        // otherwise silently expire because of isEditing=false
        // and discard up to debounceMs of typing. Done/Cancel
        // defuse the timer beforehand — for those this is a no-op.
        cancelAutoSave();
        if (!discarded) void updateRef.current(prev.id, buildPatchRef.current(contentRef.current)).catch(console.error);
      }
    }
    if (ready && entityId) {
      prevRef.current = { id: entityId, isEditing };
    } else if (!entityId) {
      prevRef.current = null;
    }
  }, [entityId, isEditing, ready, cancelAutoSave]);

  // Save on unmount (closing the tab, module switch). After a deletion
  // (also: Cancel on a new entry) this save and the one on navigating away
  // above hit an entry in the trash — that it does not overwrite it is
  // down solely to the `if (!entry) return` in the stores' update functions.
  // Whoever removes that breaks this path.
  useEffect(() => {
    return () => {
      cancelAutoSave();
      const prev = prevRef.current;
      if (prev?.isEditing && !editorSavesSuspended() && !isDiscarding(prev.id) && readStoredRef.current(prev.id) !== null) {
        void updateRef.current(prev.id, buildPatchRef.current(contentRef.current)).catch(console.error);
      }
    };
  }, [cancelAutoSave]);

  /**
   * Write a deferred autosave immediately and wait for it — for actions
   * that read the store right afterwards (inserting a template).
   * A no-op without a pending save.
   */
  const flushAutoSave = useCallback(async () => {
    if (timer.current === null) return;
    cancelAutoSave();
    const id = idRef.current;
    if (!isEditingRef.current || !id || editorSavesSuspended()) return;
    await updateRef.current(id, buildPatchRef.current(contentRef.current));
  }, [cancelAutoSave]);

  return { triggerAutoSave, cancelAutoSave, flushAutoSave, restoreOnCancel, isDirty, contentRef, handleContentChange };
}
