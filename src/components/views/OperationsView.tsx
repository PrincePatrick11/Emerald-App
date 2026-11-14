import { useState, useEffect } from 'react';
import { useShallow } from 'zustand/shallow';
import { useTranslation } from 'react-i18next';
import { generateId } from '../../lib/helpers';
import { imageSrc } from '../../lib/images';
import { MODULES } from '../../lib/modules';
import { dashboardLabel } from '../../lib/dashboards';
import { entryBlockSummary } from '../../lib/blocks/entrySummary';
import { formatEntryDate } from '../../lib/formatDate';
import { useUIStore } from '../../store/uiStore';
import { findEntry, useEntryStore } from '../../store/entryStore';
import { useDashboard } from '../../hooks/useDashboardEntries';
import { useUndoStore } from '../../store/undoStore';
import { EDIT_ENDED, useEntryEditor } from '../../hooks/useEntryEditor';
import { useEntryContentReady } from '../../hooks/useEntryContentReady';
import { useEditActions } from '../../hooks/useEditActions';
import { guardKey } from '../../store/leaveGuardStore';
import BlockStack from '../blocks/BlockStack';
import EntryDetailFrame from '../ui/EntryDetailFrame';
import EntryDashboard from './EntryDashboard';
import DashboardView from './DashboardView';
import { createEntryIn } from '../../lib/createItem';

