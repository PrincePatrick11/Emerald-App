import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { format } from 'date-fns';
import { BookOpen, Wand2, Library, Flame, CheckSquare, Square, Copy, Pencil, Trash2, PanelTopOpen } from 'lucide-react';
import { useUIStore } from '../../store/uiStore';
import { useJournalStore } from '../../store/journalStore';
import { useOperationStore } from '../../store/operationStore';
import { useWikiStore } from '../../store/wikiStore';
import { useTaskStore } from '../../store/taskStore';
import { useAltarStore } from '../../store/altarStore';
import { useUndoStore } from '../../store/undoStore';
import { setDragItem } from '../../lib/dragState';
import { generateId, isImageIcon } from '../../lib/helpers';
import { getCategoryEmoji } from '../wiki/WikiList';
import { MOON_PHASE_SYMBOLS } from '../../lib/moonPhase';
import type { MoonPhase } from '../../types';
import TabIconButton from '../ui/TabIconButton';
import EntryListTab from '../ui/EntryListTab';

export default function LeftSidebarEntryList() {
  const { t } = useTranslation();
  const { leftListTab, setLeftListTab } = useUIStore();

  const tabs: Array<{ id: 'journal' | 'tasks' | 'operations' | 'wiki' | 'altar'; icon: ReactNode; label: string }> = [
    { id: 'journal', icon: <BookOpen size={14} />, label: t('nav.journal') },
    { id: 'tasks', icon: <CheckSquare size={14} />, label: t('nav.tasks') },
    { id: 'operations', icon: <Wand2 size={14} />, label: t('nav.operations') },
    { id: 'wiki', icon: <Library size={14} />, label: t('nav.wiki') },
    { id: 'altar', icon: <Flame size={14} />, label: t('nav.altar') },
  ];

  return (
    <div className="flex flex-col h-full flex-1 min-w-0">
      <div className="flex items-center gap-0.5 px-3 h-14 border-b border-stone-700/60 flex-shrink-0">
        {tabs.map(({ id, icon, label }) => (
          <TabIconButton key={id} active={leftListTab === id} onClick={() => setLeftListTab(id)} title={label}>
            {icon}
          </TabIconButton>
        ))}
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        {leftListTab === 'journal' && <JournalList />}
        {leftListTab === 'tasks' && <TasksList />}
        {leftListTab === 'operations' && <OperationsList />}
        {leftListTab === 'wiki' && <WikiList />}
        {leftListTab === 'altar' && <AltarList />}
      </div>
    </div>
  );
}

function JournalList() {
  const { t } = useTranslation();
  const { activeView, setActiveView, openViewInNewTab } = useUIStore();
  const { entries, createEntry, updateEntry, deleteEntry, restoreEntry } = useJournalStore();
  const pushUndo = useUndoStore((s) => s.push);

  const handleNewJournalEntry = async () => {
    const entry = await createEntry();
    setActiveView({ type: 'journal', id: entry.id, mode: 'edit' });
  };

  const handleDuplicate = async (entry: (typeof entries)[number]) => {
    const newEntry = await createEntry();
    await updateEntry(newEntry.id, {
      title: entry.title + ' (Copy)',
      content: entry.content,
      tags: entry.tags,
      moon_phase: entry.moon_phase,
      paradigm_id: entry.paradigm_id,
      is_bannung: entry.is_bannung,
      bannung_type_wiki_id: entry.bannung_type_wiki_id,
      is_meditation: entry.is_meditation,
      meditation_type_wiki_id: entry.meditation_type_wiki_id,
      meditation_duration: entry.meditation_duration,
      linked_operation_ids: entry.linked_operation_ids,
      linked_wiki_ids: entry.linked_wiki_ids,
    });
    setActiveView({ type: 'journal', id: newEntry.id, mode: 'view' });
  };

  const handleDelete = async (entry: (typeof entries)[number]) => {
    await deleteEntry(entry.id);
    pushUndo({ id: generateId(), description: t('undo.entryDeleted'), undo: () => restoreEntry(entry.id) });
    if (activeView.id === entry.id) setActiveView({ type: 'journal' });
  };

  return (
    <EntryListTab
      items={entries}
      getId={(e) => e.id}
      getTitle={(e) => e.title}
      getDateStr={(e) => format(new Date(e.created_at), 'MMM d, yyyy')}
      getIcon={(e) => <span className="text-base leading-none flex-shrink-0">{MOON_PHASE_SYMBOLS[e.moon_phase as MoonPhase] ?? '📓'}</span>}
      isActive={(e) => activeView.id === e.id}
      onOpen={(e) => setActiveView({ type: 'journal', id: e.id, mode: 'view' })}
      onOpenNewTab={(e) => openViewInNewTab({ type: 'journal', id: e.id, mode: 'view' })}
      onDragStart={(e) => setDragItem({ id: e.id, entryType: 'journal', label: e.title })}
      onRename={(e, title) => updateEntry(e.id, { title })}
      contextMenuActions={(e, startRename) => [
        { label: t('contextMenu.openInNewTab'), icon: <PanelTopOpen size={12} />, onClick: () => openViewInNewTab({ type: 'journal', id: e.id, mode: 'view' }) },
        { label: t('contextMenu.duplicate'), icon: <Copy size={12} />, onClick: () => handleDuplicate(e) },
        { label: t('contextMenu.rename'), icon: <Pencil size={12} />, onClick: startRename },
        { label: t('contextMenu.delete'), icon: <Trash2 size={12} />, onClick: () => handleDelete(e), danger: true },
      ]}
      emptyMessage={t('journal.noEntries')}
      onCreate={handleNewJournalEntry}
      createTitle={t('journal.newEntry')}
    />
  );
}

