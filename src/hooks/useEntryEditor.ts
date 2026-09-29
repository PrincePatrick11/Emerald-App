import { useCallback, useEffect, useRef } from 'react';
import { editorSavesSuspended } from '../lib/editorLock';
import type { ViewId } from '../lib/modules';
import { isInEdit, useUIStore } from '../store/uiStore';
import { guardKey, registerEditProbe } from '../store/leaveGuardStore';
import type { WriteOptions } from '../lib/stamp';

/**
 * Die Ausgangsstände der laufenden Bearbeitungen, je Ansicht und Eintrag — wie
 * der Eintrag aussah, als „Bearbeiten" gedrückt wurde. Außerhalb der
 * Komponente, weil eine Bearbeitung ihre View überlebt: wer mittendrin in
 * einen anderen Tab schaut, kommt in dieselbe Bearbeitung zurück, und Cancel
 * geht dann bis zu ihrem Anfang, nicht nur bis zum Tabwechsel.
 *
 * Ein Stand lebt, solange irgendein Tab den Eintrag im Bearbeiten zeigt.
 * „Fertig", Cancel, Löschen, das Schließen des Tabs und ein Wechsel der Seite
 * im selben Tab beenden die Bearbeitung — das liest der Abgleich unten am
 * `uiStore` ab, keine View muss es melden. Nur im Speicher: ein Neustart
 * beginnt mit dem, was gespeichert ist.
 */
const baselines = new Map<string, {
  scope: ViewId;
  id: string;
  patch: unknown;
  /** „Zuletzt geändert" beim Betreten — Cancel stellt ihn mit dem Rest wieder her. */
  stamp: string | undefined;
  /** Der gespeicherte Stand, in der Form von `patch` — `null`, wenn es den Eintrag nicht mehr gibt. */
  stored: () => unknown;
}>();

const baselineKey = guardKey;

/**
 * Trägt eine Bearbeitung Änderungen? Die eine Regel für den Wächter der
 * offenen Seite und die Probe im Hintergrund: ein gelöschter Eintrag
 * (`stored === null`) hat nichts mehr zu sichern, ein neuer, nie bestätigter
 * oder einer mit ausstehendem Autosave immer; sonst zählt, ob der gespeicherte
 * Stand vom Ausgangsstand abweicht.
 */
function editIsDirty(stored: unknown, patch: unknown, isNew: boolean, pending = false): boolean {
  if (stored === null) return false;
  if (isNew || pending) return true;
  return patch !== undefined && JSON.stringify(stored) !== JSON.stringify(patch);
}

useUIStore.subscribe((s) => {
  for (const [key, { scope, id }] of baselines) {
    if (!isInEdit(s, scope, id)) baselines.delete(key);
  }
});

// Für Tabs im Hintergrund: trägt die Bearbeitung dort Änderungen? Beim
// Wegschalten hat der Editor gespeichert, der gespeicherte Stand sagt also alles.
registerEditProbe((view) => {
  if (view.mode !== 'edit' || !view.id) return false;
  const baseline = baselines.get(baselineKey(view.type, view.id));
  return !!baseline && editIsDirty(baseline.stored(), baseline.patch, !!view.isNew);
});

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
interface UseEntryEditorOptions<TPatch, TRestore = TPatch> {
  /** Die Ansicht, der die Einträge gehören — unterscheidet die Ausgangsstände (`baselines`). */
  scope: ViewId;
  entityId: string | undefined;
  isEditing: boolean;
  ready: boolean;
  /** Erhält den aktuellen Editor-Inhalt (den Content-Mirror-Ref des Hooks) als Argument. */
  buildPatch: (content: string) => TPatch;
  /**
   * Was Cancel zurücksetzt — der ganze Eintrag, wie er beim Betreten des
   * Bearbeitens war: Titel und Inhalt, dazu alles, was die Seitenleiste
   * während des Bearbeitens direkt speichert (Tags, Kategorie, Icon,
   * Titelbild). Mehr als `buildPatch`, weil der Autosave diese Felder nicht
   * anfasst. Default: buildPatch.
   */
  buildRestorePatch?: (content: string) => TRestore;
  /**
   * Der gespeicherte Stand des Eintrags, in der Form von `buildRestorePatch` —
   * woran Cancel und der Wächter messen, ob sich etwas geändert hat. Nicht der
   * lokale Stand: getippt, vom Autosave geschrieben, zurückgetippt und gleich
   * abgebrochen sähe der aus wie unverändert. `null`, wenn es den Eintrag nicht
   * mehr gibt. Darf nur aus Stores lesen — die Probe für Tabs im Hintergrund
   * ruft es auch, wenn die View nicht mehr montiert ist.
   */
  readStored: (id: string) => TRestore | null;
  /** „Zuletzt geändert" des gespeicherten Eintrags — Cancel stellt den Stand vom Betreten wieder her. */
  readStamp: (id: string) => string | undefined;
  update: (id: string, patch: TPatch | TRestore, options?: WriteOptions) => Promise<void>;
  debounceMs?: number;
}

