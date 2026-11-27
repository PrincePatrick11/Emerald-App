import { useState, useEffect } from 'react';
import { useShallow } from 'zustand/shallow';
import { useTranslation } from 'react-i18next';
import { entryBlockSummary } from '../../lib/blocks/entrySummary';
import { resolveProperty } from '../../lib/blocks/entryProperties';
import { blockValueLine } from '../../lib/blockValueText';
import { useLinkTitle } from '../../hooks/useLinkItems';
import { imageSrc } from '../../lib/images';
import { formatEntryDate } from '../../lib/formatDate';
import { displayTitle } from '../../lib/entryTitle';
import { useUIStore } from '../../store/uiStore';
import { dashboardOrAll, useDashboardStore } from '../../store/dashboardStore';
import { entryView } from '../../store/entryViews';
import { dashboardDateField, entryDateOf } from '../../lib/dashboards';
import { EDIT_ENDED, useEntryEditor } from '../../hooks/useEntryEditor';
import { useEntryContentReady } from '../../hooks/useEntryContentReady';
import { useEditActions } from '../../hooks/useEditActions';
import { guardKey } from '../../store/leaveGuardStore';
import { findEntry, useEntryStore } from '../../store/entryStore';
import { deleteEntryWithUndo } from '../../store/entryActions';
import BlockStack from '../blocks/BlockStack';
import EntryDetailFrame from '../ui/EntryDetailFrame';
import DashboardView from './DashboardView';
import { FaviconGlyph } from '../sidebar/fields/Favicon';

/**
 * The one entry page (`{ type: 'entry', id, dashboard }`): every entry opens
 * here, whatever its category, inside the dashboard it was opened from —
 * "All entries" when that is unset or gone. The dashboard decides only where
 * "back" leads and which date the header shows (the one it sorts by); what is
 * special about an entry comes from its category and its blocks (the icon a
 * block suggests beside the date, the cover it suggests).
 *
 * An entry that does not exist (deleted in another tab) shows the
 * dashboard's list instead.
 */
