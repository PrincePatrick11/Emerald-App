import { useEffect, useRef, useState } from 'react';
import type { DraftStore } from '../store/draftStore';
import { guardKey, useLeaveGuardStore } from '../store/leaveGuardStore';

interface Options<T extends { name: string }> {
  store: DraftStore<T>;
  /** Die Ansicht, der die Seite gehört — für den Wächter (`leaveGuardStore`). */
  viewType: 'blocks' | 'templates';
  id: string;
  /** Wie der Entwurf in der Frage beim Verlassen heißt. */
  label: (draft: T) => string;
  /** Der gespeicherte Stand, auf die Felder des Entwurfs gebracht. */
  saved: T;
  /** Speichert die geänderten Felder — genau die, sonst nichts. `base` ist der Stand beim Öffnen. */
  save: (id: string, patch: Partial<T>, base: T) => Promise<unknown>;
  /** Zurück zur Liste. */
  onClose: () => void;
  /**
   * Nur für eine gerade mit „Neu" angelegte Seite: was „Abbrechen" tut — sie
   * in den Papierkorb legen, wie einen neuen Eintrag (`useEntryEditor`).
   */
  onCancelNew?: () => void;
  logTag: string;
}

/** Getrimmt, wie die Stores den Namen speichern: ein Leerzeichen am Ende ist keine Änderung. */
function comparable<T extends { name: string }>(value: T, key: keyof T): string {
  return JSON.stringify(key === 'name' ? value.name.trim() : value[key]);
}

/**
 * Der Entwurf einer Seite, die erst mit „Fertig" speichert (eigene Blöcke,
 * Vorlagen): beim Öffnen aus dem Entwurfs-Store oder dem gespeicherten Stand,
 * bei jeder Änderung zurück in den Store — ein offener Tab behält seine Arbeit,
 * auch wenn die Ansicht unmountet. „Fertig" schreibt nur die Felder, die sich
 * gegenüber dem Stand beim Öffnen geändert haben, und bleibt bei einem Fehler
 * auf der Seite; „Abbrechen" verwirft. Beide führen zurück zur Liste.
 *
 * Wer die Seite mit einem Entwurf anders verlässt, wird gefragt
 * (`leaveGuardStore`) — wie bei einem Eintrag im Bearbeiten. Nur der Wechsel
 * in einen anderen Tab lässt den Entwurf liegen: dort geht die Arbeit weiter.
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
    // `changedKey` statt `changed`: dieselbe Liste ist bei jedem Render ein neues Array.
  }, [id, base, draft, dirty, changedKey, saveDraft, clearDraft]);

  const patch = (p: Partial<T>) => setDraft((d) => ({ ...d, ...p }));

  const leave = () => {
    clearDraft(id);
    onClose();
  };

  /**
   * „Abbrechen": verwirft den Entwurf — und eine neue, nie bestätigte Seite
   * gleich mit. Den Entwurf räumt dann das Löschen, erst wenn es geglückt ist.
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
      // Auf der Seite bleiben: der Entwurf ist nicht gespeichert.
      console.error(`[${logTag}] saving failed:`, err);
      setBusy(false);
      return;
    }
    leave();
  };

  // Der Wächter ruft immer die Handgriffe des letzten Renders. Die Probe für
  // Tabs im Hintergrund meldet der Store selbst an (`draftStore`).
  const latest = useRef({ draft, label, finish, leave });
  latest.current = { draft, label, finish, leave };
  useEffect(() => {
    const key = guardKey(viewType, id);
    // Ob es einen Entwurf gibt, sagt der Store: „Fertig", „Abbrechen" und
    // Löschen räumen ihn, bevor sie die Seite verlassen — und fragen damit nicht.
    const hasDraft = () => id in store.getState().drafts;
    useLeaveGuardStore.getState().setGuard({
      key,
      title: () => latest.current.label(latest.current.draft),
      isDirty: hasDraft,
      save: async () => {
        await latest.current.finish();
        // `finish` bleibt bei einem Fehler auf der Seite — dann auch hier bleiben.
        if (hasDraft()) throw new Error('draft could not be saved');
      },
      discard: () => latest.current.leave(),
    });
    return () => useLeaveGuardStore.getState().clearGuard(key);
  }, [viewType, id, store]);

  return { draft, setDraft, patch, dirty, busy, setBusy, finish, leave, cancel };
}
