import { useUIStore } from '../../store/uiStore';
import HomeView from '../views/HomeView';
import JournalView from '../views/JournalView';
import WikiView from '../views/WikiView';
import TagsView from '../views/TagsView';
import TrashView from '../views/TrashView';
import AltarView from '../views/AltarView';
import OperationsView from '../views/OperationsView';
import TasksView from '../views/TasksView';

export default function MainArea() {
  const activeView = useUIStore((s) => s.activeView);

  switch (activeView.type) {
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
