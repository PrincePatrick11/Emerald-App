import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/shallow';
import { Layers, Maximize2, Minimize2, PackagePlus } from 'lucide-react';
import { AltarIcon } from '../../lib/altarIcon';
import { sortItems } from '../../lib/sortItems';
import { isCardView, isWideCardView } from '../../lib/viewMode';
import { groupByMonth } from '../../lib/groupBy';
import { MODULES } from '../../lib/modules';
import { useAltarStore } from '../../store/altarStore';
import { useCategoryStore } from '../../store/categoryStore';
import { useUIStore, ALTAR_LIBRARY_SORTS } from '../../store/uiStore';
import { useUndoStore } from '../../store/undoStore';
import { generateId } from '../../lib/helpers';
import { AS_A_CONSEQUENCE } from '../../lib/stamp';
import { useEditActions } from '../../hooks/useEditActions';
import { guardKey } from '../../store/leaveGuardStore';
import {
  altarEditChanged, altarEditDirty, beginAltarEdit, endAltarEdit, restoreAltarEdit, trackAltarWrite,
} from '../../store/altarEdit';
import { usePersistedFlag } from '../../hooks/usePersistedFlag';
import { useDisplayedAltar } from '../../hooks/useDisplayedAltar';
import { getAltarBackgroundStyle, DEFAULT_ALTAR_RESOLUTION, parseResolution, isRatioFormat } from '../../lib/altarConstants';
import type { AltarItem, AltarRecord } from '../../types';
import Dashboard, { GroupDivider } from '../ui/Dashboard';
import { SortSelect } from '../ui/ListToolbar';
import { SwitchRow } from '../ui/Switch';
import ContextMenu from '../ui/ContextMenu';
import { ENTRY_TITLE_HEADING_CLASSES, ENTRY_TITLE_INPUT_CLASSES, EntryHeaderRow, EntryStatus } from '../ui/EntryDetailFrame';
import { formatEntryDate } from '../../lib/formatDate';
import Button from '../ui/Button';
import { AltarCanvas, captureCurrentAltar } from '../altar/AltarCanvas';
import { AltarLibraryStrip } from '../altar/AltarLibraryStrip';
import { AltarItemModal } from '../altar/AltarItemModal';
import { AltarLibrarySection } from '../altar/AltarLibrarySection';
import { AltarCard, AltarListRow, buildAltarContextMenuActions } from '../altar/AltarCard';
import { imageSrc } from '../../lib/images';
import { useSessionState } from '../../store/sessionStore';
import { createItem } from '../../lib/createItem';


