import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Copy, Maximize2, Minimize2, PanelRightOpen, Pencil, Plus, Trash2, X } from 'lucide-react';
import { format } from 'date-fns';
import { useAltarStore } from '../../store/altarStore';
import { useUIStore } from '../../store/uiStore';
import { ALTAR_BACKGROUND_PRESETS, ALTAR_BACKGROUND_STYLES, DEFAULT_ALTAR_BACKGROUND } from '../../lib/altarConstants';
import type { AltarRecord } from '../../types';
import ListToolbar from '../ui/ListToolbar';
import ContextMenu from '../ui/ContextMenu';
import { AltarItemVisual } from '../altar/AltarItemVisual';
import { AltarCanvas } from '../altar/AltarCanvas';
import { AltarLibraryStrip } from '../altar/AltarLibraryStrip';
import { useAltarPreviewMap } from '../altar/useAltarBackgroundPreview';

function getAltarBackgroundStyleWithImage(altar: AltarRecord | null, imageSrc: string | null | undefined): string {
  if (!altar) return ALTAR_BACKGROUND_STYLES[DEFAULT_ALTAR_BACKGROUND];
  if (imageSrc?.startsWith('data:')) {
    return `linear-gradient(rgba(10, 10, 15, 0.35), rgba(10, 10, 15, 0.55)), url("${imageSrc}") center / cover no-repeat`;
  }
  const preset = ALTAR_BACKGROUND_PRESETS.includes(altar.background_preset as (typeof ALTAR_BACKGROUND_PRESETS)[number])
    ? altar.background_preset as (typeof ALTAR_BACKGROUND_PRESETS)[number]
    : DEFAULT_ALTAR_BACKGROUND;
  return ALTAR_BACKGROUND_STYLES[preset];
}

function AltarRenameField({ value, onChange, onCommit, onCancel, className }: {
  value: string;
  onChange: (value: string) => void;
  onCommit: () => void;
  onCancel: () => void;
  className: string;
}) {
  return (
    <input
      autoFocus
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onBlur={onCommit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onCommit();
        if (event.key === 'Escape') onCancel();
      }}
      className={className}
    />
  );
}