export default function EntryView() {
  const { t } = useTranslation();
  const { activeView, setActiveView } = useUIStore(
    useShallow((s) => ({ activeView: s.activeView, setActiveView: s.setActiveView }))
  );
  const dashboard = useDashboardStore((s) => dashboardOrAll(s.dashboards, activeView.dashboard ?? 'all'));
  const dashboardId = dashboard?.id ?? 'all';
  const { updateEntry, getEntry } = useEntryStore(
    useShallow((s) => ({ updateEntry: s.updateEntry, getEntry: s.getEntry }))
  );

  const entry = useEntryStore((s) => (activeView.id ? findEntry(s.entries, activeView.id) : undefined)) ?? null;
  // Startup loads content after the lists: until it arrives, the frame with
  // the title is shown, and the block stack only mounts with the real content.
  const contentReady = useEntryContentReady(entry?.id);
  // An entry a block locks (a loaded sigil) never opens in edit mode.
  const summary = entry ? entryBlockSummary(entry) : null;
  const locked = !!summary?.effects.lockEntry;
  // The user's cover — or the one a block suggests (`resolveProperty`).
  const cover = entry && summary ? resolveProperty(entry.cover_image, summary.properties.cover, null)?.value : undefined;
  // Beside the date: the entry's icon, only when it comes from a block (the
  // moon phase of the entry's day) — the one lists and tabs show. Its tooltip
  // is that block's panel row.
  const icon = entry && summary ? resolveProperty(entry.icon, summary.properties.icon, null) : null;
  const blockIcon = icon?.source === 'block' ? icon : null;
  const blockIconRow = blockIcon ? summary?.properties.rows.find((row) => row.blockId === blockIcon.blockId) : undefined;
  const linkTitle = useLinkTitle();
  const isEditing = activeView.mode === 'edit' && !locked;

  const [title, setTitle] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [loadedEntryId, setLoadedEntryId] = useState<string | null>(null);
  const [editorEpoch, setEditorEpoch] = useState(0);

  const fieldsOf = (e: NonNullable<typeof entry>) => ({
    title: e.title, content: e.content, tags: e.tags ?? [],
    category_id: e.category_id ?? null, icon: e.icon, cover_image: e.cover_image,
  });

  const { triggerAutoSave, cancelAutoSave, flushAutoSave, restoreOnCancel, isDirty, contentRef, handleContentChange } = useEntryEditor({
    scope: 'entry',
    entityId: entry?.id,
    isEditing,
    ready: !!entry && loadedEntryId === entry.id,
    // Category, cover and icon belong to the properties panel (saved
    // immediately) and are therefore not in the patch: an autosave right after
    // a panel change would otherwise write the local state back before the
    // sync effect ran.
    buildPatch: (content) => ({ title, content, tags }),
    // Cancel restores the entry as it was on entering edit mode —
    // including what the sidebar has saved in the meantime.
    buildRestorePatch: (content) => ({
      title, content, tags,
      category_id: entry?.category_id ?? null, icon: entry?.icon, cover_image: entry?.cover_image,
    }),
    readStored: (id) => {
      const stored = getEntry(id);
      return stored ? fieldsOf(stored) : null;
    },
    readStamp: (id) => getEntry(id)?.updated_at,
    update: updateEntry,
  });

  useEffect(() => {
    if (entry && contentReady) {
      setTitle(entry.title);
      contentRef.current = entry.content;
      setTags(entry.tags ?? []);
      setLoadedEntryId(entry.id);
    } else {
      setLoadedEntryId(null);
    }
  }, [entry?.id, contentReady]);

  // Tags and title from the store, also during editing — changes from the
  // sidebar must apply, or the next autosave would revert them.
  useEffect(() => {
    if (entry) setTags(entry.tags ?? []);
  }, [entry?.tags]);

  useEffect(() => {
    if (entry) setTitle(entry.title);
  }, [entry?.title]);


  const handleDone = async () => {
    if (!entry) return;
    cancelAutoSave();
    await updateEntry(entry.id, { title, content: contentRef.current, tags });
    setActiveView(entryView(entry.id, dashboardId));
  };

  const handleCancel = async () => {
    // An entry never confirmed with "Done" goes to the trash, like any deleted one.
    if (activeView.isNew && entry) return handleDelete();
    cancelAutoSave();
    if (entry) {
      // Not back to the store state — after the first debounced autosave
      // the store IS the edited state. restoreOnCancel writes back the state
      // of the entry remembered on entering edit mode; the setters
      // here handle the case before the first autosave (store unchanged,
      // sync effects do not run).
      const restored = await restoreOnCancel();
      // The page no longer shows this entry, editing has already ended — nothing left to do.
      if (restored === EDIT_ENDED) return;
      const from = restored ?? fieldsOf(entry);
      setTitle(from.title);
      setTags(from.tags);
      contentRef.current = from.content;
      setEditorEpoch((e) => e + 1);
      setActiveView(entryView(entry.id, dashboardId));
    }
  };

  const handleDelete = async () => {
    if (!entry) return;
    // Write what is still deferred first: the trash holds the latest state.
    await flushAutoSave().catch(console.error);
    await deleteEntryWithUndo(entry.id);
  };

  useEditActions(isEditing, {
    onSave: handleDone, onCancel: handleCancel, onDelete: handleDelete,
    guard: entry ? {
      key: guardKey('entry', entry.id),
      title: () => displayTitle(t, 'entry', title.trim() || getEntry(entry.id)?.title),
      isDirty: () => isDirty(!!activeView.isNew),
    } : undefined,
  });

  if (!entry) return <DashboardView dashboardId={dashboardId} />;

  // The date the dashboard sorts by — the same the list shows.
  const date = entryDateOf(entry, dashboardDateField(dashboard));

  return (
    <EntryDetailFrame
      dashboard={dashboard}
      isEditing={isEditing}
      meta={(
        <>
          {blockIcon && (
            <span
              className="inline-flex"
              title={blockIconRow ? blockValueLine(t, blockIconRow, linkTitle) : undefined}
            >
              <FaviconGlyph value={blockIcon.value} className="w-4 h-4 text-sm" />
            </span>
          )}
          <span>{formatEntryDate(date)}</span>
        </>
      )}
      aboveTitle={!isEditing && cover && (
        <div className="flex-shrink-0 px-8 pt-5">
          <img
            src={imageSrc(cover)}
            alt=""
            className="w-full max-h-48 object-cover rounded-lg border border-edge"
          />
        </div>
      )}
      title={isEditing ? title : entry.title}
      onTitleChange={(nextTitle) => { setTitle(nextTitle); triggerAutoSave(); }}
      tags={{ value: tags, onChange: (newTags) => { setTags(newTags); triggerAutoSave(); } }}
    >
      {loadedEntryId === entry.id && (
        <BlockStack
          key={`${entry.id}:${editorEpoch}`}
          entryId={entry.id}
          initialContent={entry.content}
          placeholder={t('entries.placeholder')}
          onChange={handleContentChange}
          onReadModeChange={(content) => updateEntry(entry.id, { content })}
          isEditing={isEditing}
          templateTarget={{ flush: flushAutoSave }}
        />
      )}
    </EntryDetailFrame>
  );
}
