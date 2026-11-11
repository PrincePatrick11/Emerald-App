import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Trash2 } from 'lucide-react';
import { useLexiconStore } from '../../store/lexiconStore';
import { useUIStore } from '../../store/uiStore';
import { AUX_VIEWS } from '../../lib/modules';
import { sortItems } from '../../lib/sortItems';
import { isCardView } from '../../lib/viewMode';
import { groupByMonth } from '../../lib/groupBy';
import { usePersistedFlag } from '../../hooks/usePersistedFlag';
import { useOpenInNewTabAction } from '../../hooks/useOpenInNewTabAction';
import Dashboard from '../ui/Dashboard';
import CollapsibleGroupHeader from '../ui/CollapsibleGroupHeader';
import DashboardItem, { CardContent, RowContent } from '../ui/DashboardItem';
import ContextMenu from '../ui/ContextMenu';
import BlockGlyph from '../blocks/BlockGlyph';
import LanguagePage from '../lexicon/LanguagePage';
import TranslatePanel from '../lexicon/TranslatePanel';
import type { Language } from '../../types';
import { useSessionState } from '../../store/sessionStore';
import { createItem } from '../../lib/createItem';
import { useLibraryItemRemove } from '../../hooks/useLibraryItemRemove';

/**
 * The rail view "Lexicon", built like "Templates": the languages in the
 * shared dashboard scaffold, a click opens one as a page of its own
 * (`{ type: 'lexicon', id }`). Below it the translate field — it works with all languages and therefore
 * belongs next to the list, not on a single language page.
 *
 * Deleting moves a language to the trash (with undo); its vocabulary
 * stays attached to it and comes back with it.
 */
export default function LexiconView() {
  const languages = useLexiconStore((s) => s.languages);
  const deleteLanguage = useLexiconStore((s) => s.deleteLanguage);
  const restoreLanguage = useLexiconStore((s) => s.restoreLanguage);
  const activeView = useUIStore((s) => s.activeView);
  const setActiveView = useUIStore((s) => s.setActiveView);

  // An id without a language (deleted, another vault in the remembered tab) falls back to the list.
  const selected = activeView.id ? languages.find((l) => l.id === activeView.id) ?? null : null;

  const backToList = () => setActiveView({ type: 'lexicon' });

  const create = () => createItem('lexicon');

  const remove = useLibraryItemRemove({
    viewType: 'lexicon', remove: deleteLanguage, restore: restoreLanguage, undoKey: 'undo.languageDeleted', logTag: 'LexiconView',
  });

  return selected ? (
    <LanguagePage
      key={selected.id}
      language={selected}
      onClose={backToList}
      onDelete={() => void remove(selected.id)}
    />
  ) : (
    <LanguageList onCreate={() => void create()} onDelete={(language) => void remove(language.id)} />
  );
}

/**
 * The list of languages in the shared dashboard scaffold — view and
 * sorting as in the other dashboards, under a collapsible
 * heading like the translate field below.
 */
function LanguageList({ onCreate, onDelete }: {
  onCreate: () => void;
  onDelete: (language: Language) => void;
}) {
  const { t } = useTranslation();
  const languages = useLexiconStore((s) => s.languages);
  const entries = useLexiconStore((s) => s.entries);
  const duplicateLanguage = useLexiconStore((s) => s.duplicateLanguage);
  const openInNewTabAction = useOpenInNewTabAction();
  const prefs = useUIStore((s) => s.lexiconPrefs);
  const setPrefs = useUIStore((s) => s.setLexiconPrefs);
  const [collapsed, toggleCollapsed] = usePersistedFlag('lexicon-list-collapsed');
  const [search, setSearch] = useSessionState('lexicon.search', '');
  const [ctxMenu, setCtxMenu] = useState<{ id: string; x: number; y: number } | null>(null);

  /** How many words per language — one count for all rows instead of one per row. */
  const wordCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of entries) counts.set(entry.language_id, (counts.get(entry.language_id) ?? 0) + 1);
    return counts;
  }, [entries]);

  const query = search.trim().toLowerCase();
  const filtered = query
    ? languages.filter((l) => l.name.toLowerCase().includes(query))
    : languages;
  const sorted = sortItems(filtered, prefs.sort, { date: (l) => l.updated_at, title: (l) => l.name });

  const cards = isCardView(prefs.view);
  const renderItem = (language: Language) => {
    const meta = (
      <span className="tabular-nums">
        {t('lexicon.wordCount', { count: wordCounts.get(language.id) ?? 0 })}
        {language.alphabet.length > 0 && (
          <> · {t('lexicon.letterCount', { count: language.alphabet.length })}</>
        )}
      </span>
    );
    return (
      <DashboardItem
        view={{ type: 'lexicon', id: language.id }}
        layout={cards ? 'card' : 'row'}
        onContextMenu={(e) => {
          e.preventDefault();
          setCtxMenu({ id: language.id, x: e.clientX, y: e.clientY });
        }}
      >
        {cards
          ? <CardContent icon={<BlockGlyph icon={language.icon} size={16} />} title={language.name} meta={meta} />
          : <RowContent icon={<BlockGlyph icon={language.icon} size={14} />} title={language.name} meta={meta} />}
      </DashboardItem>
    );
  };

  const menuLanguage = ctxMenu && languages.find((l) => l.id === ctxMenu.id);

  return (
    <Dashboard<Language>
      title={t('nav.lexicon')}
      primaryAction={{ label: t('lexicon.newLanguage'), onClick: onCreate }}
      view={prefs.view}
      sort={prefs.sort}
      sortDate="updated"
      onView={(view) => setPrefs({ view })}
      onSort={(sort) => setPrefs({ sort })}
      search={search}
      onSearch={setSearch}
      // Collapsed means an empty list instead of a special branch — like blocks and templates.
      items={collapsed ? [] : sorted}
      itemKey={(l) => l.id}
      renderItem={renderItem}
      grouping={
        prefs.view === 'timeline' && !collapsed
          ? { mode: 'timeline', groups: groupByMonth(sorted, (l) => l.updated_at) }
          : { mode: 'flat' }
      }
      isEmpty={!collapsed && languages.length === 0}
      emptyState={{
        icon: AUX_VIEWS.lexicon.icon,
        title: t('emptyState.lexicon.title'),
        description: t('emptyState.lexicon.description'),
        actionLabel: t('lexicon.newLanguage'),
        onAction: onCreate,
      }}
      hasNoResults={!collapsed && filtered.length === 0}
      contentHeader={
        <CollapsibleGroupHeader
          label={t('lexicon.languages')}
          collapsed={collapsed}
          onToggleCollapse={toggleCollapsed}
        />
      }
      contentFooter={<TranslatePanel />}
      contextMenuSlot={ctxMenu && menuLanguage && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
          actions={[
            openInNewTabAction({ type: 'lexicon', id: menuLanguage.id }),
            { label: t('contextMenu.duplicate'), icon: <Copy size={12} />, onClick: () => void duplicateLanguage(menuLanguage.id) },
            { label: t('contextMenu.delete'), icon: <Trash2 size={12} />, onClick: () => onDelete(menuLanguage), danger: true },
          ]}
        />
      )}
    />
  );
}
