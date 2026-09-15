import type { ActiveView } from '../types';
import { ENTRY_MODULE_IDS, isLibraryView, isViewId } from './modules';

/** Der Zurück/Vor-Verlauf eines Tabs: die besuchten Seiten und die Stelle, an der man steht. */
export interface NavHistory {
  views: ActiveView[];
  index: number;
}

export interface OpenTab {
  id: string;
  view: ActiveView;
  /** Jeder Tab hat seinen eigenen Verlauf — Zurück und Vor bleiben im Tab. */
  history: NavHistory;
}

/** Obergrenze je Verlauf: er wird mit den Tabs in localStorage gespeichert. */
export const MAX_HISTORY_LENGTH = 50;

export function createTabId(): string {
  return crypto.randomUUID();
}

/**
 * isNew nicht in den Verlauf: käme man per Zurück (oder nach einem Neustart)
 * auf die frische Edit-View zurück, würde Cancel einen längst autogespeicherten
 * Eintrag endgültig löschen.
 */
export function stripSessionFlags(view: ActiveView): ActiveView {
  const { isNew: _isNew, ...rest } = view;
  return rest;
}

export function freshHistory(view: ActiveView): NavHistory {
  return { views: [stripSessionFlags(view)], index: 0 };
}

/**
 * Hängt eine Seite hinter die aktuelle Stelle und kappt, was vor ihr lag.
 * Dieselbe Seite (gleicher Typ, gleiche id) — etwa der Wechsel in den
 * Bearbeiten-Modus — ist kein neuer Schritt; der Verlauf bleibt unverändert.
 */
export function pushHistory(history: NavHistory, view: ActiveView): NavHistory {
  const current = history.views[history.index];
  if (current && current.type === view.type && current.id === view.id) return history;
  const views = [...history.views.slice(0, history.index + 1), stripSessionFlags(view)]
    .slice(-MAX_HISTORY_LENGTH);
  return { views, index: views.length - 1 };
}

/**
 * Stellt einen gespeicherten Verlauf wieder her. Tabs aus Versionen ohne
 * eigenen Verlauf, veraltete View-Typen und ein Index außerhalb der Liste
 * fallen auf einen Verlauf zurück, der mit der aktuellen Seite des Tabs endet.
 */
export function normalizeSavedHistory(raw: unknown, view: ActiveView): NavHistory {
  const candidate = raw as Partial<NavHistory> | null | undefined;
  if (!candidate || !Array.isArray(candidate.views) || typeof candidate.index !== 'number') {
    return freshHistory(view);
  }
  const views = (candidate.views as unknown[])
    .filter((v): v is ActiveView => !!v && typeof v === 'object' && isViewId((v as ActiveView).type))
    .map(stripSessionFlags);
  // Beim Filtern können Einträge vor dem Index wegfallen — dann stimmt er
  // nicht mehr, und der Verlauf wäre ein Rätsel. Lieber frisch anfangen.
  if (views.length !== candidate.views.length || candidate.index < 0 || candidate.index >= views.length) {
    return freshHistory(view);
  }
  return pushHistory({ views, index: Math.floor(candidate.index) }, view);
}

/**
 * Eine Detailseite, die ohne offenen Tab einen eigenen bekommt: ein Eintrag
 * oder die Seite eines eigenen Blocks oder einer Vorlage. Tiefenlinks in Tags
 * und Kategorien tragen auch eine id, sind aber nur ein Sprung in die Liste.
 */
export function isContentView(view: ActiveView): boolean {
  if (!view.id) return false;
  return isLibraryView(view.type) || (ENTRY_MODULE_IDS as readonly string[]).includes(view.type);
}