export default function AltarView() {
  const { t } = useTranslation();
  const altars = useAltarStore((s) => s.altars);
  const activeAltarId = useAltarStore((s) => s.activeAltarId);
  const previewPlacements = useAltarStore((s) => s.previewPlacements);
  const { duplicateAltar, setActiveAltar, clearActiveAltar, updateAltar, deleteAltar, restoreAltar } = useAltarStore(
    useShallow((s) => ({
      duplicateAltar: s.duplicateAltar,
      setActiveAltar: s.setActiveAltar,
      clearActiveAltar: s.clearActiveAltar,
      updateAltar: s.updateAltar,
      deleteAltar: s.deleteAltar,
      restoreAltar: s.restoreAltar,
    })),
  );
  const activeView = useUIStore((s) => s.activeView);
  const setActiveView = useUIStore((s) => s.setActiveView);
  const rightSidebarOpen = useUIStore((s) => s.rightSidebarOpen);
  const altarPrefs = useUIStore((s) => s.altarPrefs);
  const setAltarPrefs = useUIStore((s) => s.setAltarPrefs);
  const altarWindowFullscreen = useUIStore((s) => s.altarWindowFullscreen);
  const setAltarWindowFullscreen = useUIStore((s) => s.setAltarWindowFullscreen);
  const altarShowPreview = useUIStore((s) => s.altarShowPreview);
  const setAltarShowPreview = useUIStore((s) => s.setAltarShowPreview);
  const libraryPrefs = useUIStore((s) => s.altarLibraryPrefs);
  const setLibraryPrefs = useUIStore((s) => s.setAltarLibraryPrefs);

  const allCategories = useCategoryStore((s) => s.categories);
  const pushUndo = useUndoStore((s) => s.push);

  const [search, setSearch] = useSessionState('altar.search', '');
  const [ctxMenu, setCtxMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  // Like the library below: the section can be collapsed, and that sticks —
  // the same preference, the same hook.
  const [altarsCollapsed, toggleAltars] = usePersistedFlag('altar-list-collapsed');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [title, setTitle] = useState('');
  // The library in the dashboard: the element modal lives here because its
  // button sits in the dashboard header.
  const [itemModal, setItemModal] = useState<{ item: AltarItem | null; categoryId: string | null } | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  // ref keeps ResizeObserver callback current without re-observing on fullscreen toggle
  const altarWindowFullscreenRef = useRef(altarWindowFullscreen);
  const [canvasTransform, setCanvasTransform] = useState<{ scale: number; offsetX: number; offsetY: number; nativeW: number; nativeH: number }>({ scale: 1, offsetX: 0, offsetY: 0, nativeW: 1920, nativeH: 1080 });
  // Set while "Done" or Cancel end the edit: its end then belongs to the
  // handler, and the teardown of the editing effect below (saving the title,
  // capturing the thumbnail) does nothing.
  const endingEditRef = useRef(false);
  /** Runs the end of the edit; the flag only drops after the commit so the teardown still sees it. */
  const endingEdit = async (run: () => Promise<void>) => {
    endingEditRef.current = true;
    try {
      await run();
    } finally {
      setTimeout(() => { endingEditRef.current = false; });
    }
  };

  // No refetch on mount: AppShell loads the altars at startup and on vault
  // switch; after that the store keeps itself up to date.

  // Must be placed BEFORE the activeView.id effect so that when both run in the same
  // commit (e.g. back-button press), getState() is called before clearActiveAltar().
  const isEditing = activeView.mode === 'edit';
  // The typed title, for the teardown below: its closure is as old as the effect.
  const titleRef = useRef('');
  useEffect(() => {
    if (!isEditing) return;
    return () => {
      if (endingEditRef.current) return;
      const { activeAltarId: altarId, altars: current, updateAltar: update } = useAltarStore.getState();
      if (!altarId) return;
      // Switched away without "Done" or Cancel (another tab): the title lives
      // only in this view and would go with it. The edit carries on, and
      // Cancel brings it back too (`altarEdit.ts`).
      const typed = titleRef.current.trim();
      const stored = current.find((altar) => altar.id === altarId)?.title;
      const titleChanged = !!typed && stored !== undefined && typed !== stored;
      // Without a change everything stays as it was — a new thumbnail would
      // push the altar up in the lists although nothing happened.
      if (!titleChanged && !altarEditChanged(altarId)) return;
      // Start the capture immediately: it reads the active altar from the
      // store, and after the first await that is already the next one.
      const capture = captureCurrentAltar();
      trackAltarWrite(altarId, (async () => {
        if (titleChanged) await update(altarId, { title: typed });
        const thumbnailData = await capture;
        // The image only follows — "Last modified" was already set by the change itself.
        if (thumbnailData !== null) await update(altarId, { thumbnail_data: thumbnailData }, AS_A_CONSEQUENCE);
      })().catch(console.error));
    };
    // Also when switching from one altar being edited to the next: the view
    // stays mounted and `isEditing` does not change.
  }, [isEditing, activeView.id]);

  // As a dependency below: an altar that comes back from the trash while the
  // view already points at it would otherwise never be loaded.
  const viewAltarExists = altars.some((altar) => altar.id === activeView.id);
  useEffect(() => {
    if (activeView.id) {
      if (activeView.id !== activeAltarId) {
        setActiveAltar(activeView.id).catch(console.error);
      }
    } else if (activeAltarId !== null) {
      clearActiveAltar();
    }
  }, [activeView.id, activeAltarId, viewAltarExists, setActiveAltar, clearActiveAltar]);

  // Without the comparison with the view, the dashboard would flash up first
  // when opening via a link — see useDisplayedAltar.
  const activeAltar = useDisplayedAltar();
  const isAltarLoading = !activeAltar && !!activeView.id && viewAltarExists;

  useEffect(() => {
    if (!activeAltar) return;
    setTitle(activeAltar.title);
  }, [activeAltar?.id, activeAltar?.title]);
  titleRef.current = title;

  // The state Cancel returns to — as soon as the altar is loaded and in edit mode.
  useEffect(() => {
    if (isEditing && activeAltar) void beginAltarEdit(activeAltar.id);
  }, [isEditing, activeAltar?.id]);

  useEffect(() => { altarWindowFullscreenRef.current = altarWindowFullscreen; }, [altarWindowFullscreen]);

  // Fullscreen applies to the one altar being viewed: editing, the dashboard
  // and any navigating away end it — otherwise the next altar visit (even the
  // dashboard, with no button to leave) would be in it again.
  useEffect(() => {
    if (altarWindowFullscreen && (isEditing || !activeAltar)) setAltarWindowFullscreen(false);
  }, [isEditing, activeAltar, altarWindowFullscreen, setAltarWindowFullscreen]);
  useEffect(() => () => useUIStore.getState().setAltarWindowFullscreen(false), []);

  useEffect(() => {
    if (!altarWindowFullscreen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAltarWindowFullscreen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [altarWindowFullscreen, setAltarWindowFullscreen]);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const res = activeAltar?.resolution ?? DEFAULT_ALTAR_RESOLUTION;
    const obs = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (isRatioFormat(res)) {
        const [rw, rh] = res.split(':').map(Number);
        const fitW = Math.min(width, height * rw / rh);
        const fitH = fitW * rh / rw;
        const nativeW = Math.round(fitW);
        const nativeH = Math.round(fitH);
        setCanvasTransform({ scale: 1, offsetX: (width - nativeW) / 2, offsetY: altarWindowFullscreenRef.current ? (height - nativeH) / 2 : 0, nativeW, nativeH });
      } else {
        const { w, h } = parseResolution(res);
        const s = Math.min(width / w, height / h);
        setCanvasTransform({ scale: s, offsetX: (width - w * s) / 2, offsetY: altarWindowFullscreenRef.current ? (height - h * s) / 2 : 0, nativeW: w, nativeH: h });
      }
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, [activeAltar?.id, activeAltar?.resolution]);

  const openNewElement = (categoryId?: string) =>
    setItemModal({ item: null, categoryId: categoryId ?? null });

  const handleNew = () => createItem('altar');

  const startRename = (altar: AltarRecord) => {
    setRenamingId(altar.id);
    setRenameValue(altar.title);
  };

  const commitRename = async () => {
    if (!renamingId || !renameValue.trim()) {
      setRenamingId(null);
      return;
    }
    await updateAltar(renamingId, { title: renameValue.trim() });
    setRenamingId(null);
  };

  const handleDelete = async (id: string) => {
    await deleteAltar(id);
    pushUndo({ id: generateId(), description: t('undo.altarDeleted'), undo: () => restoreAltar(id) });
    if (activeView.id === id) {
      setActiveView({ type: 'altar' });
    }
  };

  const handleDeleteActive = () => (activeAltar ? handleDelete(activeAltar.id) : undefined);

  const handleDuplicate = async (id: string) => {
    const altar = await duplicateAltar(id);
    // The activeView.id effect above loads the altar — as when clicking the card.
    if (altar) setActiveView({ type: 'altar', id: altar.id, mode: 'view' });
  };

  const handleDone = () => endingEdit(async () => {
    if (!activeAltar) return;
    const altarId = activeAltar.id;
    const capturePromise = captureCurrentAltar(); // start before any state changes
    endAltarEdit(altarId);
    setActiveView({ type: 'altar', id: altarId, mode: 'view' });
    const writes = (async () => {
      await updateAltar(altarId, { title: title.trim() });
      const thumbnailData = await capturePromise;
      if (thumbnailData !== null)
        await updateAltar(altarId, { thumbnail_data: thumbnailData }, AS_A_CONSEQUENCE);
    })().catch((err: unknown) => console.error('[handleDone]', err));
    // Whoever presses "Edit" again right away waits for it (`beginAltarEdit`).
    trackAltarWrite(altarId, writes);
    await writes;
  });

  const handleCancel = () => endingEdit(async () => {
    if (!activeAltar) return;
    const altarId = activeAltar.id;
    // An altar never confirmed with "Done" goes to the trash, like any deleted one.
    if (activeView.isNew) {
      await handleDelete(altarId).catch((err: unknown) => console.error('[handleCancel]', err));
      return;
    }
    // Back to the state on entering edit mode — the altar saved every action
    // immediately. The thumbnail comes back with that state; capturing a new
    // one would mean pushing the altar up in the lists.
    //
    // View first, then wait: the write-back grabs the remembered state
    // immediately, and in read mode nothing can be moved in the meantime.
    // Whoever clicks elsewhere right away ends up there.
    const restoring = restoreAltarEdit(altarId);
    setActiveView({ type: 'altar', id: altarId, mode: 'view' });
    try {
      await restoring;
    } catch (err) {
      // Show what is really in the database. The remembered state is still
      // there: "Edit" and Cancel once more finishes the job.
      console.error('[handleCancel]', err);
      await useAltarStore.getState().fetchAltars().catch(console.error);
    }
    // The typed title lives only here — back to the saved one, as long as
    // the view still shows this altar.
    if (useUIStore.getState().activeView.id !== altarId) return;
    const stored = useAltarStore.getState().altars.find((altar) => altar.id === altarId)?.title;
    if (stored !== undefined) setTitle(stored);
  });

  useEditActions(isEditing, {
    onSave: handleDone, onCancel: handleCancel, onDelete: handleDeleteActive,
    guard: activeAltar ? {
      key: guardKey('altar', activeAltar.id),
      title: () => title.trim() || activeAltar.title || t('altar.untitled'),
      isDirty: () => altarEditDirty(activeAltar.id, !!activeView.isNew, title),
    } : undefined,
  });

  const backgroundSrc = imageSrc(activeAltar?.background_image_data);

  // An empty frame for the one loading step — short enough that nothing
  // visible is needed, but just not the dashboard.
  if (isAltarLoading) return <div className="h-full" />;

  if (!activeAltar) {
    const filtered = search
      ? altars.filter((altar) => altar.title.toLowerCase().includes(search.toLowerCase()))
      : altars;

    const sorted = sortItems(filtered, altarPrefs.sort, { date: (a) => a.updated_at });

    const filteredCount = filtered.length;

    const renderAltarItem = (altar: AltarRecord) =>
      isCardView(altarPrefs.view) ? (
        <AltarCard
          altar={altar}
          previewItems={previewPlacements[altar.id] ?? []}
          showPreview={altarShowPreview}
          wide={isWideCardView(altarPrefs.view)}
          isRenaming={renamingId === altar.id}
          renameValue={renameValue}
          onChangeRename={setRenameValue}
          onCommitRename={commitRename}
          onCancelRename={() => setRenamingId(null)}
          onContextMenu={(event) => { event.preventDefault(); setCtxMenu({ id: altar.id, x: event.clientX, y: event.clientY }); }}
        />
      ) : (
        <AltarListRow
          altar={altar}
          previewItems={previewPlacements[altar.id] ?? []}
          showPreview={altarShowPreview}
          isRenaming={renamingId === altar.id}
          renameValue={renameValue}
          onChangeRename={setRenameValue}
          onCommitRename={commitRename}
          onCancelRename={() => setRenamingId(null)}
          onContextMenu={(event) => { event.preventDefault(); setCtxMenu({ id: altar.id, x: event.clientX, y: event.clientY }); }}
        />
      );

    // The library's controls sit with the rest of the dashboard header, not in
    // the content: in the same column as view and sorting of the altars, with
    // the same building blocks — and the library below stays pure content.
    // "Name · A → Z" here means the element name rather than the altar title;
    // the word stays.
    const libraryControls = (
      <>
        <SortSelect
          label={t('altar.sortLibrary')}
          value={libraryPrefs.sort}
          modes={ALTAR_LIBRARY_SORTS}
          onChange={(sort) => setLibraryPrefs({ sort })}
        />
        <SwitchRow
          icon={Layers}
          label={t('listView.groupBy', { label: t('listView.category') })}
          checked={libraryPrefs.grouping === 'grouped'}
          onChange={(on) => setLibraryPrefs({ grouping: on ? 'grouped' : 'flat' })}
        />
      </>
    );

    return (
      <>
      <Dashboard<AltarRecord>
        title={t('nav.altar')}
        primaryAction={{ label: t('altar.newAltar'), onClick: handleNew }}
        // "Element" is here instead of among the labelled actions: it belongs
        // to the library below the altars, not to the altars themselves, and
        // therefore sits next to them as an icon — the labelled spot stays
        // with the new altar.
        extraActions={[
          { label: t('altar.addElement'), icon: <PackagePlus size={14} />, onClick: () => openNewElement() },
        ]}
        view={altarPrefs.view}
        sort={altarPrefs.sort}
        sortDate="updated"
        sortLabel={t('altar.sortAltars')}
        onView={(next) => setAltarPrefs({ view: next })}
        onSort={(next) => setAltarPrefs({ sort: next })}
        search={search}
        onSearch={setSearch}
        // Only a display toggle, not a filter: it does not count as an active
        // filter, and there is nothing to reset.
        filters={{
          activeFilterCount: 0,
          panelProps: {
            displayToggles: [{
              label: t('altar.showPreview'),
              icon: AltarIcon,
              checked: altarShowPreview,
              onChange: setAltarShowPreview,
            }],
            extraGroups: [{ label: t('altar.sortLibrary'), content: libraryControls }],
          },
        }}
        // Collapsed means an empty list instead of a special branch: the empty
        // and the "No results" notice belong to the expanded section and must
        // not appear in place of the collapsed heading.
        items={altarsCollapsed ? [] : sorted}
        itemKey={(altar) => altar.id}
        renderItem={renderAltarItem}
        isEmpty={!altarsCollapsed && altars.length === 0}
        emptyState={{
          icon: MODULES.altar.icon,
          title: t('emptyState.altar.title'),
          description: t('emptyState.altar.description'),
          actionLabel: t('altar.newAltar'),
          onAction: handleNew,
        }}
        hasNoResults={!altarsCollapsed && filteredCount === 0}
        contentHeader={
          <GroupDivider
            // Plural, not t('nav.altar'): this is the heading above a list,
            // not a module name in the bar.
            label={t('altar.sectionTitle')}
            collapsed={altarsCollapsed}
            onToggleCollapse={toggleAltars}
          />
        }
        contentFooter={
          <AltarLibrarySection
            search={search}
            onNewElement={openNewElement}
            onEditElement={(item) => setItemModal({ item, categoryId: item.category_id })}
          />
        }
        grouping={
          altarPrefs.view === 'timeline' && !altarsCollapsed
            ? { mode: 'timeline', groups: groupByMonth(sorted, (a) => a.updated_at) }
            : { mode: 'flat' }
        }
        contextMenuSlot={ctxMenu && (
          <ContextMenu
            x={ctxMenu.x}
            y={ctxMenu.y}
            onClose={() => setCtxMenu(null)}
            actions={buildAltarContextMenuActions({
              t,
              altar: altars.find((a) => a.id === ctxMenu.id) ?? altars[0],
              onDuplicate: handleDuplicate,
              onRename: startRename,
              onDelete: handleDelete,
            })}
          />
        )}
      />
      {itemModal && (
        <AltarItemModal
          key={itemModal.item?.id ?? 'create'}
          item={itemModal.item}
          categories={allCategories}
          defaultCategory={itemModal.categoryId}
          onClose={() => setItemModal(null)}
        />
      )}
      </>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* As in EntryDetailFrame: above it, back to the altar dashboard and the
          date, while editing the status. */}
      {!altarWindowFullscreen && (
        <EntryHeaderRow
          inset="px-6"
          back={{ label: t('nav.altar'), onClick: () => setActiveView({ type: 'altar' }) }}
          meta={isEditing
            ? <EntryStatus tone="accent">{t('editor.editing')}</EntryStatus>
            : formatEntryDate(activeAltar.updated_at)}
        />
      )}

      {!altarWindowFullscreen && (
        <div className="px-6 pt-4 pb-4 border-b border-edge">
          {isEditing ? (
            <input
              autoFocus
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className={ENTRY_TITLE_INPUT_CLASSES}
              placeholder={t('altar.untitled')}
            />
          ) : (
            <h1 className={`${ENTRY_TITLE_HEADING_CLASSES} w-full`}>
              {activeAltar.title || t('altar.untitled')}
            </h1>
          )}
        </div>
      )}

      <div ref={viewportRef} className="flex-1 relative overflow-hidden min-h-0">
        {/* The fullscreen button sits at the top of the right sidebar.
            Floating here only where the bar is missing:
            in fullscreen (otherwise there would be no way back) and with
            the bar closed. */}
        {!isEditing && (altarWindowFullscreen || !rightSidebarOpen) && (
          <div className="absolute top-3 right-3 z-10">
            <Button
              onClick={() => setAltarWindowFullscreen(!altarWindowFullscreen)}
              tone="neutral"
              compact
              title={altarWindowFullscreen ? t('altar.exitWindowFullscreen') : t('altar.windowFullscreen')}
              aria-label={altarWindowFullscreen ? t('altar.exitWindowFullscreen') : t('altar.windowFullscreen')}
            >
              {altarWindowFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </Button>
          </div>
        )}
        <div style={{
          position: 'absolute',
          width: canvasTransform.nativeW,
          height: canvasTransform.nativeH,
          transformOrigin: '0 0',
          transform: `translate(${canvasTransform.offsetX}px, ${canvasTransform.offsetY}px) scale(${canvasTransform.scale})`,
        }}>
          <AltarCanvas
            altar={activeAltar}
            backgroundSrc={backgroundSrc}
            editable={isEditing}
            showGrid={activeAltar.grid_enabled}
            gridSize={activeAltar.grid_size}
            gridOpacity={activeAltar.grid_opacity}
            gridColor={activeAltar.grid_color}
            snapToGrid={activeAltar.snap_to_grid}
            rotationSnapEnabled={activeAltar.rotation_snap_enabled}
            rotationSnapAngle={activeAltar.rotation_snap_angle}
            snapScaleToGrid={activeAltar.snap_scale_to_grid}
            resolution={activeAltar.resolution}
            nativeW={canvasTransform.nativeW}
            nativeH={canvasTransform.nativeH}
            cssScale={canvasTransform.scale}
            getBackgroundStyle={getAltarBackgroundStyle}
          />
        </div>
      </div>

      {isEditing && !altarWindowFullscreen && <AltarLibraryStrip editable={isEditing} />}
    </div>
  );
}
