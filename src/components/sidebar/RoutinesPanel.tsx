import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Check, Pencil, Trash2, Copy } from 'lucide-react';
import { useRoutineStore } from '../../store/routineStore';
import { useUndoStore } from '../../store/undoStore';
import { setRoutineDragItem } from '../../lib/routineDragState';
import { generateId } from '../../lib/helpers';
import TagInput from '../editor/TagInput';
import LinkedOpsInput from './LinkedOpsInput';
import LinkedWikiInput from './LinkedWikiInput';
import ContextMenu from '../ui/ContextMenu';
import EmojiPicker from '../ui/EmojiPicker';
import Button from '../ui/Button';

export default function RoutinesPanel() {
  const { t } = useTranslation();
  const { routines, createRoutine, updateRoutine, deleteRoutine, restoreRoutine } = useRoutineStore();
  const pushUndo = useUndoStore((s) => s.push);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEmoji, setNewEmoji] = useState('📋');
  const [newContent, setNewContent] = useState('');
  const [newTags, setNewTags] = useState<string[]>([]);
  const [newOpIds, setNewOpIds] = useState<string[]>([]);
  const [newWikiIds, setNewWikiIds] = useState<string[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const inputCls =
    'w-full bg-stone-800/60 rounded-md px-3 py-1.5 text-xs text-stone-300 outline-none ' +
    'border border-stone-700/40 focus:border-stone-600 transition-colors placeholder-stone-700';
  const textareaCls =
    'w-full bg-stone-800/60 rounded-md px-3 py-2 text-xs text-stone-300 outline-none resize-none ' +
    'border border-stone-700/40 focus:border-stone-600 transition-colors placeholder-stone-700';

  const handleCreate = async () => {
    if (!newName.trim()) return;
    await createRoutine(newName.trim(), newEmoji, newContent, newTags, newOpIds, newWikiIds);
    setNewName(''); setNewEmoji('📋'); setNewContent(''); setNewTags([]); setNewOpIds([]); setNewWikiIds([]);
    setAdding(false);
  };

  return (
    <div className="flex flex-col gap-2">
      {/* Add form / button — always on top */}
      {adding ? (
        <div className="bg-stone-800/40 rounded-md p-2 space-y-2 border border-stone-700/40">
          <div className="flex items-center gap-1.5">
            <EmojiPicker
              value={newEmoji}
              onChange={setNewEmoji}
              trigger={({ toggle }) => (
                <button
                  onClick={toggle}
                  className="w-9 h-8 bg-stone-800/60 rounded text-base text-center hover:bg-stone-700/60 transition-colors border border-stone-700/40"
                >{newEmoji}</button>
              )}
            />
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') { setAdding(false); setNewName(''); setNewEmoji('📋'); setNewContent(''); setNewTags([]); } }}
              placeholder={t('routines.namePlaceholder')}
              className={inputCls}
            />
          </div>
          <textarea
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
            placeholder={t('routines.contentPlaceholder')}
            rows={4}
            className={textareaCls}
          />
          <LinkedOpsInput ids={newOpIds} onChange={setNewOpIds} inputCls={inputCls} />
          <LinkedWikiInput ids={newWikiIds} onChange={setNewWikiIds} inputCls={inputCls} />
          <TagInput tags={newTags} onChange={setNewTags} />
          <div className="flex justify-end gap-1">
            <Button onClick={handleCreate} variant="ghost" className="flex items-center gap-1 text-jade-400 text-xs">
              <Check size={12} /> Save
            </Button>
            <Button onClick={() => { setAdding(false); setNewName(''); setNewEmoji('📋'); setNewContent(''); setNewTags([]); setNewOpIds([]); setNewWikiIds([]); }} variant="ghost" className="text-xs">
              <X size={12} />
            </Button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="sidebar-item w-full text-left text-stone-600 hover:text-stone-300"
        >
          <span className="w-5 text-center flex-shrink-0 text-base leading-none">+</span>
          <span className="flex-1 truncate text-xs">{t('routines.newRoutine')}</span>
        </button>
      )}

      {/* List */}
      {routines.length === 0 && !adding && (
        <p className="text-xs text-stone-600 px-2 py-2">No routines yet.</p>
      )}
      <div className="space-y-0.5">
        {routines.map((routine) => (
          <RoutineRow
            key={routine.id}
            routine={routine}
            expanded={expandedId === routine.id}
            onToggle={() => setExpandedId(expandedId === routine.id ? null : routine.id)}
            onUpdate={updateRoutine}
            onDelete={async (id) => {
              const snapshot = routines.find((r) => r.id === id);
              await deleteRoutine(id);
              if (snapshot) pushUndo({ id: generateId(), description: 'Routine deleted', undo: () => restoreRoutine(snapshot) });
            }}
            onContextMenu={(e, id) => { e.preventDefault(); setCtxMenu({ id, x: e.clientX, y: e.clientY }); }}
            isRenaming={renamingId === routine.id}
            renameValue={renamingId === routine.id ? renameValue : ''}
            onRenameChange={setRenameValue}
            onRenameCommit={async () => { if (renameValue.trim()) await updateRoutine(routine.id, { name: renameValue.trim() }); setRenamingId(null); }}
            onRenameCancel={() => setRenamingId(null)}
            inputCls={inputCls}
            textareaCls={textareaCls}
          />
        ))}
      </div>
      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
          actions={[
            {
              label: 'Duplicate',
              icon: <Copy size={12} />,
              onClick: async () => {
                const src = routines.find((r) => r.id === ctxMenu.id);
                if (!src) return;
                await createRoutine(src.name + ' (Copy)', src.emoji, src.content, src.tags, src.operation_ids ?? [], src.wiki_ids ?? []);
              },
            },
            {
              label: 'Rename',
              icon: <Pencil size={12} />,
              onClick: () => {
                const src = routines.find((r) => r.id === ctxMenu.id);
                if (!src) return;
                setRenameValue(src.name);
                setRenamingId(ctxMenu.id);
                setExpandedId(null);
              },
            },
            {
              label: 'Delete',
              icon: <Trash2 size={12} />,
              danger: true,
              onClick: async () => {
                const id = ctxMenu.id;
                const snapshot = routines.find((r) => r.id === id);
                await deleteRoutine(id);
                if (snapshot) pushUndo({ id: generateId(), description: 'Routine deleted', undo: () => restoreRoutine(snapshot) });
              },
            },
          ]}
        />
      )}
    </div>
  );
}

