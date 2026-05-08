import { BookOpen, Flame, Home, Library, MoreHorizontal, Plus, Tag, Trash2, Wand2, X } from 'lucide-react';
import { useAltarStore } from '../../store/altarStore';
import { useJournalStore } from '../../store/journalStore';
import { useOperationStore } from '../../store/operationStore';
import { useUIStore } from '../../store/uiStore';
import { useWikiStore } from '../../store/wikiStore';
import type { ActiveView } from '../../types';

function getFallbackTitle(view: ActiveView) {
  switch (view.type) {
    case 'home':
      return 'Home';
    case 'journal':
      return view.id ? 'Untitled journal entry' : 'Journal';
    case 'wiki':
      return view.id ? 'Untitled wiki article' : 'Wiki';
    case 'operations':
      return view.id ? 'Untitled operation' : 'Operations';
    case 'altar':
      return view.id ? 'Untitled altar' : 'Altar';
    case 'tags':
      return 'Tags';
    case 'trash':
      return 'Trash';
    default:
      return 'Untitled';
  }
}

function getIcon(view: ActiveView) {
  switch (view.type) {
    case 'home':
      return <Home size={13} />;
    case 'journal':
      return <BookOpen size={13} />;
    case 'wiki':
      return <Library size={13} />;
    case 'operations':
      return <Wand2 size={13} />;
    case 'altar':
      return <Flame size={13} />;
    case 'tags':
      return <Tag size={13} />;
    case 'trash':
      return <Trash2 size={13} />;
    default:
      return <MoreHorizontal size={13} />;
  }
}

export default function TabBar() {
  const { tabs, activeTabId, selectTab, closeTab, closeOtherTabs, addTab } = useUIStore();
  const getEntry = useJournalStore((s) => s.getEntry);
  const getArticle = useWikiStore((s) => s.getArticle);
  const getOperation = useOperationStore((s) => s.getOperation);
  const altars = useAltarStore((s) => s.altars);

  if (tabs.length === 0) return null;

  const getTitle = (view: ActiveView) => {
    if (!view.id) return getFallbackTitle(view);
    if (view.type === 'journal') return getEntry(view.id)?.title || getFallbackTitle(view);
    if (view.type === 'wiki') return getArticle(view.id)?.title || getFallbackTitle(view);
    if (view.type === 'operations') return getOperation(view.id)?.title || getFallbackTitle(view);
    if (view.type === 'altar') return altars.find((altar) => altar.id === view.id)?.title || getFallbackTitle(view);
    return getFallbackTitle(view);
  };

  return (
    <div className="h-10 flex items-end gap-1 overflow-x-auto overflow-y-hidden px-2 pt-2 bg-stone-900/95 border-b border-stone-700/60">
      {tabs.map((tab) => {
        const isActive = activeTabId === tab.id;
        const title = getTitle(tab.view);
        return (
          <div
            key={tab.id}
            className={`group flex min-w-32 max-w-56 flex-1 items-center gap-2 rounded-t-lg border px-3 py-2 text-xs transition-colors ${
              isActive
                ? 'border-stone-700/80 border-b-stone-800 bg-stone-800 text-stone-100'
                : 'border-stone-800/60 bg-stone-900/70 text-stone-500 hover:bg-stone-800/60 hover:text-stone-300'
            }`}
          >
            <button
              onClick={() => selectTab(tab.id)}
              onAuxClick={(event) => { if (event.button === 1) closeTab(tab.id); }}
              onDoubleClick={() => closeOtherTabs(tab.id)}
              className="flex min-w-0 flex-1 items-center gap-2 text-left"
              title={`${title}\nDouble-click to close other tabs`}
            >
              <span className="flex-shrink-0 text-stone-500">{getIcon(tab.view)}</span>
              <span className="truncate">{title}</span>
              {tab.view.mode === 'edit' && <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-jade-500" title="Editing" />}
            </button>
            <button
              onClick={() => closeTab(tab.id)}
              className="-mr-1 rounded p-0.5 text-stone-600 opacity-0 transition-colors hover:bg-stone-700 hover:text-stone-200 group-hover:opacity-100"
              title="Close tab"
            >
              <X size={13} />
            </button>
          </div>
        );
      })}
      <button
        onClick={() => addTab()}
        className="mb-px flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-t-lg border border-stone-800/60 bg-stone-900/70 text-stone-500 transition-colors hover:bg-stone-800/60 hover:text-stone-200"
        title="New tab"
      >
        <Plus size={15} />
      </button>
    </div>
  );
}
