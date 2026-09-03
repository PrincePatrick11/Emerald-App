import { useState } from 'react';
import { useShallow } from 'zustand/shallow';
import { useTranslation } from 'react-i18next';
import { BookOpen, Library, Plus, Wand2, Copy, Pencil, Trash2 } from 'lucide-react';
import { useUIStore } from '../../store/uiStore';
import { useJournalStore } from '../../store/journalStore';
import { useWikiStore } from '../../store/wikiStore';
import { useOperationStore } from '../../store/operationStore';
import { useUndoStore } from '../../store/undoStore';
import { getCategoryEmoji } from '../wiki/WikiList';
import ContextMenu from '../ui/ContextMenu';
import Button from '../ui/Button';
import Dropdown from '../ui/Dropdown';
import { getMoonPhase, MOON_PHASE_SYMBOLS } from '../../lib/moonPhase';
import { generateId, isImageIcon } from '../../lib/helpers';
import { viewTypeForEntryType } from '../../lib/modules';
import { categoryLabel } from '../../lib/categories';
import { formatDayHeading, formatEntryDate } from '../../lib/formatDate';
import { sortItems } from '../../lib/sortItems';
import type { MoonPhase } from '../../types';
import type { HomeSort, HomeView, HomeSectionPrefs } from '../../store/uiStore';

type CtxTarget =
  | { kind: 'journal'; id: string }
  | { kind: 'wiki'; id: string }
  | { kind: 'operation'; id: string };

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
    { value: 'alpha_asc',  label: t('listView.alphaAsc') },
    { value: 'alpha_desc', label: t('listView.alphaDesc') },
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

function applyCount<T>(items: T[], count: number): T[] {
  return count === 0 ? items : items.slice(0, count);
}

// ── Main component ────────────────────────────────────────────────────────────

