import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/shallow';
import { Flame, Maximize2, Minimize2, PackagePlus } from 'lucide-react';
import { formatEntryDate } from '../../lib/formatDate';
import { sortItems } from '../../lib/sortItems';
import { isCardView, isWideCardView } from '../../lib/viewMode';
import { groupByMonth } from '../../lib/groupBy';
import { useAltarStore } from '../../store/altarStore';
import { useCategoryStore } from '../../store/categoryStore';
import { useUIStore, ALTAR_LIBRARY_SORTS } from '../../store/uiStore';
import { useEditActions } from '../../hooks/useEditActions';
import { usePersistedFlag } from '../../hooks/usePersistedFlag';
import { getAltarBackgroundStyle, DEFAULT_ALTAR_RESOLUTION, parseResolution, isRatioFormat } from '../../lib/altarConstants';
import type { AltarItem, AltarRecord } from '../../types';
import Dashboard, { GroupDivider } from '../ui/Dashboard';
import IconToggleGroup from '../ui/IconToggleGroup';
import { GROUPING_ICONS, SORT_ICONS } from '../ui/ListToolbar';
import { FilterChipButton } from '../ui/FilterPanel';
import ContextMenu from '../ui/ContextMenu';
import Button from '../ui/Button';
import { AltarCanvas, captureCurrentAltar } from '../altar/AltarCanvas';
import { AltarLibraryStrip } from '../altar/AltarLibraryStrip';
import { AltarItemModal } from '../altar/AltarItemModal';
import { AltarLibrarySection } from '../altar/AltarLibrarySection';
import { AltarCard, AltarListRow, buildAltarContextMenuActions } from '../altar/AltarCard';
import { imageSrc } from '../../lib/images';
import type { AltarLibrarySort } from '../../store/uiStore';

/** Dieselben Beschriftungen wie die Toolbar-Sortierung — „A → Z" meint in der
 *  Bibliothek nur den Elementnamen statt den Altartitel, das Wort bleibt. */
const LIBRARY_SORT_LABEL_KEYS: Record<AltarLibrarySort, string> = {
  alpha_asc: 'listView.alphaAsc',
  alpha_desc: 'listView.alphaDesc',
  date_desc: 'listView.dateDesc',
};