export function useEntryEditor<TPatch, TRestore = TPatch>({
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

  // Der Editor-Inhalt wird pro Tastendruck in diesen Ref gespiegelt statt in
  // State — ein State-Update haette die komplette View pro Anschlag neu
  // gerendert. Gelesen wird er erst beim Speichern (als buildPatch-Argument).
  // Die View setzt ihn beim Laden und bei Cancel auf den gespeicherten Stand.
  const contentRef = useRef('');

  // `timer.current === null` heisst "kein Save ausstehend" — Done und Cancel
  // rufen cancelAutoSave() und machen den Flush unten damit zum No-op; ein
  // blosses Zuruecklassen der toten Handle wuerde diese Frage unbeantwortbar
  // machen.
  const cancelAutoSave = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const triggerAutoSave = useCallback(() => {
    // Außerhalb des Bearbeitens gibt es nichts aufzuschieben: der Blockstapel
    // meldet auch Lesemodus-Änderungen (Checkliste abhaken) über
    // handleContentChange, damit der Content-Mirror sie kennt — gespeichert hat
    // er sie dann schon selbst.
    if (!isEditingRef.current) return;
    if (timer.current) clearTimeout(timer.current);
    const id = idRef.current;
    timer.current = setTimeout(() => {
      timer.current = null;
      if (!isEditingRef.current || !id || editorSavesSuspended()) return;
      // Fire-and-forget: waehrend `withDbClosed` laeuft (Vault-Dateien werden
      // geloescht) lehnt `getDb()` ab, und die Aenderung gehoert ohnehin zu
      // dem Vault, der gerade verschwindet.
      void updateRef.current(id, buildPatchRef.current(contentRef.current)).catch(() => {});
    }, debounceMs);
  }, [debounceMs]);

  const handleContentChange = useCallback((html: string) => {
    contentRef.current = html;
    triggerAutoSave();
  }, [triggerAutoSave]);

  // Der Stand des Eintrags beim Betreten des Edit-Modus. Cancel kann sich nicht auf
  // den Store verlassen — nach dem ersten Debounce-Autosave IST der Store
  // bereits der editierte Stand, ein "Zurücksetzen" darauf wäre ein No-op.
  // Beim Einstieg spiegelt der lokale State noch exakt das Gespeicherte, der
  // Restore-Patch liefert hier also die Vorher-Werte. Das `ready`-Gate hält
  // die Erfassung zurück, bis die View ihren State aus dem Eintrag geladen
  // hat — die Hook-Effekte laufen vor den Load-Effekten der View. Gibt es
  // schon einen Stand, läuft die Bearbeitung noch (siehe `baselines`): er bleibt.
  const restoreFields = (content: string): TRestore =>
    (buildRestorePatchRef.current ?? (buildPatchRef.current as unknown as (c: string) => TRestore))(content);
  useEffect(() => {
    if (!isEditing || !ready || !entityId) return;
    const key = baselineKey(scope, entityId);
    if (baselines.has(key)) return;
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
   * Der Cancel-Pfad: entschärft den Timer und schreibt den Einstiegs-Stand des
   * Eintrags zurück in Store und DB, „Zuletzt geändert" eingeschlossen — ob
   * überhaupt geschrieben werden muss, entscheidet der Store (`needsWrite`). Gibt die
   * Baseline zurück, damit die View ihren lokalen State daraus setzt; null nur,
   * wenn es keine Baseline gab oder der Schreibzugriff scheiterte — dann fällt
   * die View auf den Store-Stand zurück und verlässt den Edit-Modus trotzdem.
   */
  const restoreOnCancel = useCallback(async (): Promise<TRestore | null> => {
    cancelAutoSave();
    const id = idRef.current;
    const baseline = id
      ? baselines.get(baselineKey(scope, id)) as { id: string; patch: TRestore; stamp: string | undefined } | undefined
      : undefined;
    if (!baseline) return null;
    try {
      await updateRef.current(baseline.id, baseline.patch, { touch: baseline.stamp ?? true });
    } catch (e) {
      console.error('[useEntryEditor] restore on cancel failed:', e);
      return null;
    }
    // Ein Tastendruck während des Awaits hätte den Timer neu scharf gemacht.
    cancelAutoSave();
    return baseline.patch;
  }, [cancelAutoSave, scope]);

  /**
   * Trägt die laufende Bearbeitung Änderungen (`editIsDirty`)? Danach fragt
   * der Wächter beim Verlassen der Seite (`leaveGuardStore`).
   */
  const isDirty = useCallback((isNew: boolean): boolean => {
    const id = idRef.current;
    if (!id) return false;
    return editIsDirty(readStoredRef.current(id), baselines.get(baselineKey(scope, id))?.patch, isNew, timer.current !== null);
  }, [scope]);

  const prevRef = useRef<{ id: string; isEditing: boolean } | null>(null);

  useEffect(() => {
    const prev = prevRef.current;
    if (prev?.isEditing && !editorSavesSuspended()) {
      if (prev.id !== entityId) {
        // Wegnavigiert waehrend des Editierens: die id hat in diesem Render
        // bereits gewechselt, buildPatch liest aber noch den State des
        // vorherigen Eintrags (siehe Kopfkommentar).
        cancelAutoSave();
        void updateRef.current(prev.id, buildPatchRef.current(contentRef.current)).catch(console.error);
        prevRef.current = null;
      } else if (!isEditing && timer.current !== null) {
        // Edit-Modus verlassen ohne Done/Cancel — seit dem Waechter
        // (`leaveGuardStore`) nur noch auf Wegen, die nicht fragen, etwa wenn
        // eine Sigillen-Sperre den Eintrag aus dem Bearbeiten nimmt: der
        // scharfe Timer wuerde sonst wegen isEditing=false wortlos verfallen
        // und bis zu debounceMs an Tipparbeit verwerfen. Done/Cancel
        // entschaerfen den Timer vorher — fuer die ist das hier ein No-op.
        cancelAutoSave();
        void updateRef.current(prev.id, buildPatchRef.current(contentRef.current)).catch(console.error);
      }
    }
    if (ready && entityId) {
      prevRef.current = { id: entityId, isEditing };
    } else if (!entityId) {
      prevRef.current = null;
    }
  }, [entityId, isEditing, ready, cancelAutoSave]);

  // Speichern beim Unmount (Tab schliessen, Modulwechsel). Nach einem Löschen
  // (auch: Cancel auf einem neuen Eintrag) trifft dieser Save und der beim
  // Wegnavigieren oben einen Eintrag im Papierkorb — dass er ihn nicht
  // überschreibt, liegt allein am `if (!entry) return` der update-Funktionen
  // in den Stores. Wer den entfernt, bricht diesen Pfad.
  useEffect(() => {
    return () => {
      cancelAutoSave();
      const prev = prevRef.current;
      if (prev?.isEditing && !editorSavesSuspended()) {
        void updateRef.current(prev.id, buildPatchRef.current(contentRef.current)).catch(console.error);
      }
    };
  }, [cancelAutoSave]);

  /**
   * Einen aufgeschobenen Autosave sofort schreiben und darauf warten — für
   * Aktionen, die gleich danach den Store lesen (eine Vorlage einsetzen).
   * Ohne ausstehenden Save ein No-op.
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
