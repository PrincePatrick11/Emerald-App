import { useCallback, useEffect, useRef } from 'react';
import { editorSavesSuspended } from '../lib/editorLock';
import { entryTypeForView, type ViewId } from '../lib/modules';
import { revertEntryType } from '../lib/entryTypeChange';
import { serialKey, settled } from '../lib/serialize';
import {
  baselineKey, baselineOf, baselines, beginDiscard, editIsDirty, endDiscard, isDiscarding, type BaselineFields,
} from '../store/entryEdit';
import { useUIStore, withEditLock } from '../store/uiStore';
import type { WriteOptions } from '../lib/stamp';

/**
 * Was `restoreOnCancel` statt eines Stands meldet, wenn die View nicht mehr
 * diesen Eintrag zeigt und das Bearbeiten schon beendet ist: Cancel hat einen
 * Typwechsel zurückgenommen, man ist während des Zurückschreibens in einen
 * anderen Tab gegangen, oder ein Cancel davor war schneller. Die View darf
 * dann nichts mehr tun — ihr eigenes `setActiveView(…)` zeigte auf ein Paar
 * aus Typ und id, das es nicht mehr gibt, oder führte den FALSCHEN Tab
 * dorthin, und ihr lokaler State gehört schon dem nächsten Eintrag.
 */
