import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/shallow';
import { Flame, Layers, Maximize2, Minimize2, PackagePlus } from 'lucide-react';
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


export default function AltarView() {
  const { t } = useTranslation();
  const altars = useAltarStore((s) => s.altars);
  const activeAltarId = useAltarStore((s) => s.activeAltarId);
  const previewPlacements = useAltarStore((s) => s.previewPlacements);
  const { createAltar, duplicateAltar, setActiveAltar, clearActiveAltar, updateAltar, deleteAltar, restoreAltar } = useAltarStore(
    useShallow((s) => ({
      createAltar: s.createAltar,
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
  // Gesetzt, während „Fertig" oder Cancel die Bearbeitung beenden:
  // ihr Ende gehört dann dem Handler, und der Abbau des Bearbeiten-Effekts
  // unten (Titel sichern, Vorschaubild aufnehmen) tut nichts.
  const endingEditRef = useRef(false);
  /** Führt das Ende der Bearbeitung aus; das Flag fällt erst nach dem Commit, damit der Abbau es noch sieht. */
  const endingEdit = async (run: () => Promise<void>) => {
    endingEditRef.current = true;
    try {
      await run();
    } finally {
      setTimeout(() => { endingEditRef.current = false; });
    }
  };

  // Kein Refetch beim Mount: AppShell laedt die Altaere beim Start und beim
  // Vault-Wechsel; danach haelt der Store sich selbst aktuell.

  // Must be placed BEFORE the activeView.id effect so that when both run in the same
  // commit (e.g. back-button press), getState() is called before clearActiveAltar().
  const isEditing = activeView.mode === 'edit';
  // Der getippte Titel, für den Abbau unten: dessen Closure ist so alt wie der Effekt.
  const titleRef = useRef('');
  useEffect(() => {
    if (!isEditing) return;
    return () => {
      if (endingEditRef.current) return;
      const { activeAltarId: altarId, altars: current, updateAltar: update } = useAltarStore.getState();
      if (!altarId) return;
      // Weggeschaltet, ohne „Fertig" oder Cancel (ein anderer Tab): der Titel
      // lebt nur in dieser View und ginge mit ihr. Die Bearbeitung läuft
      // weiter, und Cancel holt auch ihn zurück (`altarEdit.ts`).
      const typed = titleRef.current.trim();
      const stored = current.find((altar) => altar.id === altarId)?.title;
      const titleChanged = !!typed && stored !== undefined && typed !== stored;
      // Ohne Änderung bleibt alles, wie es war — ein neues Vorschaubild schöbe
      // den Altar in den Listen nach oben, obwohl nichts geschah.
      if (!titleChanged && !altarEditChanged(altarId)) return;
      // Die Aufnahme sofort beginnen: sie liest den aktiven Altar aus dem
      // Store, und nach dem ersten await ist das schon der nächste.
      const capture = captureCurrentAltar();
      trackAltarWrite(altarId, (async () => {
        if (titleChanged) await update(altarId, { title: typed });
        const thumbnailData = await capture;
        // Das Bild folgt nur — „Zuletzt geändert" hat die Änderung selbst schon gestellt.
        if (thumbnailData !== null) await update(altarId, { thumbnail_data: thumbnailData }, AS_A_CONSEQUENCE);
      })().catch(console.error));
    };
    // Auch beim Wechsel von einem Altar im Bearbeiten zum nächsten: die View
    // bleibt dabei montiert, und `isEditing` ändert sich nicht.
  }, [isEditing, activeView.id]);

  // Als Abhängigkeit unten: ein Altar, der aus dem Papierkorb zurückkommt,
  // während die Ansicht schon auf ihn zeigt, wird sonst nie geladen.
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

  // Ohne den Abgleich mit der Ansicht blitzte beim Öffnen per Link erst das
  // Dashboard auf — siehe useDisplayedAltar.
  const activeAltar = useDisplayedAltar();
  const isAltarLoading = !activeAltar && !!activeView.id && viewAltarExists;

  useEffect(() => {
    if (!activeAltar) return;
    setTitle(activeAltar.title);
  }, [activeAltar?.id, activeAltar?.title]);
  titleRef.current = title;

  // Der Stand, zu dem Cancel zurückkehrt — sobald der Altar geladen im Bearbeiten steht.
  useEffect(() => {
    if (isEditing && activeAltar) void beginAltarEdit(activeAltar.id);
  }, [isEditing, activeAltar?.id]);

  useEffect(() => { altarWindowFullscreenRef.current = altarWindowFullscreen; }, [altarWindowFullscreen]);

  // Vollbild gilt dem einen Altar im Lesen: Bearbeiten, das Dashboard und
  // jedes Wegnavigieren beenden es — sonst stünde der nächste Altar-Besuch
  // (auch das Dashboard, ohne Knopf zum Verlassen) wieder darin.
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
    pushUndo({ id: generateId(), description: t('undo.altarDeleted'), undo: () => restoreAltar(id) });
    if (activeView.id === id) {
      setActiveView({ type: 'altar' });
    }
  };

  const handleDeleteActive = () => (activeAltar ? handleDelete(activeAltar.id) : undefined);

  const handleDuplicate = async (id: string) => {
    const altar = await duplicateAltar(id);
    // Den Altar lädt der activeView.id-Effekt oben — wie beim Klick auf die Karte.
    if (altar) setActiveView({ type: 'altar', id: altar.id, mode: 'view' });
  };

  const handleDone = () => endingEdit(async () => {
    if (!activeAltar) return;
    const altarId = activeAltar.id;
    const capturePromise = captureCurrentAltar(); // start before any state changes
    endAltarEdit(altarId);
    setActiveView({ type: 'altar', id: altarId, mode: 'view' });
    const writes = (async () => {
      await updateAltar(altarId, { title: title.trim() || t('altar.untitled') });
      const thumbnailData = await capturePromise;
      if (thumbnailData !== null)
        await updateAltar(altarId, { thumbnail_data: thumbnailData }, AS_A_CONSEQUENCE);
    })().catch((err: unknown) => console.error('[handleDone]', err));
    // Wer gleich wieder „Bearbeiten" drückt, wartet darauf (`beginAltarEdit`).
    trackAltarWrite(altarId, writes);
    await writes;
  });

  const handleCancel = () => endingEdit(async () => {
    if (!activeAltar) return;
    const altarId = activeAltar.id;
    // Ein nie mit „Fertig" bestätigter Altar geht, wie jeder gelöschte, in den Papierkorb.
    if (activeView.isNew) {
      await handleDelete(altarId).catch((err: unknown) => console.error('[handleCancel]', err));
      return;
    }
    // Zurück auf den Stand beim Betreten des Bearbeitens — der Altar hat jede
    // Handlung sofort gespeichert. Das Vorschaubild kommt mit dem Stand
    // zurück; ein neues aufzunehmen hieße, ihn in den Listen nach oben zu schieben.
    //
    // Erst die Ansicht, dann warten: das Zurückschreiben greift sich den
    // gemerkten Stand sofort, und im Lesemodus kann währenddessen nichts mehr
    // verschoben werden. Wer gleich woanders hinklickt, kommt dort an.
    const restoring = restoreAltarEdit(altarId);
    setActiveView({ type: 'altar', id: altarId, mode: 'view' });
    try {
      await restoring;
    } catch (err) {
      // Zeigen, was wirklich in der Datenbank steht. Der gemerkte Stand ist
      // noch da: „Bearbeiten" und noch einmal Cancel bringt es zu Ende.
      console.error('[handleCancel]', err);
      await useAltarStore.getState().fetchAltars().catch(console.error);
    }
    // Der getippte Titel lebt nur hier — zurück auf den gespeicherten, solange
    // die Ansicht noch diesen Altar zeigt.
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

  // Leerer Rahmen für den einen Ladeschritt — kurz genug, dass nichts
  // Sichtbares nötig ist, aber eben nicht das Dashboard.
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

    // Die Regler der Bibliothek stehen beim übrigen Dashboard-Kopf, nicht im
    // Inhalt: in derselben Spalte wie Ansicht und Sortierung der Altäre, mit
    // denselben Bausteinen — und die Bibliothek darunter bleibt der reine
    // Inhalt. „Name · A → Z" meint hier den Elementnamen statt des
    // Altartitels, das Wort bleibt.
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
        // „Element" steht hier statt bei den Aktionen mit Beschriftung: es
        // gehört zur Bibliothek unter den Altären, nicht zu den Altären selbst,
        // und steht darum als Icon daneben — der beschriftete Platz bleibt
        // dem neuen Altar.
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
        // Nur ein Anzeige-Schalter, kein Filter: er zählt nicht als aktiver
        // Filter, und es gibt nichts zurückzusetzen.
        filters={{
          activeFilterCount: 0,
          panelProps: {
            displayToggles: [{
              label: t('altar.showPreview'),
              icon: Flame,
              checked: altarShowPreview,
              onChange: setAltarShowPreview,
            }],
            extraGroups: [{ label: t('altar.sortLibrary'), content: libraryControls }],
          },
        }}
        // Zugeklappt eine leere Liste statt eines Sonderzweigs: der Leer- und
        // der „Keine Ergebnisse"-Hinweis gehören zum ausgeklappten Abschnitt
        // und dürfen nicht anstelle der zugeklappten Überschrift stehen.
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
            // Mehrzahl, nicht t('nav.altar'): das ist die Überschrift über
            // einer Liste, kein Modulname in der Leiste.
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
      {/* Wie in EntryDetailFrame: darueber zurueck zum Altar-Dashboard und das
          Datum, im Bearbeiten der Status. */}
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
        <div className="px-6 pt-4 pb-4 border-b border-stone-700/30">
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
        {/* Der Vollbild-Knopf steht oben in der rechten Seitenleiste.
            Schwebend hier nur, wo die Leiste fehlt:
            im Vollbild (sonst gaebe es keinen Weg zurueck) und bei
            geschlossener Leiste. */}
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
