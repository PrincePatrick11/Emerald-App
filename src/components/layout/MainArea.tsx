import { Suspense, lazy } from 'react';
import { useUIStore } from '../../store/uiStore';

// Jede View als eigener Chunk: TipTap haengt an Journal/Wiki/Operations und
// wuerde sonst bei jedem Start mitgeladen, auch wenn nur Home offen ist.
const HomeView = lazy(() => import('../views/HomeView'));
const JournalView = lazy(() => import('../views/JournalView'));
const WikiView = lazy(() => import('../views/WikiView'));
const TagsView = lazy(() => import('../views/TagsView'));
const TrashView = lazy(() => import('../views/TrashView'));
const AltarView = lazy(() => import('../views/AltarView'));
const OperationsView = lazy(() => import('../views/OperationsView'));
const TasksView = lazy(() => import('../views/TasksView'));

function viewFor(type: string) {
  switch (type) {
    case 'journal':
      return <JournalView />;
    case 'wiki':
      return <WikiView />;
    case 'tags':
      return <TagsView />;
    case 'trash':
      return <TrashView />;
    case 'altar':
      return <AltarView />;
    case 'operations':
      return <OperationsView />;
    case 'tasks':
      return <TasksView />;
    default:
      return <HomeView />;
  }
}

export default function MainArea() {
  const activeView = useUIStore((s) => s.activeView);

  // Fallback null: die Chunks sind lokal und laden in einstelligen
  // Millisekunden — ein Spinner wuerde nur flackern.
  return <Suspense fallback={null}>{viewFor(activeView.type)}</Suspense>;
}
