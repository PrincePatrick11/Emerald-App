import { useState, useEffect } from 'react';
import { entryBlockSummary } from '../../lib/blocks/entrySummary';
import { useShallow } from 'zustand/shallow';
import { useTranslation } from 'react-i18next';
import { Trash2, Pencil, Copy } from 'lucide-react';
import ContextMenu from '../ui/ContextMenu';
import { useOpenInNewTabAction } from '../../hooks/useOpenInNewTabAction';
import { useSaveAsTemplateAction } from '../../hooks/useSaveAsTemplateAction';
import Dashboard, { type DashboardGroup } from '../ui/Dashboard';
import DashboardItem from '../ui/DashboardItem';
import RenameField from '../ui/RenameField';
import CollapsibleGroupHeader from '../ui/CollapsibleGroupHeader';
import { generateId, isImageIcon } from '../../lib/helpers';
import { entryIcon, MODULES } from '../../lib/modules';
import { displayTitle } from '../../lib/entryTitle';
import { categoriesUsedBy, categoryLabel, hasUncategorized, lookupCategory } from '../../lib/categories';
import { formatEntryDate } from '../../lib/formatDate';
import { sortItems } from '../../lib/sortItems';
import { isCardView } from '../../lib/viewMode';
import { groupByCategory, groupByMonth, UNCATEGORIZED_KEY, countByCategory } from '../../lib/groupBy';

import { useUIStore } from '../../store/uiStore';
import { EDIT_ENDED, useEntryEditor } from '../../hooks/useEntryEditor';
import { useEntryContentReady } from '../../hooks/useEntryContentReady';
import { useEditActions } from '../../hooks/useEditActions';
import { guardKey } from '../../store/leaveGuardStore';
import { useEntryStore } from '../../store/entryStore';
import { useTagMap, visibleTags } from '../../store/tagStore';
import { useCategoryStore } from '../../store/categoryStore';
import { useUndoStore } from '../../store/undoStore';
import { useCollapsedSet } from '../../hooks/useCollapsedSet';
import BlockStack from '../blocks/BlockStack';
import EntryDetailFrame from '../ui/EntryDetailFrame';
import { useSessionState } from '../../store/sessionStore';

