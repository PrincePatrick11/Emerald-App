import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Trash2 } from 'lucide-react';
import { useLexiconStore } from '../../store/lexiconStore';
import { useUIStore } from '../../store/uiStore';
import { useUndoStore } from '../../store/undoStore';
import { AUX_VIEWS } from '../../lib/modules';
import { generateId } from '../../lib/helpers';
import { sortItems } from '../../lib/sortItems';
import { isCardView } from '../../lib/viewMode';
import { groupByMonth } from '../../lib/groupBy';
import { usePersistedFlag } from '../../hooks/usePersistedFlag';
import { useOpenInNewTabAction } from '../../hooks/useOpenInNewTabAction';
import Dashboard, { GroupDivider } from '../ui/Dashboard';
import DashboardItem from '../ui/DashboardItem';
import ContextMenu from '../ui/ContextMenu';
import BlockGlyph from '../blocks/BlockGlyph';
import LanguagePage from '../lexicon/LanguagePage';
import TranslatePanel from '../lexicon/TranslatePanel';
import type { Language } from '../../types';

/**
 * Die Rail-Ansicht „Lexikon", gebaut wie „Vorlagen": die Sprachen im
 * gemeinsamen Dashboard-Gerüst, ein Klick öffnet eine als eigene Seite
 * (`{ type: 'lexicon', id }`). Darunter, wie die Bibliothek unter den
 * Altären, das Übersetzen-Feld — es arbeitet mit allen Sprachen und gehört
 * deshalb neben die Liste, nicht auf eine einzelne Sprachseite.
 *
 * Löschen legt eine Sprache in den Papierkorb (mit Rückgängig); ihre Vokabeln
 * bleiben an ihr hängen und kommen mit ihr zurück.
 */
export default function LexiconView() {
  const { t } = useTranslation();
  const languages = useLexiconStore((s) => s.languages);
  const createLanguage = useLexiconStore((s) => s.createLanguage);
  const deleteLanguage = useLexiconStore((s) => s.deleteLanguage);
  const restoreLanguage = useLexiconStore((s) => s.restoreLanguage);
  const activeView = useUIStore((s) => s.activeView);
  const setActiveView = useUIStore((s) => s.setActiveView);
  const pushUndo = useUndoStore((s) => s.push);

  // Eine id ohne Sprache (gelöscht, anderer Vault im gemerkten Tab) fällt auf die Liste zurück.
  const selected = activeView.id ? languages.find((l) => l.id === activeView.id) ?? null : null;

  const open = (id: string) => setActiveView({ type: 'lexicon', id });
  const backToList = () => setActiveView({ type: 'lexicon' });

  const create = async () => {
    const language = await createLanguage(t('lexicon.defaultName'));
    open(language.id);
  };

  const remove = async (language: Language) => {
    try {
      await deleteLanguage(language.id);
    } catch (err) {
      // Nichts verloren: die Sprache bleibt, wo sie war.
      console.error('[LexiconView] deleting the language failed:', err);
      return;
    }
    if (activeView.id === language.id) backToList();
    pushUndo({
      id: generateId(),
      description: t('undo.languageDeleted'),
      undo: () => restoreLanguage(language.id),
    });
  };

  return selected ? (
    <LanguagePage
      key={selected.id}
      language={selected}
      onClose={backToList}
      onDelete={() => void remove(selected)}
    />
  ) : (
    <LanguageList onCreate={() => void create()} onDelete={(language) => void remove(language)} />
  );
}

/**
 * Die Liste der Sprachen im gemeinsamen Dashboard-Gerüst — Ansicht und
 * Sortierung wie in den anderen Dashboards, unter einer einklappbaren
 * Überschrift wie das Übersetzen-Feld darunter.
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
  const [search, setSearch] = useState('');
  const [ctxMenu, setCtxMenu] = useState<{ id: string; x: number; y: number } | null>(null);

  /** Wie viele Vokabeln je Sprache — eine Zählung für alle Zeilen statt einer je Zeile. */
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
      <span className="text-xs text-stone-500 tabular-nums flex-shrink-0">
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
        {cards ? (
          <>
            <div className="flex items-center gap-2 mb-2">
              <BlockGlyph icon={language.icon} size={16} />
            </div>
            <div className="text-sm font-medium text-stone-200 truncate mb-1">{language.name}</div>
            {meta}
          </>
        ) : (
          <>
            <BlockGlyph icon={language.icon} size={14} />
            <span className="flex-1 min-w-0 text-sm text-stone-300 truncate">{language.name}</span>
            {meta}
          </>
        )}
      </DashboardItem>
    );
  };

  const menuLanguage = ctxMenu && languages.find((l) => l.id === ctxMenu.id);

  return (
    <Dashboard<Language>
      title={t('nav.lexicon')}
      titleIcon={AUX_VIEWS.lexicon.icon}
      titleCount={languages.length}
      primaryAction={{ label: t('lexicon.newLanguage'), onClick: onCreate }}
      view={prefs.view}
      sort={prefs.sort}
      onView={(view) => setPrefs({ view })}
      onSort={(sort) => setPrefs({ sort })}
      search={search}
      onSearch={setSearch}
      // Zugeklappt eine leere Liste statt eines Sonderzweigs — wie Altar, Blöcke und Vorlagen.
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
        message: t('lexicon.emptyHint'),
        actionLabel: t('lexicon.newLanguage'),
        onAction: onCreate,
      }}
      hasNoResults={!collapsed && filtered.length === 0}
      noResultsMessage={t('search.noResults')}
      contentHeader={
        <GroupDivider
          label={t('lexicon.languages')}
          count={filtered.length}
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
