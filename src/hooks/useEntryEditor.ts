import { useCallback, useEffect, useRef } from 'react';
import { editorSavesSuspended } from '../lib/editorLock';

/**
 * Debounce-Autosave, Speichern beim Wegnavigieren und Speichern beim Unmount —
 * der Editor-Lebenszyklus, den JournalView, WikiView und OperationsView
 * vorher jeweils als eigene ~80-Zeilen-Kopie hielten, mit leise driftenden
 * Details.
 *
 * `buildPatch` wird erst im Moment des Speicherns aufgerufen und liest dort
 * den aktuellen lokalen State der View plus den Content-Mirror-Ref des
 * Editors. Der Hook haelt pro Render die neueste Closure in einem Ref; das
 * Speichern beim Wegnavigieren sieht damit noch die Werte des VORHERIGEN
 * Eintrags, weil die Load-Effekte der Views erst nach den Effekten dieses
 * Hooks laufen (Hook-Aufruf steht im Komponentenkoerper vor ihnen).
 *
 * `ready` bewaffnet die Nav-/Unmount-Saves erst, wenn die View ihren lokalen
 * State aus dem Eintrag geladen hat (`loadedEntryId === entry.id`). Ohne das
 * Gate schriebe ein Mount direkt im Edit-Modus (StrictMode-Doppelmount, per
 * localStorage restaurierter Edit-Tab) den noch leeren Titel in die DB.
 */
interface UseEntryEditorOptions<TPatch> {
  entityId: string | undefined;
  isEditing: boolean;
  ready: boolean;
  buildPatch: () => TPatch;
  update: (id: string, patch: TPatch) => Promise<void>;
  debounceMs?: number;
}

export function useEntryEditor<TPatch>({
  entityId,
  isEditing,
  ready,
  buildPatch,
  update,
  debounceMs = 1500,
}: UseEntryEditorOptions<TPatch>) {
  const buildPatchRef = useRef(buildPatch);
  buildPatchRef.current = buildPatch;
  const updateRef = useRef(update);
  updateRef.current = update;
  const isEditingRef = useRef(isEditing);
  isEditingRef.current = isEditing;
  const idRef = useRef(entityId);
  idRef.current = entityId;

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // `timer.current === null` heisst "kein Save ausstehend" — Done und Cancel
  // rufen cancelAutoSave() und machen den Flush unten damit zum No-op; ein
  // blosses Zuruecklassen der toten Handle wuerde diese Frage unbeantwortbar
  // machen.
  const cancelAutoSave = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const triggerAutoSave = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    const id = idRef.current;
    timer.current = setTimeout(() => {
      timer.current = null;
      if (!isEditingRef.current || !id || editorSavesSuspended()) return;
      // Fire-and-forget: waehrend `withDbClosed` laeuft (Vault-Dateien werden
      // geloescht) lehnt `getDb()` ab, und die Aenderung gehoert ohnehin zu
      // dem Vault, der gerade verschwindet.
      void updateRef.current(id, buildPatchRef.current()).catch(() => {});
    }, debounceMs);
  }, [debounceMs]);

  const prevRef = useRef<{ id: string; isEditing: boolean } | null>(null);

  useEffect(() => {
    const prev = prevRef.current;
    if (prev?.isEditing && !editorSavesSuspended()) {
      if (prev.id !== entityId) {
        // Wegnavigiert waehrend des Editierens: die id hat in diesem Render
        // bereits gewechselt, buildPatch liest aber noch den State des
        // vorherigen Eintrags (siehe Kopfkommentar).
        cancelAutoSave();
        void updateRef.current(prev.id, buildPatchRef.current()).catch(console.error);
        prevRef.current = null;
      } else if (!isEditing && timer.current !== null) {
        // Edit-Modus verlassen ohne Done/Cancel (Klick auf denselben Eintrag
        // in der Liste, Back-Navigation): der scharfe Timer wuerde sonst
        // wegen isEditing=false wortlos verfallen und bis zu debounceMs an
        // Tipparbeit verwerfen. Done/Cancel entschaerfen den Timer vorher —
        // fuer die ist das hier ein No-op.
        cancelAutoSave();
        void updateRef.current(prev.id, buildPatchRef.current()).catch(console.error);
      }
    }
    if (ready && entityId) {
      prevRef.current = { id: entityId, isEditing };
    } else if (!entityId) {
      prevRef.current = null;
    }
  }, [entityId, isEditing, ready, cancelAutoSave]);

  // Speichern beim Unmount (Tab schliessen, Modulwechsel).
  useEffect(() => {
    return () => {
      cancelAutoSave();
      const prev = prevRef.current;
      if (prev?.isEditing && !editorSavesSuspended()) {
        void updateRef.current(prev.id, buildPatchRef.current()).catch(console.error);
      }
    };
  }, [cancelAutoSave]);

  return { triggerAutoSave, cancelAutoSave };
}
