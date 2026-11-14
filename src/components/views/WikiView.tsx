import { useState, useEffect } from 'react';
import { entryBlockSummary } from '../../lib/blocks/entrySummary';
import { useShallow } from 'zustand/shallow';
import { useTranslation } from 'react-i18next';
import { generateId } from '../../lib/helpers';
import { imageSrc } from '../../lib/images';
import { MODULES } from '../../lib/modules';
import { dashboardLabel } from '../../lib/dashboards';
import { formatEntryDate } from '../../lib/formatDate';
import { useUIStore } from '../../store/uiStore';
import { EDIT_ENDED, useEntryEditor } from '../../hooks/useEntryEditor';
import { useEntryContentReady } from '../../hooks/useEntryContentReady';
import { useEditActions } from '../../hooks/useEditActions';
import { guardKey } from '../../store/leaveGuardStore';
import { findEntry, useEntryStore } from '../../store/entryStore';
import { useDashboard } from '../../hooks/useDashboardEntries';
import { useUndoStore } from '../../store/undoStore';
import BlockStack from '../blocks/BlockStack';
import EntryDetailFrame from '../ui/EntryDetailFrame';
import EntryDashboard from './EntryDashboard';
import DashboardView from './DashboardView';
import { createEntryIn } from '../../lib/createItem';

