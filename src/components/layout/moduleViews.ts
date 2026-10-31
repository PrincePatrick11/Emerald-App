/**
 * Component layer of the module registry: view type → lazily loaded view.
 *
 * Import rule: this file may ONLY be imported by MainArea. Any
 * further importer risks pulling the lazy chunks into its own bundle
 * — metadata (icon, label) comes from `lib/modules.ts`, not from here.
 *
 * Each view as a chunk of its own: TipTap hangs on Journal/Wiki/Operations and
 * would otherwise be loaded on every start, even when only Home is open.
 */
import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import type { ViewId } from '../../lib/modules';

export const VIEW_COMPONENTS: Record<ViewId, LazyExoticComponent<ComponentType>> = {
  home: lazy(() => import('../views/HomeView')),
  journal: lazy(() => import('../views/JournalView')),
  wiki: lazy(() => import('../views/WikiView')),
  tags: lazy(() => import('../views/TagsView')),
  categories: lazy(() => import('../views/CategoriesView')),
  trash: lazy(() => import('../views/TrashView')),
  blocks: lazy(() => import('../views/BlocksView')),
  templates: lazy(() => import('../views/TemplatesView')),
  lexicon: lazy(() => import('../views/LexiconView')),
  altar: lazy(() => import('../views/AltarView')),
  operations: lazy(() => import('../views/OperationsView')),
  tasks: lazy(() => import('../views/TasksView')),
};