function OperationsList() {
  const { t } = useTranslation();
  const { activeView, setActiveView, openViewInNewTab } = useUIStore();
  const { categories, operations, createOperation, updateOperation, deleteOperation, restoreOperation } = useOperationStore();
  const pushUndo = useUndoStore((s) => s.push);

  const catById = Object.fromEntries(categories.map((c) => [c.id, c]));
  const opCatName = (c: (typeof categories)[number]) => (c.is_builtin ? t(`operations.categories.${c.id}`) : c.name);

  const handleNewOperation = async () => {
    const categoryId = categories[0]?.id;
    if (!categoryId) return;
    const op = await createOperation(categoryId);
    setActiveView({ type: 'operations', id: op.id, mode: 'edit' });
  };

  const handleDuplicate = async (op: (typeof operations)[number]) => {
    const newOp = await createOperation(op.category_id);
    await updateOperation(newOp.id, {
      title: op.title + ' (Copy)', content: op.content,
      tags: op.tags, is_active: op.is_active, end_date: op.end_date,
      version: op.version, icon: op.icon ?? undefined, cover_image: op.cover_image ?? undefined,
    });
    setActiveView({ type: 'operations', id: newOp.id, mode: 'view' });
  };

  const handleDelete = async (op: (typeof operations)[number]) => {
    await deleteOperation(op.id);
    pushUndo({ id: generateId(), description: t('undo.operationDeleted'), undo: () => restoreOperation(op.id) });
    if (activeView.id === op.id) setActiveView({ type: 'operations' });
  };

  const sorted = operations.slice().sort((a, b) => b.updated_at.localeCompare(a.updated_at));

  return (
    <EntryListTab
      items={sorted}
      getId={(op) => op.id}
      getTitle={(op) => op.title}
      getDateStr={(op) => {
        const cat = catById[op.category_id];
        const catDisplayName = cat ? opCatName(cat) : '';
        return `${catDisplayName}${catDisplayName ? ' · ' : ''}${format(new Date(op.updated_at), 'MMM d, yyyy')}`;
      }}
      getIcon={(op) => {
        const cat = catById[op.category_id];
        const iconValue = op.icon || cat?.emoji || '⚡';
        return isImageIcon(iconValue)
          ? <img src={iconValue} alt="" className="w-5 h-5 object-cover rounded flex-shrink-0" />
          : <span className="text-base leading-none flex-shrink-0">{iconValue}</span>;
      }}
      isActive={(op) => activeView.id === op.id}
      onOpen={(op) => setActiveView({ type: 'operations', id: op.id, mode: 'view' })}
      onOpenNewTab={(op) => openViewInNewTab({ type: 'operations', id: op.id, mode: 'view' })}
      onDragStart={(op) => setDragItem({ id: op.id, entryType: 'operation', label: op.title, category: catById[op.category_id]?.emoji })}
      onRename={(op, title) => updateOperation(op.id, { title })}
      contextMenuActions={(op, startRename) => [
        { label: t('contextMenu.openInNewTab'), icon: <PanelTopOpen size={12} />, onClick: () => openViewInNewTab({ type: 'operations', id: op.id, mode: 'view' }) },
        { label: t('contextMenu.duplicate'), icon: <Copy size={12} />, onClick: () => handleDuplicate(op) },
        { label: t('contextMenu.rename'), icon: <Pencil size={12} />, onClick: startRename },
        { label: t('contextMenu.delete'), icon: <Trash2 size={12} />, onClick: () => handleDelete(op), danger: true },
      ]}
      emptyMessage={t('operations.none')}
      onCreate={handleNewOperation}
      createTitle={t('operations.new')}
    />
  );
}

