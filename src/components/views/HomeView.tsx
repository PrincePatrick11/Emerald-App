import { useRef, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { BookOpen, Library, Plus, Wand2, ChevronDown, Copy, Pencil, Trash2 } from 'lucide-react';
import { useUIStore } from '../../store/uiStore';
import { useJournalStore } from '../../store/journalStore';
import { useWikiStore } from '../../store/wikiStore';
import { useOperationStore } from '../../store/operationStore';
import { useUndoStore } from '../../store/undoStore';
import { getCategoryEmoji } from '../wiki/WikiList';
import ContextMenu from '../ui/ContextMenu';
import { getMoonPhase, MOON_PHASE_SYMBOLS } from '../../lib/moonPhase';
import { generateId } from '../../lib/helpers';
import { format } from 'date-fns';
import type { MoonPhase } from '../../types';
import type { HomeSort, HomeView, HomeSectionPrefs } from '../../store/uiStore';

type CtxTarget =
  | { kind: 'journal'; id: string }
  | { kind: 'wiki'; id: string }
  | { kind: 'operation'; id: string };

// ── Dropdown (same style as ListToolbar) ──────────────────────────────────────

function Dropdown<T extends string>({
  label, value, options, onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.value === value)?.label ?? value;

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="list-toolbar-chip flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs transition-colors"
      >
        <span className="list-toolbar-chip-label mr-0.5">{label}</span>
        {selected}
        <ChevronDown size={11} className="list-toolbar-chip-label" />
      </button>
      {open && (
        <div className="list-toolbar-menu absolute top-full left-0 mt-1 z-50 rounded-lg shadow-xl py-1 min-w-[120px]">
          {options.map((o) => (
            <button
              key={o.value}
              onClick={() => { onChange(o.value); setOpen(false); }}
              className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
                value === o.value ? 'list-toolbar-option-active' : 'list-toolbar-option-idle'
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Section toolbar (sort + view + count) ─────────────────────────────────────

function SectionToolbar({
  prefs, setPrefs,
}: {
  prefs: HomeSectionPrefs;
  setPrefs: (p: Partial<HomeSectionPrefs>) => void;
}) {
  const { t } = useTranslation();
  const sortOptions: { value: HomeSort; label: string }[] = [
    { value: 'date_desc',  label: t('home.newest') },
    { value: 'date_asc',   label: t('home.oldest') },
    { value: 'alpha_asc',  label: 'A → Z' },
    { value: 'alpha_desc', label: 'Z → A' },
  ];
  const viewOptions: { value: HomeView; label: string }[] = [
    { value: 'list',  label: t('listView.list') },
    { value: 'cards', label: t('listView.cards') },
  ];
  const countOptions: { value: string; label: string }[] = [
    { value: '3',  label: '3' },
    { value: '5',  label: '5' },
    { value: '10', label: '10' },
    { value: '25', label: '25' },
    { value: '0',  label: t('operations.all') },
  ];

  return (
    <div className="flex items-center gap-2">
      <Dropdown label={t('home.view') + ': '}  value={prefs.view}          options={viewOptions}  onChange={(v) => setPrefs({ view: v })} />
      <Dropdown label={t('home.sort') + ': '}  value={prefs.sort}          options={sortOptions}  onChange={(v) => setPrefs({ sort: v })} />
      <Dropdown label={t('home.show') + ': '}  value={String(prefs.count)} options={countOptions} onChange={(v) => setPrefs({ count: Number(v) })} />
    </div>
  );
}

// ── Sort helpers ──────────────────────────────────────────────────────────────

function applySort<T extends { title?: string; created_at?: string; updated_at?: string }>(
  items: T[], sort: HomeSort, dateField: 'created_at' | 'updated_at' = 'created_at'
): T[] {
  return [...items].sort((a, b) => {
    if (sort === 'date_desc') return new Date(b[dateField]!).getTime() - new Date(a[dateField]!).getTime();
    if (sort === 'date_asc')  return new Date(a[dateField]!).getTime() - new Date(b[dateField]!).getTime();
    if (sort === 'alpha_asc') return (a.title ?? '').localeCompare(b.title ?? '');
    if (sort === 'alpha_desc') return (b.title ?? '').localeCompare(a.title ?? '');
    return 0;
  });
}

function applyCount<T>(items: T[], count: number): T[] {
  return count === 0 ? items : items.slice(0, count);
}

// ── Main component ────────────────────────────────────────────────────────────

export default function HomeView() {
  const { t } = useTranslation();
  const {
    setActiveView,
    homeJournalPrefs, setHomeJournalPrefs,
    homeOpsPrefs,     setHomeOpsPrefs,
    homeWikiPrefs,    setHomeWikiPrefs,
  } = useUIStore();
  const { entries, createEntry, updateEntry, deleteEntry, restoreEntry } = useJournalStore();
  const { articles, wikiCategories, createArticle, updateArticle, deleteArticle, restoreArticle } = useWikiStore();
  const { operations, categories, createOperation, updateOperation, deleteOperation, restoreOperation } = useOperationStore();
  const pushUndo = useUndoStore((s) => s.push);

  const [ctxMenu, setCtxMenu] = useState<{ target: CtxTarget; x: number; y: number } | null>(null);

  const today = new Date();
  const moonPhase = getMoonPhase(today);

  const handleNewEntry = async () => {
    const entry = await createEntry();
    setActiveView({ type: 'journal', id: entry.id, mode: 'edit' });
  };

  const openCtx = (e: React.MouseEvent, target: CtxTarget) => {
    e.preventDefault();
    setCtxMenu({ target, x: e.clientX, y: e.clientY });
  };

  const handleDuplicate = async (target: CtxTarget) => {
    if (target.kind === 'journal') {
      const src = entries.find((e) => e.id === target.id);
      if (!src) return;
      const ne = await createEntry();
      await updateEntry(ne.id, {
        title: src.title + ' (Copy)', content: src.content, tags: src.tags,
        moon_phase: src.moon_phase, paradigm_id: src.paradigm_id,
        is_bannung: src.is_bannung, bannung_type_wiki_id: src.bannung_type_wiki_id,
        is_meditation: src.is_meditation, meditation_type_wiki_id: src.meditation_type_wiki_id,
        meditation_duration: src.meditation_duration,
        linked_operation_ids: src.linked_operation_ids, linked_wiki_ids: src.linked_wiki_ids,
      });
      setActiveView({ type: 'journal', id: ne.id, mode: 'view' });
    } else if (target.kind === 'wiki') {
      const src = articles.find((a) => a.id === target.id);
      if (!src) return;
      const na = await createArticle(src.category as never);
      await updateArticle(na.id, { title: src.title + ' (Copy)', content: src.content, tags: src.tags });
      setActiveView({ type: 'wiki', id: na.id, mode: 'view' });
    } else if (target.kind === 'operation') {
      const src = operations.find((o) => o.id === target.id);
      if (!src) return;
      const no = await createOperation(src.category_id ?? 'other');
      await updateOperation(no.id, { title: src.title + ' (Copy)', content: src.content, tags: src.tags });
      setActiveView({ type: 'operations', id: no.id, mode: 'view' });
    }
  };

  const handleRename = (target: CtxTarget) => {
    if (target.kind === 'journal')    setActiveView({ type: 'journal',    id: target.id, mode: 'edit' });
    if (target.kind === 'wiki')       setActiveView({ type: 'wiki',        id: target.id, mode: 'edit' });
    if (target.kind === 'operation')  setActiveView({ type: 'operations',  id: target.id, mode: 'edit' });
  };

  const handleDelete = async (target: CtxTarget) => {
    if (target.kind === 'journal') {
      await deleteEntry(target.id);
      pushUndo({ id: generateId(), description: t('undo.entryDeleted'),     undo: () => restoreEntry(target.id) });
    } else if (target.kind === 'wiki') {
      await deleteArticle(target.id);
      pushUndo({ id: generateId(), description: t('undo.articleDeleted'),   undo: () => restoreArticle(target.id) });
    } else if (target.kind === 'operation') {
      await deleteOperation(target.id);
      pushUndo({ id: generateId(), description: t('undo.operationDeleted'), undo: () => restoreOperation(target.id) });
    }
  };

  const ctxActions = ctxMenu
    ? [
        { label: t('contextMenu.duplicate'), icon: <Copy size={12} />,   onClick: () => handleDuplicate(ctxMenu.target) },
        { label: t('contextMenu.rename'),    icon: <Pencil size={12} />, onClick: () => handleRename(ctxMenu.target) },
        { label: t('contextMenu.delete'),    icon: <Trash2 size={12} />, onClick: () => handleDelete(ctxMenu.target), danger: true },
      ]
    : [];

  // Sorted + sliced data
  const journalItems = applyCount(applySort(entries, homeJournalPrefs.sort, 'created_at'), homeJournalPrefs.count);
  const opsItems     = applyCount(applySort(operations, homeOpsPrefs.sort, 'updated_at'), homeOpsPrefs.count);
  const wikiItems    = applyCount(applySort(articles, homeWikiPrefs.sort, 'updated_at'), homeWikiPrefs.count);

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto px-8 py-10">

        {/* Header */}
        <div className="mb-10">
          <div className="flex items-start justify-between mb-1">
            <div>
              <h1 className="text-2xl font-semibold text-stone-100 mb-1">
                {format(today, 'EEEE, MMMM d')}
              </h1>
              <p className="text-stone-500 text-sm">
                {MOON_PHASE_SYMBOLS[moonPhase]}{' '}{t(`moonPhase.${moonPhase}`)}
              </p>
            </div>
            <button
              onClick={handleNewEntry}
              className="flex items-center gap-2 px-4 py-2 bg-jade-900/40 hover:bg-jade-900/60
                         text-jade-400 text-sm font-medium rounded-lg border border-jade-800/40
                         transition-colors duration-150 flex-shrink-0"
            >
              <Plus size={15} />
              {t('journal.newEntry')}
            </button>
          </div>
        </div>

        {/* ── Journal ── */}
        <section className="mb-8">
          <div className="flex items-center gap-2 mb-3">
            <button onClick={() => setActiveView({ type: 'journal' })} className="flex items-center gap-2 group flex-shrink-0">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-stone-500 group-hover:text-stone-400 flex items-center gap-2 transition-colors">
                <BookOpen size={12} />
                {t('nav.journal')}
              </h2>
              <span className="text-xs text-stone-600 group-hover:text-stone-400 transition-colors">{t('home.viewAll')}</span>
            </button>
            <div className="ml-auto flex-shrink-0">
              <SectionToolbar prefs={homeJournalPrefs} setPrefs={setHomeJournalPrefs} />
            </div>
          </div>
          {entries.length === 0 ? (
            <div className="panel px-4 py-6 text-center">
              <p className="text-stone-600 text-sm">{t('journal.noEntries')}</p>
              <p className="text-stone-700 text-xs mt-1">{t('journal.startWriting')}</p>
            </div>
          ) : homeJournalPrefs.view === 'list' ? (
            <div className="space-y-2">
              {journalItems.map((entry) => (
                <button
                  key={entry.id}
                  onClick={() => setActiveView({ type: 'journal', id: entry.id, mode: 'view' })}
                  onContextMenu={(e) => openCtx(e, { kind: 'journal', id: entry.id })}
                  className="panel-interactive w-full text-left px-4 py-3 group"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-xl">{MOON_PHASE_SYMBOLS[entry.moon_phase as MoonPhase] ?? '📓'}</span>
                    <div className="flex-1 min-w-0">
                      <div className="home-item-title text-sm font-medium truncate">
                        {entry.title}
                      </div>
                      <div className="home-item-meta text-xs mt-0.5">
                        {format(new Date(entry.created_at), 'MMM d, yyyy')}
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {journalItems.map((entry) => (
                <button
                  key={entry.id}
                  onClick={() => setActiveView({ type: 'journal', id: entry.id, mode: 'view' })}
                  onContextMenu={(e) => openCtx(e, { kind: 'journal', id: entry.id })}
                  className="panel-interactive px-3 py-3 text-left"
                >
                  <div className="text-lg mb-1">{MOON_PHASE_SYMBOLS[entry.moon_phase as MoonPhase] ?? '📓'}</div>
                  <div className="home-item-title text-sm font-medium truncate">{entry.title}</div>
                  <div className="home-item-meta text-xs mt-0.5">
                    {format(new Date(entry.created_at), 'MMM d, yyyy')}
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>

        {/* ── Operations ── */}
        <section className="mb-8">
          <div className="flex items-center gap-2 mb-3">
            <button onClick={() => setActiveView({ type: 'operations' })} className="flex items-center gap-2 group flex-shrink-0">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-stone-500 group-hover:text-stone-400 flex items-center gap-2 transition-colors">
                <Wand2 size={12} />
                {t('nav.operations')}
              </h2>
              <span className="text-xs text-stone-600 group-hover:text-stone-400 transition-colors">{t('home.viewAll')}</span>
            </button>
            <div className="ml-auto flex-shrink-0">
              <SectionToolbar prefs={homeOpsPrefs} setPrefs={setHomeOpsPrefs} />
            </div>
          </div>
          {operations.length === 0 ? (
            <div className="panel px-4 py-6 text-center">
              <p className="text-stone-600 text-sm">{t('operations.none')}</p>
            </div>
          ) : homeOpsPrefs.view === 'list' ? (
            <div className="space-y-2">
              {opsItems.map((op) => {
                const cat = categories.find((c) => c.id === op.category_id);
                return (
                  <button
                    key={op.id}
                    onClick={() => setActiveView({ type: 'operations', id: op.id, mode: 'view' })}
                    onContextMenu={(e) => openCtx(e, { kind: 'operation', id: op.id })}
                    className="panel-interactive w-full text-left px-4 py-3 group"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-xl">{cat?.emoji ?? '⚡'}</span>
                      <div className="flex-1 min-w-0">
                        <div className="home-item-title text-sm font-medium truncate">
                          {op.title}
                        </div>
                        <div className="home-item-meta text-xs mt-0.5">
                          {(cat ? (cat.is_builtin ? t(`operations.categories.${cat.id}`) : cat.name) : '')} · {format(new Date(op.updated_at), 'MMM d, yyyy')}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {opsItems.map((op) => {
                const cat = categories.find((c) => c.id === op.category_id);
                return (
                  <button
                    key={op.id}
                    onClick={() => setActiveView({ type: 'operations', id: op.id, mode: 'view' })}
                    onContextMenu={(e) => openCtx(e, { kind: 'operation', id: op.id })}
                    className="panel-interactive px-3 py-3 text-left"
                  >
                    <div className="text-lg mb-1">{cat?.emoji ?? '⚡'}</div>
                    <div className="home-item-title text-sm font-medium truncate">{op.title}</div>
                    <div className="home-item-meta text-xs mt-0.5">
                      {(cat ? (cat.is_builtin ? t(`operations.categories.${cat.id}`) : cat.name) : '')} · {format(new Date(op.updated_at), 'MMM d, yyyy')}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {/* ── Wiki ── */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <button onClick={() => setActiveView({ type: 'wiki' })} className="flex items-center gap-2 group flex-shrink-0">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-stone-500 group-hover:text-stone-400 flex items-center gap-2 transition-colors">
                <Library size={12} />
                {t('nav.wiki')}
              </h2>
              <span className="text-xs text-stone-600 group-hover:text-stone-400 transition-colors">{t('home.viewAll')}</span>
            </button>
            <div className="ml-auto flex-shrink-0">
              <SectionToolbar prefs={homeWikiPrefs} setPrefs={setHomeWikiPrefs} />
            </div>
          </div>
          {articles.length === 0 ? (
            <div className="panel px-4 py-6 text-center">
              <p className="text-stone-600 text-sm">{t('wiki.noArticles')}</p>
              <p className="text-stone-700 text-xs mt-1">{t('wiki.startDocumenting')}</p>
            </div>
          ) : homeWikiPrefs.view === 'list' ? (
            <div className="space-y-2">
              {wikiItems.map((article) => {
                const cat = wikiCategories.find((c) => c.id === article.category);
                const icon = cat?.emoji ?? getCategoryEmoji(article.category);
                const catLabel = cat ? (cat.is_builtin ? t(`wiki.categories.${cat.id}`) : cat.name) : article.category;
                return (
                  <button
                    key={article.id}
                    onClick={() => setActiveView({ type: 'wiki', id: article.id, mode: 'view' })}
                    onContextMenu={(e) => openCtx(e, { kind: 'wiki', id: article.id })}
                    className="panel-interactive w-full text-left px-4 py-3 group"
                  >
                    <div className="flex items-center gap-3">
                      {article.icon
                        ? <img src={article.icon} alt="" className="w-6 h-6 object-cover rounded flex-shrink-0" />
                        : <span className="text-xl flex-shrink-0">{icon}</span>
                      }
                      <div className="flex-1 min-w-0">
                        <div className="home-item-title text-sm font-medium truncate">
                          {article.title}
                        </div>
                        <div className="home-item-meta text-xs capitalize mt-0.5">
                          {catLabel} · {format(new Date(article.updated_at), 'MMM d, yyyy')}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {wikiItems.map((article) => {
                const cat = wikiCategories.find((c) => c.id === article.category);
                const icon = cat?.emoji ?? getCategoryEmoji(article.category);
                const catLabel = cat ? (cat.is_builtin ? t(`wiki.categories.${cat.id}`) : cat.name) : article.category;
                return (
                  <button
                    key={article.id}
                    onClick={() => setActiveView({ type: 'wiki', id: article.id, mode: 'view' })}
                    onContextMenu={(e) => openCtx(e, { kind: 'wiki', id: article.id })}
                    className="panel-interactive px-3 py-3 text-left"
                  >
                    {article.icon
                      ? <img src={article.icon} alt="" className="w-6 h-6 object-cover rounded mb-1" />
                      : <div className="text-lg mb-1">{icon}</div>
                    }
                    <div className="home-item-title text-sm font-medium truncate">{article.title}</div>
                    <div className="home-item-meta text-xs capitalize mt-0.5">
                      {catLabel} · {format(new Date(article.updated_at), 'MMM d, yyyy')}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </section>

      </div>

      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          actions={ctxActions}
          onClose={() => setCtxMenu(null)}
        />
      )}
    </div>
  );
}