export default function WikiView() {
  const { t } = useTranslation();
  const { activeView, setActiveView } = useUIStore(
    useShallow((s) => ({ activeView: s.activeView, setActiveView: s.setActiveView }))
  );
  const dashboard = useDashboard('wiki');
  const { updateEntry, deleteEntry, restoreEntry, getEntry } = useEntryStore(
    useShallow((s) => ({ updateEntry: s.updateEntry, deleteEntry: s.deleteEntry, restoreEntry: s.restoreEntry, getEntry: s.getEntry }))
  );
  const pushUndo = useUndoStore((s) => s.push);

  // Any entry opens here, whichever dashboards show it: the page follows its object in the store.
  const article = useEntryStore((s) => (activeView.id ? findEntry(s.entries, activeView.id) : undefined)) ?? null;
  // Startup loads content after the lists: until it arrives, the frame with
  // the title is shown, and the block stack only mounts with the real content.
  const contentReady = useEntryContentReady(article?.id);
  // A loaded sigil with the "whole entry" lock never opens in edit mode.
  const locked = !!article && !!entryBlockSummary(article.id, article.content).sigil?.lockEntry;
  const isEditing = activeView.mode === 'edit' && !locked;

  const [title, setTitle] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [coverImage, setCoverImage] = useState<string | null>(null);
  const [loadedArticleId, setLoadedArticleId] = useState<string | null>(null);

  const [editorEpoch, setEditorEpoch] = useState(0);

  const fieldsOf = (a: NonNullable<typeof article>) => ({
    title: a.title, content: a.content, tags: a.tags ?? [],
    category_id: a.category_id ?? null, icon: a.icon, cover_image: a.cover_image,
  });

  const { triggerAutoSave, cancelAutoSave, flushAutoSave, restoreOnCancel, isDirty, contentRef, handleContentChange } = useEntryEditor({
    scope: 'wiki',
    entityId: article?.id,
    isEditing,
    ready: !!article && loadedArticleId === article.id,
    // Category, cover and icon belong to the properties panel (saved
    // immediately) and are therefore not in the patch: an autosave right after
    // a panel change would otherwise write the local state back before the
    // sync effect ran.
    buildPatch: (content) => ({ title, content, tags }),
    // Cancel restores the article as it was on entering edit mode —
    // including what the sidebar has saved in the meantime.
    buildRestorePatch: (content) => ({
      title, content, tags,
      category_id: article?.category_id ?? null, icon: article?.icon, cover_image: article?.cover_image,
    }),
    readStored: (id) => {
      const stored = getEntry(id);
      return stored ? fieldsOf(stored) : null;
    },
    readStamp: (id) => getEntry(id)?.updated_at,
    update: updateEntry,
  });

  useEffect(() => {
    if (article && contentReady) {
      setTitle(article.title);
      contentRef.current = article.content;
      setTags(article.tags ?? []);
      setCoverImage(article.cover_image ?? null);
      setLoadedArticleId(article.id);
    } else {
      setLoadedArticleId(null);
    }
  }, [article?.id, contentReady]);

  // Sync from store (also during editing — sidebar changes must apply)
  useEffect(() => {
    if (article) {
      setTags(article.tags ?? []);
      setCoverImage(article.cover_image ?? null);
    }
  }, [article?.tags, article?.cover_image]);

  // The title likewise: a rename from the sidebar while edit mode is open
  // would otherwise be reverted by the next autosave.
  useEffect(() => {
    if (article) setTitle(article.title);
  }, [article?.title]);

  const handleDone = async () => {
    if (!article) return;
    cancelAutoSave();
    await updateEntry(article.id, { title, content: contentRef.current, tags });
    setActiveView({ type: 'wiki', id: article.id, mode: 'view' });
  };

  const handleCancel = async () => {
    // An article never confirmed with "Done" goes to the trash, like any deleted one.
    if (activeView.isNew && article) return handleDelete();
    cancelAutoSave();
    if (article) {
      // Not back to the store state — after the first debounced autosave
      // the store IS the edited state. restoreOnCancel writes back the state
      // of the article remembered on entering edit mode; the setters
      // here handle the case before the first autosave (store unchanged,
      // sync effects do not run).
      const restored = await restoreOnCancel();
      // The page no longer shows this entry, editing has already ended — nothing left to do.
      if (restored === EDIT_ENDED) return;
      const from = restored ?? fieldsOf(article);
      setTitle(from.title);
      setTags(from.tags);
      setCoverImage(from.cover_image ?? null);
      contentRef.current = from.content;
      setEditorEpoch((e) => e + 1);
    }
    setActiveView({ type: 'wiki', id: article!.id, mode: 'view' });
  };

  const handleDelete = async () => {
    if (!article) return;
    // Write what is still deferred first: the trash holds the latest state.
    await flushAutoSave().catch(console.error);
    const id = article.id;
    await deleteEntry(id);
    pushUndo({ id: generateId(), description: t('undo.articleDeleted'), undo: () => restoreEntry(id) });
    setActiveView({ type: 'wiki' });
  };

  useEditActions(isEditing, {
    onSave: handleDone, onCancel: handleCancel, onDelete: handleDelete, flush: flushAutoSave,
    guard: article ? {
      key: guardKey('wiki', article.id),
      title: () => title.trim() || getEntry(article.id)?.title.trim() || t('wiki.untitled'),
      isDirty: () => isDirty(!!activeView.isNew),
    } : undefined,
  });

  // Without an argument the article is created without a category; the "+"
  // button on the category header passes its category — like handleCreateTask(cat.id).
  const handleNew = (categoryId?: string) => createEntryIn('wiki', { categoryId });

  if (!article) {
    // A deleted built-in has no list of its own any more: "All entries" stands in.
    if (!dashboard) return <DashboardView />;
    return (
      <EntryDashboard
        dashboard={dashboard}
        title={dashboardLabel(t, dashboard)}
        own={{ view: 'wiki', kind: 'wiki' }}
        scope="wiki"
        newLabel={t('wiki.newArticle')}
        onNew={handleNew}
        emptyState={{ icon: MODULES.wiki.icon, title: t('emptyState.wiki.title'), description: t('emptyState.wiki.description') }}
      />
    );
  }

  return (
    <EntryDetailFrame
      module="wiki"
      isEditing={isEditing}
      meta={formatEntryDate(article.updated_at)}
      aboveTitle={!isEditing && coverImage && (
        <div className="flex-shrink-0 px-8 pt-5">
          <img
            src={imageSrc(coverImage)}
            alt=""
            className="w-full max-h-48 object-cover rounded-lg border border-edge"
          />
        </div>
      )}
      title={isEditing ? title : article.title}
      onTitleChange={(nextTitle) => { setTitle(nextTitle); triggerAutoSave(); }}
      tags={{ value: tags, onChange: (newTags) => { setTags(newTags); triggerAutoSave(); } }}
    >
      {loadedArticleId === article.id && (
        <BlockStack
          key={`${article.id}:${editorEpoch}`}
          entryId={article.id}
          initialContent={article.content}
          placeholder={t('wiki.placeholder')}
          onChange={handleContentChange}
          onReadModeChange={(content) => updateEntry(article.id, { content })}
          isEditing={isEditing}
          templateTarget={{ flush: flushAutoSave }}
        />
      )}
    </EntryDetailFrame>
  );
}