export default function HomeView() {
  const { t } = useTranslation();
  const { setActiveView, homeJournalPrefs, setHomeJournalPrefs, homeOpsPrefs, setHomeOpsPrefs, homeWikiPrefs, setHomeWikiPrefs, } = useUIStore(
    useShallow((s) => ({ setActiveView: s.setActiveView, homeJournalPrefs: s.homeJournalPrefs, setHomeJournalPrefs: s.setHomeJournalPrefs, homeOpsPrefs: s.homeOpsPrefs, setHomeOpsPrefs: s.setHomeOpsPrefs, homeWikiPrefs: s.homeWikiPrefs, setHomeWikiPrefs: s.setHomeWikiPrefs }))
  );
  const { entries, createEntry, duplicateEntry, deleteEntry, restoreEntry } = useJournalStore(
    useShallow((s) => ({ entries: s.entries, createEntry: s.createEntry, duplicateEntry: s.duplicateEntry, deleteEntry: s.deleteEntry, restoreEntry: s.restoreEntry }))
  );
  const { articles, wikiCategories, duplicateArticle, deleteArticle, restoreArticle } = useWikiStore(
    useShallow((s) => ({ articles: s.articles, wikiCategories: s.wikiCategories, duplicateArticle: s.duplicateArticle, deleteArticle: s.deleteArticle, restoreArticle: s.restoreArticle }))
  );
  const { operations, categories, duplicateOperation, deleteOperation, restoreOperation } = useOperationStore(
    useShallow((s) => ({ operations: s.operations, categories: s.categories, duplicateOperation: s.duplicateOperation, deleteOperation: s.deleteOperation, restoreOperation: s.restoreOperation }))
  );
  const pushUndo = useUndoStore((s) => s.push);

  const [ctxMenu, setCtxMenu] = useState<{ target: CtxTarget; x: number; y: number } | null>(null);

  const today = new Date();
  const moonPhase = getMoonPhase(today);

  const handleNewEntry = async () => {
    const entry = await createEntry();
    setActiveView({ type: 'journal', id: entry.id, mode: 'edit', isNew: true });
  };

  const openCtx = (e: React.MouseEvent, target: CtxTarget) => {
    e.preventDefault();
    setCtxMenu({ target, x: e.clientX, y: e.clientY });
  };

  const handleDuplicate = async (target: CtxTarget) => {
    if (target.kind === 'journal') {
      const ne = await duplicateEntry(target.id);
      if (ne) setActiveView({ type: 'journal', id: ne.id, mode: 'view' });
    } else if (target.kind === 'wiki') {
      const na = await duplicateArticle(target.id);
      if (na) setActiveView({ type: 'wiki', id: na.id, mode: 'view' });
    } else if (target.kind === 'operation') {
      const no = await duplicateOperation(target.id);
      if (no) setActiveView({ type: 'operations', id: no.id, mode: 'view' });
    }
  };

  const handleRename = (target: CtxTarget) => {
    setActiveView({ type: viewTypeForEntryType(target.kind), id: target.id, mode: 'edit' });
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
  const journalItems = applyCount(sortItems(entries, homeJournalPrefs.sort, { date: (e) => e.created_at }), homeJournalPrefs.count);
  const opsItems     = applyCount(sortItems(operations, homeOpsPrefs.sort, { date: (o) => o.updated_at }), homeOpsPrefs.count);
  const wikiItems    = applyCount(sortItems(articles, homeWikiPrefs.sort, { date: (a) => a.updated_at }), homeWikiPrefs.count);

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto px-8 py-10">

        {/* Header */}
        <div className="mb-10">
          <div className="flex items-start justify-between mb-1">
            <div>
              <h1 className="text-2xl font-semibold text-stone-100 mb-1">
                {formatDayHeading(today)}
              </h1>
              <p className="text-stone-500 text-sm">
                {MOON_PHASE_SYMBOLS[moonPhase]}{' '}{t(`moonPhase.${moonPhase}`)}
              </p>
            </div>
            <Button
              onClick={handleNewEntry}
              variant="primary"
              className="px-4 py-2 text-sm flex-shrink-0"
            >
              <Plus size={15} />
              {t('journal.newEntry')}
            </Button>
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
                        {formatEntryDate(entry.created_at)}
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
                    {formatEntryDate(entry.created_at)}
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
                const icon = op.icon || cat?.emoji || '⚡';
                return (
                  <button
                    key={op.id}
                    onClick={() => setActiveView({ type: 'operations', id: op.id, mode: 'view' })}
                    onContextMenu={(e) => openCtx(e, { kind: 'operation', id: op.id })}
                    className="panel-interactive w-full text-left px-4 py-3 group"
                  >
                    <div className="flex items-center gap-3">
                      {isImageIcon(icon)
                        ? <img src={icon} alt="" className="w-6 h-6 object-cover rounded flex-shrink-0" />
                        : <span className="text-xl">{icon}</span>
                      }
                      <div className="flex-1 min-w-0">
                        <div className="home-item-title text-sm font-medium truncate">
                          {op.title}
                        </div>
                        <div className="home-item-meta text-xs mt-0.5">
                          {categoryLabel(t, 'operations', cat)} · {formatEntryDate(op.updated_at)}
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
                const icon = op.icon || cat?.emoji || '⚡';
                return (
                  <button
                    key={op.id}
                    onClick={() => setActiveView({ type: 'operations', id: op.id, mode: 'view' })}
                    onContextMenu={(e) => openCtx(e, { kind: 'operation', id: op.id })}
                    className="panel-interactive px-3 py-3 text-left"
                  >
                    {isImageIcon(icon)
                      ? <img src={icon} alt="" className="w-6 h-6 object-cover rounded mb-1" />
                      : <div className="text-lg mb-1">{icon}</div>
                    }
                    <div className="home-item-title text-sm font-medium truncate">{op.title}</div>
                    <div className="home-item-meta text-xs mt-0.5">
                      {categoryLabel(t, 'operations', cat)} · {formatEntryDate(op.updated_at)}
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
                const cat = wikiCategories.find((c) => c.id === article.category_id);
                const icon = cat?.emoji ?? getCategoryEmoji(article.category_id);
                // Kein Fallback auf die rohe category_id — bei gelöschter
                // Kategorie entfällt das Label.
                const catLabel = categoryLabel(t, 'wiki', cat);
                return (
                  <button
                    key={article.id}
                    onClick={() => setActiveView({ type: 'wiki', id: article.id, mode: 'view' })}
                    onContextMenu={(e) => openCtx(e, { kind: 'wiki', id: article.id })}
                    className="panel-interactive w-full text-left px-4 py-3 group"
                  >
                    <div className="flex items-center gap-3">
                      {isImageIcon(article.icon)
                        ? <img src={article.icon!} alt="" className="w-6 h-6 object-cover rounded flex-shrink-0" />
                        : <span className="text-xl flex-shrink-0">{icon}</span>
                      }
                      <div className="flex-1 min-w-0">
                        <div className="home-item-title text-sm font-medium truncate">
                          {article.title}
                        </div>
                        <div className="home-item-meta text-xs capitalize mt-0.5">
                          {catLabel ? `${catLabel} · ` : ''}{formatEntryDate(article.updated_at)}
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
                const cat = wikiCategories.find((c) => c.id === article.category_id);
                const icon = cat?.emoji ?? getCategoryEmoji(article.category_id);
                const catLabel = categoryLabel(t, 'wiki', cat);
                return (
                  <button
                    key={article.id}
                    onClick={() => setActiveView({ type: 'wiki', id: article.id, mode: 'view' })}
                    onContextMenu={(e) => openCtx(e, { kind: 'wiki', id: article.id })}
                    className="panel-interactive px-3 py-3 text-left"
                  >
                    {isImageIcon(article.icon)
                      ? <img src={article.icon!} alt="" className="w-6 h-6 object-cover rounded mb-1" />
                      : <div className="text-lg mb-1">{icon}</div>
                    }
                    <div className="home-item-title text-sm font-medium truncate">{article.title}</div>
                    <div className="home-item-meta text-xs capitalize mt-0.5">
                      {catLabel ? `${catLabel} · ` : ''}{formatEntryDate(article.updated_at)}
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