function WikiList() {
  const { t } = useTranslation();
  const { activeView, setActiveView, openViewInNewTab } = useUIStore();
  const { articles, wikiCategories, createArticle, updateArticle, deleteArticle, restoreArticle } = useWikiStore();
  const pushUndo = useUndoStore((s) => s.push);

  const catById = Object.fromEntries(wikiCategories.map((c) => [c.id, c]));

  const handleNewArticle = async () => {
    const category = wikiCategories[0]?.id ?? 'other';
    const article = await createArticle(category);
    setActiveView({ type: 'wiki', id: article.id, mode: 'edit' });
  };

  const handleDuplicate = async (article: (typeof articles)[number]) => {
    const newArt = await createArticle(article.category);
    await updateArticle(newArt.id, {
      title: article.title + ' (Copy)', content: article.content,
      tags: article.tags, icon: article.icon ?? undefined, cover_image: article.cover_image ?? undefined,
    });
    setActiveView({ type: 'wiki', id: newArt.id, mode: 'view' });
  };

  const handleDelete = async (article: (typeof articles)[number]) => {
    await deleteArticle(article.id);
    pushUndo({ id: generateId(), description: t('undo.articleDeleted'), undo: () => restoreArticle(article.id) });
    if (activeView.id === article.id) setActiveView({ type: 'wiki' });
  };

  const sorted = articles.slice().sort((a, b) => b.updated_at.localeCompare(a.updated_at));

  return (
    <EntryListTab
      items={sorted}
      getId={(a) => a.id}
      getTitle={(a) => a.title}
      getDateStr={(a) => {
        const cat = catById[a.category];
        const catLabel = cat ? (cat.is_builtin ? t(`wiki.categories.${cat.id}`) : cat.name) : a.category;
        return `${catLabel} · ${format(new Date(a.updated_at), 'MMM d, yyyy')}`;
      }}
      getIcon={(a) => {
        const cat = catById[a.category];
        return isImageIcon(a.icon)
          ? <img src={a.icon} alt="" className="w-5 h-5 object-cover rounded flex-shrink-0" />
          : <span className="text-base leading-none flex-shrink-0">{cat?.emoji ?? getCategoryEmoji(a.category)}</span>;
      }}
      isActive={(a) => activeView.id === a.id}
      onOpen={(a) => setActiveView({ type: 'wiki', id: a.id, mode: 'view' })}
      onOpenNewTab={(a) => openViewInNewTab({ type: 'wiki', id: a.id, mode: 'view' })}
      onDragStart={(a) => setDragItem({ id: a.id, entryType: 'wiki', label: a.title, category: a.category })}
      onRename={(a, title) => updateArticle(a.id, { title })}
      contextMenuActions={(a, startRename) => [
        { label: t('contextMenu.openInNewTab'), icon: <PanelTopOpen size={12} />, onClick: () => openViewInNewTab({ type: 'wiki', id: a.id, mode: 'view' }) },
        { label: t('contextMenu.duplicate'), icon: <Copy size={12} />, onClick: () => handleDuplicate(a) },
        { label: t('contextMenu.rename'), icon: <Pencil size={12} />, onClick: startRename },
        { label: t('contextMenu.delete'), icon: <Trash2 size={12} />, onClick: () => handleDelete(a), danger: true },
      ]}
      emptyMessage={t('wiki.noArticles')}
      onCreate={handleNewArticle}
      createTitle={t('wiki.newArticle')}
    />
  );
}

