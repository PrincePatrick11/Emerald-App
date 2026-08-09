import { useTranslation } from 'react-i18next';
import {
  BookOpen,
  Library,
  Tag,
  Trash2,
  Flame,
  Plus,
  Search,
  Wand2,
  ArrowLeft,
  ArrowRight,
  Settings,
  Copy,
  Pencil,
  PanelTopOpen,
  CheckSquare,
} from 'lucide-react';
import ContextMenu from '../ui/ContextMenu';
import Button from '../ui/Button';
import { useUndoStore } from '../../store/undoStore';
import { useState } from 'react';
import { useUIStore } from '../../store/uiStore';
import { useJournalStore } from '../../store/journalStore';
import { setDragItem } from '../../lib/dragState';
import { generateId } from '../../lib/helpers';
import { format } from 'date-fns';
import { MOON_PHASE_SYMBOLS } from '../../lib/moonPhase';
import type { MoonPhase } from '../../types';
import SettingsModal from './SettingsModal';

export default function LeftSidebar() {
  const { t } = useTranslation();
  const { activeView, setActiveView, openViewInNewTab, searchQuery, setSearchQuery, navigateBack, navigateForward, historyIndex, history } = useUIStore();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { entries, createEntry, updateEntry, deleteEntry, restoreEntry } = useJournalStore();
  const pushUndo = useUndoStore((s) => s.push);

  const isJournal = activeView.type === 'journal';

  const [ctxMenu, setCtxMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const openCtxMenu = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    setCtxMenu({ id, x: e.clientX, y: e.clientY });
  };

  const handleDuplicate = async (id: string) => {
    const entry = entries.find((e) => e.id === id);
    if (!entry) return;
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

  const startRename = (id: string) => {
    const entry = entries.find((e) => e.id === id);
    if (!entry) return;
    setRenameValue(entry.title);
    setRenamingId(id);
  };

  const commitRename = async () => {
    if (!renamingId) return;
    if (renameValue.trim()) await updateEntry(renamingId, { title: renameValue.trim() });
    setRenamingId(null);
  };

  const handleCtxDelete = async (id: string) => {
    await deleteEntry(id);
    pushUndo({ id: generateId(), description: t('undo.entryDeleted'), undo: () => restoreEntry(id) });
    if (activeView.id === id) setActiveView({ type: 'journal' });
  };

  const handleNewJournalEntry = async () => {
    const entry = await createEntry();
    setActiveView({ type: 'journal', id: entry.id, mode: 'edit' });
  };

  const filteredEntries = entries.filter((e) =>
    e.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="flex flex-col h-full">
      {/* App Logo */}
      <div className="sidebar-header px-3 h-14 flex items-center gap-1 border-b border-stone-700/60">
        <button
          onClick={() => setActiveView({ type: 'home' })}
          className="flex items-center gap-2 hover:opacity-80 transition-opacity mr-1"
        >
          <img src="/emerald-icon.png" alt="Emerald" className="w-7 h-7 rounded-lg object-cover" />
          <span className="font-semibold text-stone-100 tracking-wide">
            {t('app.name')}
          </span>
        </button>
        <div className="ml-auto flex items-center gap-0.5">
          <button
            onClick={navigateBack}
            disabled={historyIndex <= 0}
            className="p-1.5 rounded-md transition-colors disabled:opacity-25 disabled:cursor-not-allowed text-stone-500 hover:text-stone-300 hover:bg-stone-700/60 disabled:hover:bg-transparent disabled:hover:text-stone-500"
            title="Back"
          >
            <ArrowLeft size={14} />
          </button>
          <button
            onClick={navigateForward}
            disabled={historyIndex >= history.length - 1}
            className="p-1.5 rounded-md transition-colors disabled:opacity-25 disabled:cursor-not-allowed text-stone-500 hover:text-stone-300 hover:bg-stone-700/60 disabled:hover:bg-transparent disabled:hover:text-stone-500"
            title="Forward"
          >
            <ArrowRight size={14} />
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="sidebar-search px-3 py-3 border-b border-stone-700/60">
        <div className="sidebar-search-inner flex items-center gap-2 bg-stone-700/40 rounded-lg px-3 py-2">
          <Search size={14} className="text-stone-500 flex-shrink-0" />
          <input
            type="text"
            placeholder={t('search.placeholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="sidebar-search-input bg-transparent text-sm text-stone-300 placeholder-stone-600 outline-none w-full selectable"
          />
        </div>
      </div>

      {/* Main nav links — fixed, non-scrollable */}
      <div className="flex-shrink-0 px-2 py-2 border-b border-stone-700/40">
        <div className="flex items-center">
          <button
            onClick={() => setActiveView({ type: 'journal' })}
            className={`sidebar-item flex-1 ${isJournal && !activeView.id ? 'active' : ''}`}
          >
            <BookOpen size={14} />
            {t('nav.journal')}
          </button>
          <Button
            onClick={handleNewJournalEntry}
            variant="ghost"
            title={t('journal.newEntry')}
          >
            <Plus size={14} />
          </Button>
        </div>
        <button
          onClick={() => setActiveView({ type: 'tasks' })}
          className={`sidebar-item w-full ${activeView.type === 'tasks' ? 'active' : ''}`}
        >
          <CheckSquare size={14} />
          {t('nav.tasks')}
        </button>
        <button
          onClick={() => setActiveView({ type: 'operations' })}
          className={`sidebar-item w-full ${activeView.type === 'operations' ? 'active' : ''}`}
        >
          <Wand2 size={14} />
          {t('nav.operations')}
        </button>
        <button
          onClick={() => setActiveView({ type: 'wiki' })}
          className={`sidebar-item w-full ${activeView.type === 'wiki' ? 'active' : ''}`}
        >
          <Library size={14} />
          {t('nav.wiki')}
        </button>
        <button
          onClick={() => setActiveView({ type: 'altar' })}
          className={`sidebar-item w-full ${activeView.type === 'altar' ? 'active' : ''}`}
        >
          <Flame size={14} />
          {t('nav.altar')}
        </button>
      </div>

      {/* Journal entries list — scrollable */}
      <nav className="flex-1 overflow-y-auto py-2 px-2">
        <div className="space-y-0.5">
            {filteredEntries.map((entry) => {
              const icon = <span className="text-base leading-none flex-shrink-0">{MOON_PHASE_SYMBOLS[entry.moon_phase as MoonPhase] ?? '📓'}</span>;
              const date = <div className="text-xs text-stone-600 mt-0.5">{format(new Date(entry.created_at), 'MMM d, yyyy')}</div>;
              if (renamingId === entry.id) {
                return (
                  <div key={entry.id} className={`sidebar-item ${activeView.id === entry.id ? 'active' : ''}`}>
                    {icon}
                    <div className="flex-1 min-w-0">
                      <input
                        autoFocus
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onBlur={commitRename}
                        onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenamingId(null); }}
                        className="w-full bg-transparent text-sm text-stone-300 outline-none selectable truncate"
                      />
                      {date}
                    </div>
                  </div>
                );
              }
              return (
                <button
                  key={entry.id}
                  onPointerDown={(e) => {
                    if (e.button !== 0) return;
                    e.preventDefault();
                    setDragItem({ id: entry.id, entryType: 'journal', label: entry.title });
                  }}
                  onClick={() => setActiveView({ type: 'journal', id: entry.id, mode: 'view' })}
                  onAuxClick={(e) => {
                    if (e.button === 1) {
                      e.preventDefault();
                      openViewInNewTab({ type: 'journal', id: entry.id, mode: 'view' });
                    }
                  }}
                  onContextMenu={(e) => openCtxMenu(e, entry.id)}
                  className={`sidebar-item w-full text-left cursor-grab active:cursor-grabbing ${activeView.id === entry.id ? 'active' : ''}`}
                >
                  {icon}
                  <div className="flex-1 min-w-0">
                    <div className="truncate">{entry.title}</div>
                    {date}
                  </div>
                </button>
              );
            })}
          </div>
      </nav>

      {/* Bottom nav — always visible */}
      <div className="sidebar-bottom-bar flex-shrink-0 border-t border-stone-700/40 px-2 py-2">
        <div className="flex items-center px-1 py-1">
          <button
            onClick={() => setSettingsOpen(true)}
            title={t('nav.settings')}
            className="p-2 rounded-md transition-colors text-stone-500 hover:text-stone-300 hover:bg-stone-700/40"
          >
            <Settings size={18} />
          </button>
          <button
            onClick={() => setActiveView({ type: 'tags' })}
            title={t('nav.tags')}
            className={`p-2 rounded-md transition-colors ${activeView.type === 'tags' ? 'text-stone-300 bg-stone-700/60' : 'text-stone-500 hover:text-stone-300 hover:bg-stone-700/40'}`}
          >
            <Tag size={18} />
          </button>
          <button
            onClick={() => setActiveView({ type: 'trash' })}
            title={t('nav.trash')}
            className={`ml-auto p-2 rounded-md transition-colors ${activeView.type === 'trash' ? 'text-stone-300 bg-stone-700/60' : 'text-stone-500 hover:text-stone-300 hover:bg-stone-700/40'}`}
          >
            <Trash2 size={18} />
          </button>
        </div>
      </div>

      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x} y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
          actions={[
            { label: t('contextMenu.openInNewTab'), icon: <PanelTopOpen size={12} />, onClick: () => openViewInNewTab({ type: 'journal', id: ctxMenu.id, mode: 'view' }) },
            { label: t('contextMenu.duplicate'), icon: <Copy size={12} />, onClick: () => handleDuplicate(ctxMenu.id) },
            { label: t('contextMenu.rename'),    icon: <Pencil size={12} />, onClick: () => startRename(ctxMenu.id) },
            { label: t('contextMenu.delete'),    icon: <Trash2 size={12} />, onClick: () => handleCtxDelete(ctxMenu.id), danger: true },
          ]}
        />
      )}
    </div>
  );
}
