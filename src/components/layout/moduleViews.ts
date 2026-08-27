/**
 * Komponenten-Schicht der Modul-Registry: View-Typ → lazy geladene View.
 *
 * Import-Regel: diese Datei darf NUR von MainArea importiert werden. Jeder
 * weitere Importeur riskiert, die lazy-Chunks in sein eigenes Bundle zu ziehen
 * — Metadaten (Icon, Label) kommen aus `lib/modules.ts`, nicht von hier.
 *
 * Jede View als eigener Chunk: TipTap haengt an Journal/Wiki/Operations und
 * wuerde sonst bei jedem Start mitgeladen, auch wenn nur Home offen ist.
 */
import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import type { ViewId } from '../../lib/modules';

export const VIEW_COMPONENTS: Record<ViewId, LazyExoticComponent<ComponentType>> = {
  home: lazy(() => import('../views/HomeView')),
  journal: lazy(() => import('../views/JournalView')),
  wiki: lazy(() => import('../views/WikiView')),
  tags: lazy(() => import('../views/TagsView')),
  trash: lazy(() => import('../views/TrashView')),
  altar: lazy(() => import('../views/AltarView')),
  operations: lazy(() => import('../views/OperationsView')),
  tasks: lazy(() => import('../views/TasksView')),
};