function AltarList() {
  const { t } = useTranslation();
  const { activeView, setActiveView, openViewInNewTab } = useUIStore();
  const { altars, createAltar, updateAltar } = useAltarStore();

  const handleNewAltar = async () => {
    const altar = await createAltar();
    setActiveView({ type: 'altar', id: altar.id, mode: 'edit' });
  };

  const sorted = altars.slice().sort((a, b) => b.updated_at.localeCompare(a.updated_at));

  return (
    <EntryListTab
      items={sorted}
      getId={(a) => a.id}
      getTitle={(a) => a.title}
      getDateStr={(a) => format(new Date(a.updated_at), 'MMM d, yyyy')}
      getIcon={(a) => isImageIcon(a.icon_data)
        ? <img src={a.icon_data!} alt="" className="w-5 h-5 object-cover rounded flex-shrink-0" />
        : <Flame size={16} className="flex-shrink-0 text-stone-600" />}
      isActive={(a) => activeView.id === a.id}
      onOpen={(a) => setActiveView({ type: 'altar', id: a.id, mode: 'view' })}
      onOpenNewTab={(a) => openViewInNewTab({ type: 'altar', id: a.id, mode: 'view' })}
      onRename={(a, title) => updateAltar(a.id, { title })}
      contextMenuActions={(a, startRename) => [
        { label: t('contextMenu.openInNewTab'), icon: <PanelTopOpen size={12} />, onClick: () => openViewInNewTab({ type: 'altar', id: a.id, mode: 'view' }) },
        { label: t('contextMenu.rename'), icon: <Pencil size={12} />, onClick: startRename },
      ]}
      emptyMessage={t('altar.none')}
      onCreate={handleNewAltar}
      createTitle={t('altar.newAltar')}
    />
  );
}

function TasksList() {
  const { t } = useTranslation();
  const { setActiveView } = useUIStore();
  const { categories, tasks, createTask, updateTask, deleteTask, restoreTask } = useTaskStore();
  const pushUndo = useUndoStore((s) => s.push);

  const catById = Object.fromEntries(categories.map((c) => [c.id, c]));

  const handleNewTask = async () => {
    const task = await createTask('');
    setActiveView({ type: 'tasks' });
    return task;
  };

  const handleDelete = async (task: (typeof tasks)[number]) => {
    await deleteTask(task.id);
    pushUndo({ id: generateId(), description: t('undo.taskDeleted'), undo: () => restoreTask(task.id) });
  };

  const sorted = tasks.slice().sort((a, b) => b.updated_at.localeCompare(a.updated_at));

  // The checkbox needs to be clickable independently of the title, so the row
  // content is custom — search bar, empty-state, "+" and the context menu
  // popup itself still come from EntryListTab.
  return (
    <EntryListTab
      items={sorted}
      getId={(task) => task.id}
      getTitle={(task) => task.title}
      onRename={(task, title) => updateTask(task.id, { title })}
      contextMenuActions={(task, startRename) => [
        { label: t('contextMenu.rename'), icon: <Pencil size={12} />, onClick: startRename },
        { label: t('contextMenu.delete'), icon: <Trash2 size={12} />, onClick: () => handleDelete(task), danger: true },
      ]}
      emptyMessage={t('tasks.empty')}
      onCreate={handleNewTask}
      createTitle={t('tasks.newTask')}
      renderRow={({ item: task, isRenaming, renameValue, setRenameValue, commitRename, cancelRename, openCtxMenu }) => {
        const cat = catById[task.category_id];
        const dateStr = `${cat?.name ?? ''}${cat?.name && task.due_date ? ' · ' : ''}${task.due_date ? format(new Date(task.due_date), 'MMM d, yyyy') : ''}`;

        if (isRenaming) {
          return (
            <div className="sidebar-item">
              <CheckSquare size={16} className="flex-shrink-0 text-stone-600" />
              <div className="flex-1 min-w-0">
                <input
                  autoFocus
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') cancelRename(); }}
                  className="w-full bg-transparent text-sm text-stone-300 outline-none selectable truncate"
                />
                {dateStr && <div className="text-xs text-stone-600 mt-0.5">{dateStr}</div>}
              </div>
            </div>
          );
        }

        return (
          <div onContextMenu={openCtxMenu} className="sidebar-item w-full text-left">
            <button
              onClick={(e) => { e.stopPropagation(); updateTask(task.id, { completed: !task.completed }); }}
              className="flex-shrink-0 text-stone-500 hover:text-stone-300"
              title={task.completed ? t('tasks.markActive') : t('tasks.markCompleted')}
            >
              {task.completed ? <CheckSquare size={16} /> : <Square size={16} />}
            </button>
            <button onClick={() => setActiveView({ type: 'tasks' })} className="flex-1 min-w-0 text-left">
              <div className={`truncate ${task.completed ? 'line-through text-stone-500' : ''}`}>{task.title}</div>
              {dateStr && <div className="text-xs text-stone-600 mt-0.5">{dateStr}</div>}
            </button>
          </div>
        );
      }}
    />
  );
}