function RoutineRow({
  routine, expanded, onToggle, onUpdate, onDelete, onContextMenu,
  isRenaming, renameValue, onRenameChange, onRenameCommit, onRenameCancel,
  inputCls, textareaCls,
}: {
  routine: import('../../types').Routine;
  expanded: boolean;
  onToggle: () => void;
  onUpdate: (id: string, patch: Partial<Pick<import('../../types').Routine, 'name' | 'emoji' | 'content' | 'tags' | 'operation_ids' | 'wiki_ids'>>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onContextMenu: (e: React.MouseEvent, id: string) => void;
  isRenaming: boolean;
  renameValue: string;
  onRenameChange: (v: string) => void;
  onRenameCommit: () => void;
  onRenameCancel: () => void;
  inputCls: string;
  textareaCls: string;
}) {
  const { t } = useTranslation();
  const [editName, setEditName] = useState(routine.name);
  const [editEmoji, setEditEmoji] = useState(routine.emoji);
  const [editContent, setEditContent] = useState(routine.content);
  const [editTags, setEditTags] = useState<string[]>(routine.tags);
  const [editOpIds, setEditOpIds] = useState<string[]>(routine.operation_ids ?? []);
  const [editWikiIds, setEditWikiIds] = useState<string[]>(routine.wiki_ids ?? []);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (expanded) {
      setEditName(routine.name); setEditEmoji(routine.emoji);
      setEditContent(routine.content); setEditTags(routine.tags);
      setEditOpIds(routine.operation_ids ?? []);
      setEditWikiIds(routine.wiki_ids ?? []);
      setConfirmDelete(false);
    }
  }, [expanded, routine.id]);

  const handleSave = () => {
    onUpdate(routine.id, { name: editName.trim() || routine.name, emoji: editEmoji, content: editContent, tags: editTags, operation_ids: editOpIds, wiki_ids: editWikiIds });
    onToggle();
  };

  return (
    <div>
      {/* Row */}
      <div
        className="sidebar-item cursor-grab active:cursor-grabbing group"
        onPointerDown={(e) => {
          if (isRenaming) return;
          e.preventDefault();
          setRoutineDragItem({ id: routine.id, name: routine.name, emoji: routine.emoji, content: routine.content, tags: routine.tags, operation_ids: routine.operation_ids ?? [], wiki_ids: routine.wiki_ids ?? [] });
        }}
        onContextMenu={(e) => onContextMenu(e, routine.id)}
      >
        <span className="w-5 text-center flex-shrink-0 text-base">{routine.emoji}</span>
        {isRenaming ? (
          <input
            autoFocus
            value={renameValue}
            onChange={(e) => onRenameChange(e.target.value)}
            onBlur={onRenameCommit}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') onRenameCancel(); }}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            className="flex-1 bg-transparent outline-none text-xs text-stone-300 border-b border-stone-600"
          />
        ) : (
          <span className="flex-1 truncate text-xs">{routine.name}</span>
        )}
        {!isRenaming && (
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onToggle(); }}
            className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 text-stone-600 hover:text-stone-300"
          >
            <Pencil size={11} />
          </button>
        )}
      </div>

      {/* Expanded edit form */}
      {expanded && (
        <div className="bg-stone-800/40 rounded-md p-2 mt-0.5 space-y-2 border border-stone-700/40">
          <div className="flex items-center gap-1.5">
            <EmojiPicker
              value={editEmoji}
              onChange={setEditEmoji}
              trigger={({ toggle }) => (
                <button
                  onClick={toggle}
                  className="w-9 h-8 bg-stone-800/60 rounded text-base text-center hover:bg-stone-700/60 transition-colors border border-stone-700/40"
                >{editEmoji}</button>
              )}
            />
            <input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className={inputCls}
            />
          </div>
          <textarea
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            placeholder={t('routines.contentPlaceholder')}
            rows={4}
            className={textareaCls}
          />
          <LinkedOpsInput ids={editOpIds} onChange={setEditOpIds} inputCls={inputCls} />
          <LinkedWikiInput ids={editWikiIds} onChange={setEditWikiIds} inputCls={inputCls} />
          <TagInput tags={editTags} onChange={setEditTags} />
          <div className="flex items-center justify-between">
            {confirmDelete ? (
              <div className="flex items-center gap-1">
                <Button onClick={() => onDelete(routine.id)} variant="danger" className="text-xs">Delete?</Button>
                <Button onClick={() => setConfirmDelete(false)} variant="ghost" className="text-xs"><X size={11} /></Button>
              </div>
            ) : (
              <Button onClick={() => setConfirmDelete(true)} variant="danger" className="flex items-center gap-1 text-xs">
                <Trash2 size={11} /> Delete
              </Button>
            )}
            <div className="flex gap-1">
              <Button onClick={handleSave} variant="ghost" className="flex items-center gap-1 text-jade-400 text-xs">
                <Check size={12} /> Save
              </Button>
              <Button onClick={onToggle} variant="ghost" className="text-xs"><X size={12} /></Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
