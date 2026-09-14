import { useEffect, useState } from 'react';
import type { DraftStore } from '../store/draftStore';

interface Options<T extends { name: string }> {
  store: DraftStore<T>;
  id: string;
  /** Der gespeicherte Stand, auf die Felder des Entwurfs gebracht. */
  saved: T;
  /** Speichert die geänderten Felder — genau die, sonst nichts. `base` ist der Stand beim Öffnen. */
  save: (id: string, patch: Partial<T>, base: T) => Promise<unknown>;
  /** Zurück zur Liste. */
  onClose: () => void;
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
 */
export function useDraftPage<T extends { name: string }>({ store, id, saved, save, onClose, logTag }: Options<T>) {
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

  return { draft, setDraft, patch, dirty, busy, setBusy, finish, leave };
}