export const EDIT_ENDED = 'edit-ended';

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
interface UseEntryEditorOptions<TPatch extends BaselineFields, TRestore extends BaselineFields = TPatch> {
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
      if (!isEditingRef.current || !id || editorSavesSuspended() || isDiscarding(id)) return;
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
    const running = baselines.get(key);
    if (running) {
      // Die Bearbeitung läuft schon. Den gespeicherten Stand liest ab jetzt
      // diese View: nach einem Typwechsel kam der Stand aus einer anderen
      // Ansicht mit, und deren Leser fände den Eintrag nicht mehr.
      running.stored = () => readStoredRef.current(entityId);
      return;
    }
    // Eine neue Bearbeitung: ein Cancel davor ist vorbei, auch eines, das den
    // Typ zurücknahm. Nicht oben — die View, die zwischen einem Typwechsel und
    // seiner Rücknahme montiert, findet einen Stand vor und soll nichts speichern.
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
   * Der Cancel-Pfad: entschärft den Timer und schreibt den Einstiegs-Stand des
   * Eintrags zurück in Store und DB, „Zuletzt geändert" eingeschlossen — ob
   * überhaupt geschrieben werden muss, entscheidet der Store (`needsWrite`). Gibt die
   * Baseline zurück, damit die View ihren lokalen State daraus setzt; null,
   * wenn es nichts zurückzugeben gibt (kein Eintrag offen, der Schreibzugriff
   * oder die Rücknahme gescheitert) — dann fällt die View auf den Store-Stand
   * zurück und verlässt den Edit-Modus trotzdem.
   *
   * Hat der Eintrag in dieser Bearbeitung den Typ gewechselt, geht er mit dem
   * Einstiegs-Stand zurück in sein Modul (`revertEntryType`). Zeigt die offene
   * Seite am Ende nicht mehr diesen Eintrag in dieser Ansicht, ist das
   * Ergebnis `EDIT_ENDED` (siehe dort).
   *
   * Solange es schreibt, ist die Bearbeitung gesperrt (`withEditLock`) und
   * keine View speichert mehr für diesen Eintrag (`isDiscarding`).
   */
  const restoreOnCancel = useCallback(async (): Promise<TRestore | typeof EDIT_ENDED | null> => {
    cancelAutoSave();
    const id = idRef.current;
    if (!id) return null;
    const tabId = useUIStore.getState().activeTabId;
    beginDiscard(id);
    type Outcome = { restored: TRestore | null; reverted: boolean };
    const { restored, reverted } = await withEditLock(async (): Promise<Outcome> => {
      // Ein Typwechsel, der noch schreibt, gehört schon zur Bearbeitung: erst
      // hinter ihm steht fest, unter welcher Ansicht ihr Ausgangsstand liegt.
      await settled(serialKey('entry', id));
      const baseline = baselineOf(id);
      // Nur Journal, Wiki und Operationen wechseln den Typ — `type` gibt es dann immer.
      const type = baseline && entryTypeForView(baseline.scope);
      if (baseline?.origin && type) {
        return { restored: null, reverted: await revertEntryType(id, type, baseline.origin, baseline.patch, baseline.stamp) };
      }
      if (baseline) {
        await updateRef.current(id, baseline.patch as TRestore, { touch: baseline.stamp ?? true });
        return { restored: baseline.patch as TRestore, reverted: false };
      }
      // Kein Stand mehr: ein Cancel davor hat die Bearbeitung schon beendet.
      // Was gespeichert ist, ist dann der wiederhergestellte Eintrag — nicht
      // das, was die View beim Klick noch vor sich hatte.
      return { restored: readStoredRef.current(id), reverted: false };
    }).catch((e: unknown): Outcome => {
      console.error('[useEntryEditor] restore on cancel failed:', e);
      return { restored: null, reverted: false };
    });
    // Ein Tastendruck während des Awaits hätte den Timer neu scharf gemacht.
    cancelAutoSave();

    // Der Eintrag gehört dieser Ansicht nicht mehr: zurückgenommen (auch von
    // einem Cancel davor) oder gelöscht. Dann werden Views erst noch abgebaut —
    // die Marke bleibt, bis die nächste Bearbeitung sie aufhebt.
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
   * Trägt die laufende Bearbeitung Änderungen (`editIsDirty`)? Danach fragt
   * der Wächter beim Verlassen der Seite (`leaveGuardStore`).
   */
  const isDirty = useCallback((isNew: boolean): boolean => {
    const id = idRef.current;
    if (!id) return false;
    return editIsDirty(readStoredRef.current(id), baselines.get(baselineKey(scope, id)), isNew, timer.current !== null);
  }, [scope]);

  useEffect(() => {
    const prev = prevRef.current;
    if (prev?.isEditing && !editorSavesSuspended()) {
      // Verwirft Cancel den Eintrag gerade, entfällt nur das Schreiben: Timer
      // und `prevRef` werden trotzdem geräumt — sonst schriebe ein späterer
      // Durchlauf den State des NÄCHSTEN Eintrags unter der alten id.
      // Ebenso, wenn der Eintrag nicht mehr dieser Ansicht gehört: nach einem
      // Typwechsel hat `changeEntryType` vorher gespeichert, und der State
      // hier trägt noch die Chips mit dem alten Typ.
      const discarded = isDiscarding(prev.id) || readStoredRef.current(prev.id) === null;
      if (prev.id !== entityId) {
        // Wegnavigiert waehrend des Editierens: die id hat in diesem Render
        // bereits gewechselt, buildPatch liest aber noch den State des
        // vorherigen Eintrags (siehe Kopfkommentar).
        cancelAutoSave();
        if (!discarded) void updateRef.current(prev.id, buildPatchRef.current(contentRef.current)).catch(console.error);
        prevRef.current = null;
      } else if (!isEditing && timer.current !== null) {
        // Edit-Modus verlassen ohne Done/Cancel — seit dem Waechter
        // (`leaveGuardStore`) nur noch auf Wegen, die nicht fragen, etwa wenn
        // eine Sigillen-Sperre den Eintrag aus dem Bearbeiten nimmt: der
        // scharfe Timer wuerde sonst wegen isEditing=false wortlos verfallen
        // und bis zu debounceMs an Tipparbeit verwerfen. Done/Cancel
        // entschaerfen den Timer vorher — fuer die ist das hier ein No-op.
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

  // Speichern beim Unmount (Tab schliessen, Modulwechsel). Nach einem Löschen
  // (auch: Cancel auf einem neuen Eintrag) trifft dieser Save und der beim
  // Wegnavigieren oben einen Eintrag im Papierkorb — dass er ihn nicht
  // überschreibt, liegt allein am `if (!entry) return` der update-Funktionen
  // in den Stores. Wer den entfernt, bricht diesen Pfad.
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