export default function AltarView() {
  const { t } = useTranslation();
  const altars = useAltarStore((s) => s.altars);
  const activeAltarId = useAltarStore((s) => s.activeAltarId);
  const previewPlacements = useAltarStore((s) => s.previewPlacements);
  const { createAltar, duplicateAltar, setActiveAltar, clearActiveAltar, updateAltar, deleteAltar } = useAltarStore(
    useShallow((s) => ({
      createAltar: s.createAltar,
      duplicateAltar: s.duplicateAltar,
      setActiveAltar: s.setActiveAltar,
      clearActiveAltar: s.clearActiveAltar,
      updateAltar: s.updateAltar,
      deleteAltar: s.deleteAltar,
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

  const [search, setSearch] = useState('');
  const [ctxMenu, setCtxMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  // Wie die Bibliothek darunter: der Abschnitt lässt sich zuklappen, und das
  // bleibt so — dieselbe Vorliebe, derselbe Hook.
  const [altarsCollapsed, toggleAltars] = usePersistedFlag('altar-list-collapsed');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [title, setTitle] = useState('');
  // Die Bibliothek im Dashboard: das Element-Modal wohnt hier, weil sein Knopf
  // in der Dashboard-Kopfzeile sitzt.
  const [itemModal, setItemModal] = useState<{ item: AltarItem | null; categoryId: string | null } | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  // ref keeps ResizeObserver callback current without re-observing on fullscreen toggle
  const altarWindowFullscreenRef = useRef(altarWindowFullscreen);
  const [canvasTransform, setCanvasTransform] = useState<{ scale: number; offsetX: number; offsetY: number; nativeW: number; nativeH: number }>({ scale: 1, offsetX: 0, offsetY: 0, nativeW: 1920, nativeH: 1080 });
  // Set to true while handleDone/handleCancel are running their own capture so the
  // isEditing cleanup effect doesn't fire a redundant second capture.
  const thumbnailSavingRef = useRef(false);

  // Kein Refetch beim Mount: AppShell laedt die Altaere beim Start und beim
  // Vault-Wechsel; danach haelt der Store sich selbst aktuell.

  // Must be placed BEFORE the activeView.id effect so that when both run in the same
  // commit (e.g. back-button press), getState() is called before clearActiveAltar().
  const isEditing = activeView.mode === 'edit';
  useEffect(() => {
    if (!isEditing) return;
    return () => {
      if (thumbnailSavingRef.current) return; // handleDone / handleCancel already owns it
      const altarId = useAltarStore.getState().activeAltarId;
      if (!altarId) return;
      captureCurrentAltar()
        .then((thumbnailData) => {
          if (thumbnailData !== null)
            useAltarStore.getState().updateAltar(altarId, { thumbnail_data: thumbnailData });
        })
        .catch(console.error);
    };
  }, [isEditing]);

  useEffect(() => {
    if (activeView.id) {
      if (activeView.id !== activeAltarId) {
        setActiveAltar(activeView.id).catch(console.error);
      }
    } else if (activeAltarId !== null) {
      clearActiveAltar();
    }
  }, [activeView.id, activeAltarId, setActiveAltar, clearActiveAltar]);

  const activeAltar = altars.find((altar) => altar.id === activeAltarId) ?? null;

  useEffect(() => {
    if (!activeAltar) return;
    setTitle(activeAltar.title);
  }, [activeAltar?.id, activeAltar?.title]);

  useEffect(() => { altarWindowFullscreenRef.current = altarWindowFullscreen; }, [altarWindowFullscreen]);

  useEffect(() => {
    if (isEditing && altarWindowFullscreen) setAltarWindowFullscreen(false);
  }, [isEditing, altarWindowFullscreen, setAltarWindowFullscreen]);

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

  const handleNew = async () => {
    const altar = await createAltar();
    setActiveView({ type: 'altar', id: altar.id, mode: 'edit', isNew: true });
  };

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
    if (activeView.id === id) {
      setActiveView({ type: 'altar' });
    }
  };

  const handleDeleteActive = () => {
    if (!activeAltar) return;
    handleDelete(activeAltar.id);
  };

  const handleDuplicate = async (id: string) => {
    const altar = await duplicateAltar(id);
    // Den Altar lädt der activeView.id-Effekt oben — wie beim Klick auf die Karte.
    if (altar) setActiveView({ type: 'altar', id: altar.id, mode: 'view' });
  };

  const handleDone = async () => {
    if (!activeAltar) return;
    thumbnailSavingRef.current = true;
    const altarId = activeAltar.id;
    const capturePromise = captureCurrentAltar(); // start before any state changes
    setActiveView({ type: 'altar', id: altarId, mode: 'view' });
    try {
      await updateAltar(altarId, { title: title.trim() || t('altar.untitled') });
      const thumbnailData = await capturePromise;
      if (thumbnailData !== null)
        await updateAltar(altarId, { thumbnail_data: thumbnailData });
    } catch (err) {
      console.error('[handleDone]', err);
    } finally {
      thumbnailSavingRef.current = false;
    }
  };

  const handleCancel = async () => {
    if (!activeAltar) return;
    // Ein nie mit „Fertig" bestätigter Altar wird beim Abbrechen verworfen —
    // er sollte nie existieren. Kein Thumbnail-Capture für einen Altar, den es
    // gleich nicht mehr gibt; das Flag hält den isEditing-Cleanup-Effekt davon
    // ab (gleiches Muster wie handleDone: erst navigieren, Flag erst nach den
    // Awaits zurücksetzen, damit der Cleanup beim Commit es noch gesetzt sieht).
    if (activeView.isNew) {
      thumbnailSavingRef.current = true;
      const altarId = activeAltar.id;
      setActiveView({ type: 'altar' });
      // Sofort selbst löschen statt es dem activeView.id-Effekt zu überlassen:
      // deleteAltar würde sonst je nach Flush-Reihenfolge für einen Frame den
      // nächstbesten Altar aktiv setzen.
      clearActiveAltar();
      try {
        await deleteAltar(altarId);
      } catch (err) {
        console.error('[handleCancel]', err);
      } finally {
        thumbnailSavingRef.current = false;
      }
      return;
    }
    thumbnailSavingRef.current = true;
    const altarId = activeAltar.id;
    setTitle(activeAltar.title);
    const capturePromise = captureCurrentAltar(); // start before navigation
    setActiveView({ type: 'altar', id: altarId, mode: 'view' });
    try {
      const thumbnailData = await capturePromise;
      if (thumbnailData !== null)
        await updateAltar(altarId, { thumbnail_data: thumbnailData });
    } catch (err) {
      console.error('[handleCancel]', err);
    } finally {
      thumbnailSavingRef.current = false;
    }
  };

  useEditActions(isEditing, { onSave: handleDone, onCancel: handleCancel, onDelete: handleDeleteActive });

  const backgroundSrc = imageSrc(activeAltar?.background_image_data);

  if (!activeAltar) {
    const filtered = search
      ? altars.filter((altar) =>
          altar.title.toLowerCase().includes(search.toLowerCase()) ||
          altar.intention.toLowerCase().includes(search.toLowerCase())
        )
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

    // Die Regler der Bibliothek stehen beim übrigen Dashboard-Kopf, nicht im
    // Inhalt: im Seitenleisten-Modus landen sie damit in derselben Spalte wie
    // Suche, Ansicht und Sortierung — und die Bibliothek darunter bleibt der
    // reine Inhalt.
    // Dieselben Segment-Reihen wie Ansicht und Sortierung im Kopf darüber:
    // die Regler stehen in derselben schmalen Spalte und sollen sich gleich
    // bedienen lassen. Die Beschriftungen wandern in title/aria-label.
    const libraryControls = (
      <>
        <IconToggleGroup
          label={t('listView.sort')}
          options={ALTAR_LIBRARY_SORTS.map((value) => ({ value, label: t(LIBRARY_SORT_LABEL_KEYS[value]) }))}
          icons={SORT_ICONS}
          value={libraryPrefs.sort}
          onChange={(sort) => setLibraryPrefs({ sort })}
        />
        <IconToggleGroup
          label={t('listView.grouping')}
          options={[
            { value: 'grouped' as const, label: t('listView.category') },
            { value: 'flat' as const, label: t('listView.ungrouped') },
          ]}
          icons={GROUPING_ICONS}
          value={libraryPrefs.grouping}
          onChange={(grouping) => setLibraryPrefs({ grouping })}
        />
      </>
    );

    return (
      <>
      <Dashboard<AltarRecord>
        title={t('nav.altar')}
        primaryAction={{ label: t('altar.newAltar'), onClick: handleNew }}
        // „Element" steht hier statt bei den Aktionen mit Beschriftung: es
        // gehört zur Bibliothek unter den Altären, nicht zu den Altären selbst,
        // und steht darum als Icon daneben — der beschriftete Platz bleibt
        // dem neuen Altar.
        extraActions={[
          { label: t('altar.addElement'), icon: <PackagePlus size={14} />, onClick: () => openNewElement() },
        ]}
        view={altarPrefs.view}
        sort={altarPrefs.sort}
        onView={(next) => setAltarPrefs({ view: next })}
        onSort={(next) => setAltarPrefs({ sort: next })}
        search={search}
        onSearch={setSearch}
        // Nur ein Anzeige-Schalter, kein Filter: er zählt nicht als aktiver
        // Filter, und es gibt nichts zu „Alle löschen".
        filters={{
          activeFilterCount: 0,
          panelProps: {
            displayExtras: (
              <FilterChipButton active={altarShowPreview} onClick={() => setAltarShowPreview(!altarShowPreview)}>
                <Flame size={12} />
                {t('altar.showPreview')}
              </FilterChipButton>
            ),
            extraGroups: [{ label: t('altar.libraryTitle'), content: libraryControls }],
          },
        }}
        // Zugeklappt eine leere Liste statt eines Sonderzweigs: der Leer- und
        // der „Keine Ergebnisse"-Hinweis gehören zum ausgeklappten Abschnitt
        // und dürfen nicht anstelle der zugeklappten Überschrift stehen.
        items={altarsCollapsed ? [] : sorted}
        itemKey={(altar) => altar.id}
        renderItem={renderAltarItem}
        isEmpty={!altarsCollapsed && altars.length === 0}
        emptyState={{ message: t('altar.none'), actionLabel: t('altar.start'), onAction: handleNew }}
        hasNoResults={!altarsCollapsed && filteredCount === 0}
        noResultsMessage={t('search.noResults')}
        contentHeader={
          <GroupDivider
            // Mehrzahl, nicht t('nav.altar'): das ist die Überschrift über
            // einer Liste, kein Modulname in der Leiste.
            label={t('altar.sectionTitle')}
            count={filteredCount}
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
      <div className="flex items-center justify-between px-6 h-14 border-b border-stone-700/60 flex-shrink-0">
        <div className="flex items-center gap-2 text-xs text-stone-600">
          <button onClick={() => setActiveView({ type: 'altar' })} className="text-stone-500 transition-colors hover:text-stone-300">
            {t('nav.altar')}
          </button>
          <span>{formatEntryDate(activeAltar.updated_at)}</span>
        </div>
        <div className="flex items-center gap-1">
          {isEditing ? null : (
            <>
              {altarWindowFullscreen ? (
                <Button
                  onClick={() => setAltarWindowFullscreen(false)}
                  variant="ghost"
                  title={t('altar.exitWindowFullscreen')}
                >
                  <Minimize2 size={15} />
                </Button>
              ) : !rightSidebarOpen && (
                <Button
                  onClick={() => setAltarWindowFullscreen(true)}
                  variant="ghost"
                  title={t('altar.windowFullscreen')}
                >
                  <Maximize2 size={15} />
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      {!altarWindowFullscreen && (
        <div className="px-6 pt-6 pb-4 border-b border-stone-700/30">
          {isEditing ? (
            <input
              autoFocus
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="entry-view-title w-full bg-transparent text-2xl font-semibold text-stone-100 placeholder-stone-700 outline-none selectable"
              placeholder={t('altar.untitled')}
            />
          ) : (
            <h1 className="entry-view-title w-full text-2xl font-semibold text-stone-100">
              {activeAltar.title || t('altar.untitled')}
            </h1>
          )}
        </div>
      )}

      <div ref={viewportRef} className="flex-1 relative overflow-hidden min-h-0">
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