export default function OperationsView() {
  const { t } = useTranslation();
  const { activeView, setActiveView } = useUIStore(
    useShallow((s) => ({ activeView: s.activeView, setActiveView: s.setActiveView }))
  );
  const dashboard = useDashboard('operations');
  const { updateEntry, deleteEntry, restoreEntry, getEntry } = useEntryStore(
    useShallow((s) => ({ updateEntry: s.updateEntry, deleteEntry: s.deleteEntry, restoreEntry: s.restoreEntry, getEntry: s.getEntry }))
  );
  const pushUndo = useUndoStore((s) => s.push);

  // Any entry opens here, whichever dashboards show it: the page follows its object in the store.
  const operation = useEntryStore((s) => (activeView.id ? findEntry(s.entries, activeView.id) : undefined)) ?? null;
  // Startup loads content after the lists: until it arrives, the frame with
  // the title is shown, and the block stack only mounts with the real content.
  const contentReady = useEntryContentReady(operation?.id);
  // A loaded sigil with the "whole entry" lock never opens in edit
  // mode — no matter where that comes from (sidebar, a dashboard, tab).
  const locked = !!operation && !!entryBlockSummary(operation.id, operation.content).sigil?.lockEntry;
  const isEditing = activeView.mode === 'edit' && !locked;

  const [title, setTitle] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [loadedOperationId, setLoadedOperationId] = useState<string | null>(null);

  const [editorEpoch, setEditorEpoch] = useState(0);

  const fieldsOf = (o: NonNullable<typeof operation>) => ({
    title: o.title, content: o.content, tags: o.tags ?? [],
    category_id: o.category_id ?? null, icon: o.icon, cover_image: o.cover_image,
  });

  const { triggerAutoSave, cancelAutoSave, flushAutoSave, restoreOnCancel, isDirty, contentRef, handleContentChange } = useEntryEditor({
    scope: 'operations',
    entityId: operation?.id,
    isEditing,
    ready: !!operation && loadedOperationId === operation.id,
    // The category belongs to the properties panel (saved immediately) and is
    // therefore not in the patch: an autosave right after the change would
    // otherwise write the old state back.
    buildPatch: (content) => ({ title, content, tags }),
    // Cancel restores the operation as it was on entering edit mode —
    // including what the sidebar has saved in the meantime.
    buildRestorePatch: (content) => ({
      title, content, tags,
      category_id: operation?.category_id ?? null, icon: operation?.icon, cover_image: operation?.cover_image,
    }),
    readStored: (id) => {
      const stored = getEntry(id);
      return stored ? fieldsOf(stored) : null;
    },
    readStamp: (id) => getEntry(id)?.updated_at,
    update: updateEntry,
  });

  useEffect(() => {
    if (operation && contentReady) {
      setTitle(operation.title);
      contentRef.current = operation.content;
      setTags(operation.tags ?? []);
      setLoadedOperationId(operation.id);
    } else {
      setLoadedOperationId(null);
    }
  }, [operation?.id, contentReady]);

  // Sync from store (also during editing — sidebar changes must apply)
  useEffect(() => {
    if (operation) {
      setTags(operation.tags ?? []);
    }
  }, [operation?.tags]);

  // The title likewise: a rename from the sidebar while edit mode is open
  // would otherwise be reverted by the next autosave.
  useEffect(() => {
    if (operation) setTitle(operation.title);
  }, [operation?.title]);

  // Without an argument in the dashboard's first category; the "+" on a category header passes its own.
  const handleNew = (categoryId?: string) => createEntryIn('operations', { categoryId });

  const handleDone = async () => {
    if (!operation) return;
    cancelAutoSave();
    await updateEntry(operation.id, { title, content: contentRef.current, tags });
    setActiveView({ type: 'operations', id: operation.id, mode: 'view' });
  };

  const handleCancel = async () => {
    // An operation never confirmed with "Done" goes to the trash, like any deleted one.
    if (activeView.isNew && operation) return handleDelete();
    cancelAutoSave();
    if (operation) {
      // Not back to the store state — after the first debounced autosave
      // the store IS the edited state. restoreOnCancel writes back the state
      // of the operation remembered on entering edit mode; the setters
      // here handle the case before the first autosave (store unchanged,
      // sync effects do not run).
      const restored = await restoreOnCancel();
      // The page no longer shows this entry, editing has already ended — nothing left to do.
      if (restored === EDIT_ENDED) return;
      const from = restored ?? fieldsOf(operation);
      setTitle(from.title);
      setTags(from.tags);
      contentRef.current = from.content;
      setEditorEpoch((e) => e + 1);
    }
    setActiveView({ type: 'operations', id: operation!.id, mode: 'view' });
  };

  const handleDelete = async () => {
    if (!operation) return;
    // Write what is still deferred first: the trash holds the latest state.
    await flushAutoSave().catch(console.error);
    const id = operation.id;
    await deleteEntry(id);
    pushUndo({ id: generateId(), description: t('undo.operationDeleted'), undo: () => restoreEntry(id) });
    setActiveView({ type: 'operations' });
  };

  useEditActions(isEditing, {
    onSave: handleDone, onCancel: handleCancel, onDelete: handleDelete, flush: flushAutoSave,
    guard: operation ? {
      key: guardKey('operations', operation.id),
      title: () => title.trim() || getEntry(operation.id)?.title.trim() || t('operations.untitled'),
      isDirty: () => isDirty(!!activeView.isNew),
    } : undefined,
  });

  // List view
  if (!operation) {
    // A deleted built-in has no list of its own any more: "All entries" stands in.
    if (!dashboard) return <DashboardView />;
    return (
      <EntryDashboard
        dashboard={dashboard}
        title={dashboardLabel(t, dashboard)}
        own={{ view: 'operations', kind: 'operation' }}
        scope="operations"
        newLabel={t('operations.new')}
        onNew={handleNew}
        emptyState={{ icon: MODULES.operations.icon, title: t('emptyState.operations.title'), description: t('emptyState.operations.description') }}
      />
    );
  }

  return (
    <EntryDetailFrame
      module="operations"
      isEditing={isEditing}
      meta={formatEntryDate(operation.updated_at)}
      title={isEditing ? title : operation.title}
      onTitleChange={(nextTitle) => { setTitle(nextTitle); triggerAutoSave(); }}
      // Cover image — read mode hero (deliberately after the title, unlike in the wiki)
      belowTitle={!isEditing && operation.cover_image && (
        <div className="flex-shrink-0 px-8 pt-5">
          <img src={imageSrc(operation.cover_image)} alt="" className="w-full max-h-48 object-cover rounded-lg border border-edge" />
        </div>
      )}
      tags={{ value: tags, onChange: (newTags) => { setTags(newTags); triggerAutoSave(); } }}
    >
      {loadedOperationId === operation.id && (
        <BlockStack
          key={`${operation.id}:${editorEpoch}`}
          entryId={operation.id}
          initialContent={operation.content}
          placeholder={t('operations.placeholder')}
          onChange={handleContentChange}
          onReadModeChange={(content) => updateEntry(operation.id, { content })}
          isEditing={isEditing}
          templateTarget={{ flush: flushAutoSave }}
        />
      )}
    </EntryDetailFrame>
  );
}