export default function WikiView() {
  const { t } = useTranslation();
  const tagMap = useTagMap();
  const { activeView, setActiveView, wikiPrefs, setWikiPrefs } = useUIStore(
    useShallow((s) => ({ activeView: s.activeView, setActiveView: s.setActiveView, wikiPrefs: s.wikiPrefs, setWikiPrefs: s.setWikiPrefs }))
  );
  const openInNewTabAction = useOpenInNewTabAction();
  const saveAsTemplateAction = useSaveAsTemplateAction();
  const { articles, createEntry, duplicateEntry, updateEntry, deleteEntry, restoreEntry, getEntry } = useEntryStore(
    useShallow((s) => ({ articles: s.entries.wiki, createEntry: s.createEntry, duplicateEntry: s.duplicateEntry, updateEntry: s.updateEntry, deleteEntry: s.deleteEntry, restoreEntry: s.restoreEntry, getEntry: s.getEntry }))
  );
  const categories = useCategoryStore((s) => s.categories);
  const pushUndo = useUndoStore((s) => s.push);

  const article = activeView.id ? getEntry(activeView.id, 'wiki') : null;
  // Der Start lädt Inhalte nach den Listen: bis dieser da ist, steht der
  // Rahmen mit Titel, der Blockstapel montiert erst mit dem echten Inhalt.
  const contentReady = useEntryContentReady(article?.id);
  // Eine geladene Sigille mit Sperre „ganzer Eintrag" öffnet nie im Bearbeitungsmodus.
  const locked = !!article && !!entryBlockSummary(article.id, article.content).sigil?.lockEntry;
  const isEditing = activeView.mode === 'edit' && !locked;

  const [ctxMenu, setCtxMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [search, setSearch] = useSessionState('wiki.search', '');
  const [filterCatIds, setFilterCatIds] = useSessionState<string[]>('wiki.filter', []);
  const { isCollapsed: isCatCollapsed, toggle: toggleCatCollapse } = useCollapsedSet('wiki');
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
    // Kategorie, Cover und Icon gehören dem Properties-Panel (sofort
    // gespeichert) und stehen deshalb nicht im Patch: ein Autosave direkt nach
    // einer Panel-Änderung schriebe sonst den lokalen Stand zurück, bevor der
    // Sync-Effekt lief.
    buildPatch: (content) => ({ title, content, tags }),
    // Cancel stellt den Artikel her, wie er beim Betreten des Bearbeitens war —
    // auch, was die Seitenleiste inzwischen gespeichert hat.
    buildRestorePatch: (content) => ({
      title, content, tags,
      category_id: article?.category_id ?? null, icon: article?.icon, cover_image: article?.cover_image,
    }),
    readStored: (id) => {
      const stored = getEntry(id, 'wiki');
      return stored ? fieldsOf(stored) : null;
    },
    readStamp: (id) => getEntry(id, 'wiki')?.updated_at,
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

  // Titel ebenso: ein Rename aus der Sidebar bei offenem Edit-Modus wuerde
  // sonst vom naechsten Autosave zurueckgedreht.
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
    // Ein nie mit „Fertig" bestätigter Artikel geht, wie jeder gelöschte, in den Papierkorb.
    if (activeView.isNew && article) return handleDelete();
    cancelAutoSave();
    if (article) {
      // Nicht auf den Store-Stand zurück — nach dem ersten Debounce-Autosave
      // IST der Store der editierte Stand. restoreOnCancel schreibt den beim
      // Betreten des Edit-Modus gemerkten Stand des Artikels zurück; die Setter
      // hier fangen den Fall vor dem ersten Autosave ab (Store unverändert,
      // Sync-Effekte laufen nicht).
      const restored = await restoreOnCancel();
      // Die Seite zeigt diesen Eintrag nicht mehr, das Bearbeiten ist schon beendet — nichts mehr zu tun.
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
    // Erst schreiben, was noch aufgeschoben ist: im Papierkorb liegt der letzte Stand.
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
      title: () => title.trim() || getEntry(article.id, 'wiki')?.title.trim() || t('wiki.untitled'),
      isDirty: () => isDirty(!!activeView.isNew),
    } : undefined,
  });

  // Ohne Argument entsteht der Artikel ohne Kategorie; der „+"-Knopf am
  // Kategorienkopf gibt seine Kategorie mit — wie handleCreateTask(cat.id).
  const handleNew = async (categoryId?: string) => {
    const a = await createEntry('wiki', { categoryId });
    setActiveView({ type: 'wiki', id: a.id, mode: 'edit', isNew: true });
  };

  const openCtxMenu = (e: React.MouseEvent, id: string) => { e.preventDefault(); setCtxMenu({ id, x: e.clientX, y: e.clientY }); };

  const handleDuplicate = async (id: string) => {
    const newArt = await duplicateEntry(id);
    if (newArt) setActiveView({ type: 'wiki', id: newArt.id, mode: 'view' });
  };

  const startRename = (id: string) => {
    const src = articles.find((a) => a.id === id);
    if (!src) return;
    setRenameValue(src.title);
    setRenamingId(id);
  };

  const commitRename = async () => {
    if (!renamingId) return;
    if (renameValue.trim()) await updateEntry(renamingId, { title: renameValue.trim() });
    setRenamingId(null);
  };

  const handleCtxDelete = async (id: string) => {
    await deleteEntry(id);
    pushUndo({ id: generateId(), description: t('undo.articleDeleted'), undo: () => restoreEntry(id) });
    if (activeView.id === id) setActiveView({ type: 'wiki' });
  };

  if (!article) {
    const { view, sort, grouping } = wikiPrefs;
    const catById = Object.fromEntries(categories.map((c) => [c.id, c]));
    // Chips und Gruppen zeigen nur, was im Wiki vorkommt (plus Sonstiges);
    // catById bleibt die Volliste, damit fremde Kategorien auflösen.
    const usedCategories = categoriesUsedBy(categories, articles);

    const searchFiltered = search
      ? articles.filter((a) =>
          a.title.toLowerCase().includes(search.toLowerCase()) ||
          visibleTags(a.tags, tagMap).some((tag) => tag.name.toLowerCase().includes(search.toLowerCase()))
        )
      : articles;

    const catFiltered = filterCatIds.length === 0
      ? searchFiltered
      : searchFiltered.filter((a) =>
          (!!a.category_id && filterCatIds.includes(a.category_id)) ||
          // Der „Ohne Kategorie"-Chip wählt die Waisen aus — deren category_id
          // (gelöschte Kategorie) steht nie selbst in der Chip-Auswahl.
          (filterCatIds.includes(UNCATEGORIZED_KEY) && !lookupCategory(catById, a.category_id)));

    const filtered = catFiltered;

    // Nur die hier benutzten Kategorien — die Liste ist global, die anderen
    // Module sollen hier keine leeren Chips hinterlassen.
    // „Ohne Kategorie" nur, wenn es Waisen gibt — oder solange der Chip noch
    // ausgewählt ist: verschwände er unter der aktiven Auswahl, bliebe ein
    // Filter wirksam, den nichts mehr anzeigt.
    const showUncatChip = hasUncategorized(categories, articles) || filterCatIds.includes(UNCATEGORIZED_KEY);
    // Gezählt über die Suche, ohne den Kategorie-Filter selbst: die Zahl bleibt
    // stehen, während man Kategorien an- und abwählt.
    const catCounts = countByCategory(searchFiltered, (id) => !!lookupCategory(catById, id), (a) => a.category_id);
    const catChips = [
      ...usedCategories.map((c) => ({ value: c.id, label: categoryLabel(t, c), emoji: c.emoji, count: catCounts.get(c.id) ?? 0 })),
      ...(showUncatChip ? [{ value: UNCATEGORIZED_KEY, label: t('categories.uncategorized'), emoji: '📄', count: catCounts.get(UNCATEGORIZED_KEY) ?? 0 }] : []),
    ];

    const activeFilterCount = filterCatIds.length > 0 ? 1 : 0;

    // Nach dem Datum, das die Zeile zeigt — „zuletzt geändert", wie auf Home und in der linken Liste.
    const sortedArticles = sortItems(filtered, sort, { date: (a) => a.updated_at });
    const timelineGroups = groupByMonth(sortedArticles, (a) => a.updated_at);

    const renderArticle = (a: typeof articles[0]) => {
      const cat = lookupCategory(catById, a.category_id);
      const icon = entryIcon('wiki', a, cat);
      const iconEl = isImageIcon(icon) ? <img src={icon} alt="" className="w-5 h-5 object-cover rounded inline" /> : icon;
      // Ohne Fallback auf die rohe category_id: bei gelöschter Kategorie stünde
      // hier sonst deren id als Label (wie in OperationsView entfällt es dann).
      const catLabel = categoryLabel(t, cat);
      const dateStr = `${catLabel}${catLabel ? ' · ' : ''}${formatEntryDate(a.updated_at)}`;
      const renaming = renamingId === a.id;
      const renameInput = (className: string) => (
        <RenameField value={renameValue} onChange={setRenameValue} onCommit={commitRename}
          onCancel={() => setRenamingId(null)} className={className} />
      );
      return (
        <DashboardItem
          view={{ type: 'wiki', id: a.id, mode: 'view' }}
          layout={isCardView(view) ? 'card' : 'row'}
          editing={renaming}
          onContextMenu={(e) => openCtxMenu(e, a.id)}
        >
          {isCardView(view) ? (
            <>
              <div className="flex items-center gap-2 mb-2">
                {isImageIcon(icon) ? <img src={icon} alt="" className="w-6 h-6 object-cover rounded" /> : <span className="text-xl">{icon}</span>}
              </div>
              {renaming
                ? renameInput('text-sm font-medium text-stone-200 w-full bg-transparent outline-none selectable mb-1')
                : <div className="text-sm font-medium text-stone-200 truncate mb-1">{displayTitle(t, 'wiki', a.title)}</div>}
              <div className="text-xs text-parchment-500/70">{dateStr}</div>
            </>
          ) : (
            <>
              <span className="text-base flex-shrink-0">{iconEl}</span>
              {renaming
                ? renameInput('flex-1 bg-transparent text-sm text-stone-300 outline-none selectable')
                : <span className="flex-1 text-sm text-stone-300 truncate">{displayTitle(t, 'wiki', a.title)}</span>}
              <span className="text-xs text-parchment-500/70 flex-shrink-0">{dateStr}</span>
            </>
          )}
        </DashboardItem>
      );
    };

    type Article = typeof articles[number];

    // Abgewählte Kategorien ganz ausblenden statt sie leer stehen zu lassen —
    // wie visibleCategories in TasksView.
    const visibleCategories = filterCatIds.length > 0
      ? usedCategories.filter((c) => filterCatIds.includes(c.id))
      : usedCategories;
    // Der Waisen-Bucket fängt Artikel auf, deren Kategorie im Papierkorb liegt —
    // sonst verschwänden sie aus der Kategorien-Gruppierung.
    const catGroups: DashboardGroup<Article>[] = groupByCategory(
      sortedArticles, visibleCategories, (a) => a.category_id,
      (c) => categoryLabel(t, c), t('categories.uncategorized'),
    );

    const renderCategoryHeader = (group: DashboardGroup<Article>) => {
      if (group.key === UNCATEGORIZED_KEY) {
        return (
          <CollapsibleGroupHeader
            collapsed={isCatCollapsed(UNCATEGORIZED_KEY)}
            onToggleCollapse={() => toggleCatCollapse(UNCATEGORIZED_KEY)}
            emoji="📄"
            label={group.label}
            count={group.items.length}
          />
        );
      }
      const cat = catById[group.key!];
      if (!cat) return null;
      return (
        <CollapsibleGroupHeader
          emoji={cat.emoji}
          label={categoryLabel(t, cat)}
          collapsed={isCatCollapsed(cat.id)}
          onToggleCollapse={() => toggleCatCollapse(cat.id)}
          count={group.items.length}
          add={{ title: t('wiki.newArticle'), onClick: () => handleNew(cat.id) }}
        />
      );
    };

    return (
      <Dashboard<Article>
        title={t('wiki.title')}
        // Gewrappt, nicht durchgereicht: onClick liefert ein MouseEvent, das
        // sonst als categoryId in handleNew landet.
        primaryAction={{ label: t('wiki.newArticle'), onClick: () => handleNew() }}
        view={view}
        sort={sort}
        sortDate="updated"
        onView={(v) => setWikiPrefs({ view: v })}
        onSort={(s) => setWikiPrefs({ sort: s })}
        groupBy={{ value: grouping, onChange: (g) => setWikiPrefs({ grouping: g }) }}
        search={search}
        onSearch={setSearch}
        filters={{
          activeFilterCount,
          onClearAll: () => setFilterCatIds([]),
          panelProps: {
            chipLabel: t('filters.category'),
            chips: catChips,
            selectedChips: filterCatIds,
            onChipToggle: (v) => setFilterCatIds((prev) => prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]),
            onAllChips: () => setFilterCatIds([]),
            allChipsCount: searchFiltered.length,
          },
        }}
        items={sortedArticles}
        itemKey={(a) => a.id}
        renderItem={renderArticle}
        isEmpty={articles.length === 0}
        emptyState={{
          icon: MODULES.wiki.icon,
          title: t('emptyState.wiki.title'),
          description: t('emptyState.wiki.description'),
          actionLabel: t('wiki.newArticle'),
          onAction: () => handleNew(),
        }}
        // Im gruppierten Modus entscheidet Dashboard selbst: überlebt keine
        // Gruppe, zeigt es „Keine Ergebnisse". Dieser Zweig darf ihm also
        // nicht zuvorkommen.
        hasNoResults={filtered.length === 0 && !(grouping === 'grouped' && view !== 'timeline')}
        grouping={
          view === 'timeline'
            ? { mode: 'timeline', groups: timelineGroups }
            : grouping === 'grouped'
              ? {
                  mode: 'category',
                  groups: catGroups,
                  renderGroupHeader: renderCategoryHeader,
                  isGroupCollapsed: (g) => isCatCollapsed(g.key!),
                }
              : { mode: 'flat' }
        }
        contextMenuSlot={ctxMenu && (
          <ContextMenu
            x={ctxMenu.x} y={ctxMenu.y}
            onClose={() => setCtxMenu(null)}
            actions={[
              openInNewTabAction({ type: 'wiki', id: ctxMenu.id, mode: 'view' }),
              { label: t('contextMenu.duplicate'), icon: <Copy size={12} />, onClick: () => handleDuplicate(ctxMenu.id) },
              saveAsTemplateAction('wiki', ctxMenu.id),
              { label: t('contextMenu.rename'),    icon: <Pencil size={12} />, onClick: () => startRename(ctxMenu.id) },
              { label: t('contextMenu.delete'),    icon: <Trash2 size={12} />, onClick: () => handleCtxDelete(ctxMenu.id), danger: true },
            ]}
          />
        )}
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
            src={coverImage}
            alt=""
            className="w-full max-h-48 object-cover rounded-lg border border-stone-700/40"
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
          templateTarget={{ entryType: 'wiki', categoryId: article.category_id, flush: flushAutoSave }}
        />
      )}
    </EntryDetailFrame>
  );
}
