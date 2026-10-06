import { create } from 'zustand';
import type { ActiveView } from '../types';

/**
 * Eine Bearbeitung endet nur mit „Fertig" oder „Abbrechen". Wer sie mit
 * Änderungen anders verlässt — im selben Tab woanders hin, Tab zu, Vault
 * wechseln, Fenster schließen —, wird gefragt: speichern, verwerfen oder
 * weiter bearbeiten. Der Wechsel in einen anderen Tab fragt nicht, dort läuft
 * die Bearbeitung weiter.
 *
 * Die Seite, die gerade bearbeitet wird, meldet hier ihren Wächter an
 * (`useEditActions`, `useDraftPage`). Wer die Seite verlassen will, fragt über
 * `confirmLeave()`; das Modal (`LeaveGuardModal`) beantwortet die Frage.
 *
 * Import-Regel: dieser Store importiert keinen anderen — die anderen lesen
 * ihn, nicht umgekehrt.
 */
export interface EditGuard {
  /** Die Seite, der der Wächter gehört: `guardKey(View-Typ, id)`. */
  key: string;
  /** Der Name dessen, was bearbeitet wird — steht im Modal. */
  title: () => string;
  /** Wurde seit dem Betreten etwas geändert, oder ist der Eintrag neu und nie bestätigt? */
  isDirty: () => boolean;
  /** Wie „Fertig". */
  save: () => void | Promise<void>;
  /** Wie „Abbrechen". */
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
  /** Zählt die Antworten „Weiter bearbeiten" — woran Fenster über der Seite merken, dass sie weichen sollen (`useCloseOnKeepEditing`). */
  stays: number;
  setGuard: (guard: EditGuard) => void;
  /** Räumt nur, wenn der Wächter noch dieser Seite gehört — die nächste darf schon übernommen haben. */
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
 * Die Seiten, auf denen gerade „Fertig", „Abbrechen" oder „Löschen" läuft —
 * je Seite, nicht für alle: ein „Fertig", das noch schreibt, darf die Frage
 * nach einer anderen Seite nicht mit unterdrücken.
 */
const ending = new Map<string, number>();

/**
 * Führt das Ende der Bearbeitung von `key` aus, ohne dass die Navigation darin
 * nachfragt: „Fertig", „Abbrechen" und „Löschen" wechseln selbst die Seite.
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
 * Läuft auf der Seite `key` gerade „Fertig", „Abbrechen" oder „Löschen"? Wer
 * sie dabei unter sich wegzöge — ein Typwechsel —, wartet das ab: ihr Schritt
 * zurück in die Liste oder ins Lesen fiele sonst in dessen Sperre
 * (`uiStore.editLocked`) und entfiele, oder träfe danach ein Paar aus Typ und
 * id, das es nicht mehr gibt.
 */
export const isEnding = (key: string): boolean => ending.has(key);

/** Müsste vor dem Verlassen der offenen Seite gefragt werden? */
export function leaveNeedsConfirm(): boolean {
  const guard = useLeaveGuardStore.getState().guard;
  if (!guard || ending.has(guard.key)) return false;
  try {
    return guard.isDirty();
  } catch (e) {
    // Ein Wächter, der nicht antworten kann, hält niemanden fest.
    console.error('[leaveGuard] asking the page failed:', e);
    return false;
  }
}

/**
 * Fragt, wenn die offene Seite ungesicherte Änderungen trägt, und führt die
 * Antwort aus. `true`: die Seite darf verlassen werden. `false`: weiter
 * bearbeiten — oder das Speichern ist gescheitert, dann bleibt man auch.
 */
export async function confirmLeave(): Promise<boolean> {
  if (!leaveNeedsConfirm()) return true;
  const { guard, question } = useLeaveGuardStore.getState();
  // Eine Frage steht schon: die zweite Navigation wartet nicht daneben, sie entfällt.
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
 * Wartet, bis die Seite `key` ihren Wächter angemeldet hat — nach einem
 * Tabwechsel montiert die Ansicht erst, und ihr Code wird vielleicht erst
 * geladen. `false`, wenn sie es in der Zeit nicht tut.
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
 * Trägt eine Seite, die gerade nicht offen ist, ungesicherte Änderungen? Wer
 * Bearbeitungen außerhalb der Ansicht aufbewahrt, meldet hier eine Probe an
 * (`draftStore`: es gibt einen Entwurf; `entryEdit`: der gespeicherte
 * Stand weicht vom Ausgangsstand ab). So muss ein Tab im Hintergrund nicht
 * erst geöffnet werden, nur um festzustellen, dass es nichts zu fragen gibt.
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