export default function AltarView() {
  const { t } = useTranslation();
  const {
    altars,
    activeAltarId,
    placements,
    previewPlacements,
    fetchAltars,
    createAltar,
    duplicateAltar,
    setActiveAltar,
    updateAltar,
    deleteAltar,
  } = useAltarStore();
  const activeView = useUIStore((s) => s.activeView);
  const setActiveView = useUIStore((s) => s.setActiveView);
  const toggleRightSidebar = useUIStore((s) => s.toggleRightSidebar);
  const altarPrefs = useUIStore((s) => s.altarPrefs);
  const setAltarPrefs = useUIStore((s) => s.setAltarPrefs);
  const altarCanvasGrid = useUIStore((s) => s.altarCanvasGrid);
  const altarCanvasGridSize = useUIStore((s) => s.altarCanvasGridSize);
  const altarCanvasGridOpacity = useUIStore((s) => s.altarCanvasGridOpacity);
  const altarCanvasGridColor = useUIStore((s) => s.altarCanvasGridColor);
  const altarSnapToGrid = useUIStore((s) => s.altarSnapToGrid);
  const altarWindowFullscreen = useUIStore((s) => s.altarWindowFullscreen);
  const setAltarWindowFullscreen = useUIStore((s) => s.setAltarWindowFullscreen);

  const [search, setSearch] = useState('');
  const [ctxMenu, setCtxMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [title, setTitle] = useState('');
  const backgroundPreviewMap = useAltarPreviewMap(altars);

  useEffect(() => { fetchAltars(); }, [fetchAltars]);
  useEffect(() => {
    if (activeView.id && activeView.id !== activeAltarId) {
      setActiveAltar(activeView.id).catch(console.error);
    }
  }, [activeView.id, activeAltarId, setActiveAltar]);

  const activeAltar = altars.find((altar) => altar.id === activeAltarId) ?? null;
  const isEditing = activeView.mode === 'edit';

  useEffect(() => {
    if (!activeAltar) return;
    setTitle(activeAltar.title);
  }, [activeAltar?.id, activeAltar?.title]);

  useEffect(() => {
    if (isEditing && altarWindowFullscreen) setAltarWindowFullscreen(false);
  }, [isEditing, altarWindowFullscreen, setAltarWindowFullscreen]);

  const handleNew = async () => {
    const altar = await createAltar();
    setActiveView({ type: 'altar', id: altar.id });
  };

  const openAltar = async (altar: AltarRecord) => {
    await setActiveAltar(altar.id);
    setActiveView({ type: 'altar', id: altar.id });
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

  const handleDuplicate = async (id: string) => {
    const altar = await duplicateAltar(id);
    if (!altar) return;
    await openAltar(altar);
  };

  const enterEditMode = () => {
    if (!activeAltar || isEditing) return;
    setActiveView({ type: 'altar', id: activeAltar.id, mode: 'edit' });
  };

  const handleDone = async () => {
    if (!activeAltar) return;
    await updateAltar(activeAltar.id, { title: title.trim() || t('altar.untitled') });
    setActiveView({ type: 'altar', id: activeAltar.id, mode: 'view' });
  };

  const handleCancel = () => {
    if (!activeAltar) return;
    setTitle(activeAltar.title);
    setActiveView({ type: 'altar', id: activeAltar.id, mode: 'view' });
  };

  const getPreviewSrc = (altar: AltarRecord) => {
    if (!altar.background_image_data) return null;
    if (altar.background_image_data.startsWith('data:')) return altar.background_image_data;
    return backgroundPreviewMap[altar.background_image_data] ?? null;
  };

  const renderPreviewScene = (altar: AltarRecord, compact = false) => {
    const previewItems = previewPlacements[altar.id] ?? [];
    return (
      <div
        className={`relative overflow-hidden rounded-lg border border-stone-700/40 ${compact ? 'h-8 w-8' : 'h-36 w-full'}`}
        style={{ background: getAltarBackgroundStyleWithImage(altar, getPreviewSrc(altar)) }}
      >
        <div className="absolute bottom-[28%] left-[8%] right-[8%] h-px bg-gradient-to-r from-transparent via-stone-700/50 to-transparent pointer-events-none" />
        <div className="absolute bottom-[26%] left-[12%] right-[12%] h-px bg-gradient-to-r from-transparent via-stone-800/30 to-transparent pointer-events-none" />
        {previewItems.slice(0, compact ? 1 : 7).map((placement) => {
          const size = compact
            ? 16
            : Math.max(16, Math.min(52, Math.round((placement.width ?? 8) * 2)));
          return (
            <div
              key={placement.id}
              className="absolute flex items-center justify-center"
              style={{
                left: `${placement.x}%`,
                top: `${placement.y}%`,
                transform: 'translate(-50%, -50%)',
                width: size,
                height: size,
              }}
            >
              <AltarItemVisual item={placement} size={size} candleAnimate={placement.category === 'candle'} />
            </div>
          );
        })}
      </div>
    );
  };

  if (!activeAltar) {
    const filtered = search
      ? altars.filter((altar) =>
          altar.title.toLowerCase().includes(search.toLowerCase()) ||
          altar.intention.toLowerCase().includes(search.toLowerCase())
        )
      : altars;

    const sorted = [...filtered].sort((a, b) => {
      const sort = altarPrefs.sort;
      if (sort === 'alpha_asc') return a.title.localeCompare(b.title);
      if (sort === 'alpha_desc') return b.title.localeCompare(a.title);
      if (sort === 'date_asc') return a.updated_at.localeCompare(b.updated_at);
      return b.updated_at.localeCompare(a.updated_at);
    });

    const grouped = altarPrefs.view === 'timeline'
      ? Array.from(
          sorted.reduce((map, altar) => {
            const label = format(new Date(altar.updated_at), 'MMMM yyyy');
            if (!map.has(label)) map.set(label, []);
            map.get(label)!.push(altar);
            return map;
          }, new Map<string, AltarRecord[]>())
        )
      : [['', sorted] as const];

    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between px-8 h-14 border-b border-stone-700/60">
          <h1 className="text-lg font-semibold text-stone-100">{t('nav.altar')}</h1>
          <div className="flex items-center gap-1">
            <button onClick={handleNew} className="btn-primary">
              <Plus size={13} />{t('altar.newAltar')}
            </button>
            <button onClick={toggleRightSidebar} className="btn-ghost ml-1">
              <PanelRightOpen size={16} />
            </button>
          </div>
        </div>

        <ListToolbar
          view={altarPrefs.view}
          sort={altarPrefs.sort}
          onView={(next) => setAltarPrefs({ view: next })}
          onSort={(next) => setAltarPrefs({ sort: next === 'category' ? 'date_desc' : next })}
          search={search}
          onSearch={setSearch}
        />

        <div className="flex-1 overflow-y-auto px-8 py-6">
          {altars.length === 0 ? (
            <div className="text-center py-20">
              <p className="text-stone-600 text-sm">{t('altar.none')}</p>
              <button onClick={handleNew} className="mt-4 text-xs text-stone-500 hover:text-stone-300 underline transition-colors">
                {t('altar.start')}
              </button>
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-center py-20 text-stone-600 text-sm">{t('search.noResults')}</p>
          ) : (
            <div className="space-y-6">
              {grouped.map(([label, items]) => (
                <div key={label || 'all'}>
                  {label && (
                    <div className="flex items-center gap-3 mb-3">
                      <span className="text-xs font-semibold text-stone-500 uppercase tracking-wider whitespace-nowrap">{label}</span>
                      <div className="flex-1 h-px bg-stone-700/50" />
                    </div>
                  )}
                  {altarPrefs.view === 'cards' ? (
                    <div className="grid grid-cols-3 gap-3">
                      {items.map((altar) => (
                        renamingId === altar.id ? (
                          <div key={altar.id} className="panel-interactive px-4 py-4 text-left">
                            <AltarRenameField
                              value={renameValue}
                              onChange={setRenameValue}
                              onCommit={commitRename}
                              onCancel={() => setRenamingId(null)}
                              className="mb-2 w-full bg-transparent text-sm font-medium text-stone-200 outline-none selectable"
                            />
                            <p className="text-xs text-stone-600">{format(new Date(altar.updated_at), 'MMM d, yyyy')}</p>
                          </div>
                        ) : (
                          <button
                            key={altar.id}
                            onClick={() => openAltar(altar)}
                            onContextMenu={(event) => { event.preventDefault(); setCtxMenu({ id: altar.id, x: event.clientX, y: event.clientY }); }}
                            className="panel-interactive px-4 py-4 text-left"
                          >
                            <div className="mb-3">
                              {renderPreviewScene(altar)}
                            </div>
                            <div className="text-sm font-medium text-stone-200 truncate">{altar.title}</div>
                            <div className="mt-2 flex flex-wrap gap-2 text-xs">
                              <span className="text-parchment-500/70">{format(new Date(altar.updated_at), 'MMM d, yyyy')}</span>
                            </div>
                            {altar.intention && (
                              <p className="mt-2 max-h-8 overflow-hidden text-xs leading-4 text-stone-500">{altar.intention}</p>
                            )}
                          </button>
                        )
                      ))}
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      {items.map((altar) => (
                        renamingId === altar.id ? (
                          <div key={altar.id} className="panel-interactive flex items-center gap-3 px-4 py-3">
                            <AltarRenameField
                              value={renameValue}
                              onChange={setRenameValue}
                              onCommit={commitRename}
                              onCancel={() => setRenamingId(null)}
                              className="flex-1 bg-transparent text-sm text-stone-300 outline-none selectable"
                            />
                            <span className="text-xs text-parchment-500/70">{format(new Date(altar.updated_at), 'MMM d, yyyy')}</span>
                          </div>
                        ) : (
                          <button
                            key={altar.id}
                            onClick={() => openAltar(altar)}
                            onContextMenu={(event) => { event.preventDefault(); setCtxMenu({ id: altar.id, x: event.clientX, y: event.clientY }); }}
                            className="panel-interactive w-full text-left flex items-center gap-3 px-4 py-3"
                          >
                            <span className="flex-shrink-0">
                              {renderPreviewScene(altar, true)}
                            </span>
                            <span className="flex-1 text-sm text-stone-300 truncate">{altar.title}</span>
                            <span className="text-xs text-stone-600">{format(new Date(altar.updated_at), 'MMM d, yyyy')}</span>
                          </button>
                        )
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {ctxMenu && (
          <ContextMenu
            x={ctxMenu.x}
            y={ctxMenu.y}
            onClose={() => setCtxMenu(null)}
            actions={[
              { label: t('contextMenu.duplicate'), icon: <Copy size={12} />, onClick: () => handleDuplicate(ctxMenu.id) },
              { label: t('contextMenu.rename'), icon: <Pencil size={12} />, onClick: () => {
                const altar = altars.find((entry) => entry.id === ctxMenu.id);
                if (altar) startRename(altar);
              } },
              { label: t('contextMenu.delete'), icon: <Trash2 size={12} />, onClick: () => handleDelete(ctxMenu.id), danger: true },
            ]}
          />
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 h-14 border-b border-stone-700/60 flex-shrink-0">
        <div className="flex items-center gap-2 text-xs text-stone-600">
          <button onClick={() => setActiveView({ type: 'altar' })} className="text-stone-500 transition-colors hover:text-stone-300">
            {t('nav.altar')}
          </button>
          <span>{format(new Date(activeAltar.updated_at), 'MMM d, yyyy')}</span>
        </div>
        <div className="flex items-center gap-1">
          {isEditing ? (
            <>
              <button onClick={handleDone} className="flex items-center gap-1.5 rounded-md border border-jade-800/40 bg-jade-900/40 px-3 py-1.5 text-xs font-medium text-jade-400 transition-colors hover:bg-jade-900/60">
                <Check size={13} />{t('editor.done')}
              </button>
              <button onClick={handleCancel} className="btn-ghost">
                <X size={15} />
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => setAltarWindowFullscreen(!altarWindowFullscreen)}
                className="btn-ghost"
                title={altarWindowFullscreen ? t('altar.exitWindowFullscreen') : t('altar.windowFullscreen')}
              >
                {altarWindowFullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
              </button>
              <button onClick={enterEditMode} className="btn-ghost" title={t('editor.edit')}>
                <Pencil size={15} />
              </button>
              <button onClick={toggleRightSidebar} className="btn-ghost">
                <PanelRightOpen size={16} />
              </button>
            </>
          )}
        </div>
      </div>

      {!altarWindowFullscreen && (
        <div className="px-6 pt-6 pb-4 border-b border-stone-700/30" onDoubleClick={enterEditMode}>
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
            <h1 className="entry-view-title w-full cursor-text text-2xl font-semibold text-stone-100">
              {activeAltar.title || t('altar.untitled')}
            </h1>
          )}
        </div>
      )}

      <AltarCanvas altar={activeAltar} backgroundSrc={getPreviewSrc(activeAltar)} placements={placements} editable={isEditing} showGrid={altarCanvasGrid} gridSize={altarCanvasGridSize} gridOpacity={altarCanvasGridOpacity} gridColor={altarCanvasGridColor} snapToGrid={altarSnapToGrid} getBackgroundStyle={getAltarBackgroundStyleWithImage} />

      {isEditing && !altarWindowFullscreen && <AltarLibraryStrip editable={isEditing} />}
    </div>
  );
}

