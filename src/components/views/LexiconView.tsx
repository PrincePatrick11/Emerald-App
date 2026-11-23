import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Trash2 } from 'lucide-react';
import { useLexiconStore } from '../../store/lexiconStore';
import { useUIStore } from '../../store/uiStore';
import { AUX_VIEWS } from '../../lib/modules';
import { usePersistedFlag } from '../../hooks/usePersistedFlag';
import { useOpenInNewTabAction } from '../../hooks/useOpenInNewTabAction';
import CollapsibleGroupHeader from '../ui/CollapsibleGroupHeader';
import BlockGlyph from '../blocks/BlockGlyph';
import { LanguageEditor, LanguagePage } from '../lexicon/LanguagePage';
import { useLanguageDraftStore } from '../../store/draftStore';
import TranslatePanel from '../lexicon/TranslatePanel';
import type { Language } from '../../types';
import { createItem } from '../../lib/createItem';
import { useLibraryItemRemove } from '../../hooks/useLibraryItemRemove';
import CollectionDashboard, { useCollectionState } from './CollectionDashboard';

/**
 * The rail view "Lexicon", a collection like the others: the languages,
 * a click opens one as a page of its own
 * (`{ type: 'lexicon', id }`), where its words are — to read, and with
 * "Edit" (`mode: 'edit'`) to edit like an entry. Below it the translate field — it works with all languages and therefore
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
  const clearDraft = useLanguageDraftStore((s) => s.clearDraft);

  // An id without a language (deleted, another vault in the remembered tab) falls back to the list.
  const selected = activeView.id ? languages.find((l) => l.id === activeView.id) ?? null : null;

  const backToList = () => setActiveView({ type: 'lexicon' });

  const create = () => createItem('lexicon');

  const remove = useLibraryItemRemove({
    viewType: 'lexicon', remove: deleteLanguage, restore: restoreLanguage, clearDraft, undoKey: 'undo.languageDeleted', logTag: 'LexiconView',
  });

  if (selected && activeView.mode === 'edit') {
    return (
      <LanguageEditor
        key={selected.id}
        language={selected}
        onClose={backToList}
        onDone={() => setActiveView({ type: 'lexicon', id: selected.id })}
        onDelete={() => void remove(selected.id)}
        isNew={activeView.isNew}
      />
    );
  }

  return selected ? (
    <LanguagePage
      key={selected.id}
      language={selected}
      onClose={backToList}
      onEdit={() => setActiveView({ type: 'lexicon', id: selected.id, mode: 'edit' })}
    />
  ) : (
    <LanguageList onCreate={() => void create()} onDelete={(language) => void remove(language.id)} />
  );
}

/**
 * The languages as a collection — view and sorting like every collection,
 * under a collapsible heading like the translate field below.
 */
function LanguageList({ onCreate, onDelete }: {
  onCreate: () => void;
  onDelete: (language: Language) => void;
}) {
  const { t } = useTranslation();
  const languages = useLexiconStore((s) => s.languages);
  const entries = useLexiconStore((s) => s.entries);
  const duplicateLanguage = useLexiconStore((s) => s.duplicateLanguage);
  // An edit left in a background tab keeps its draft in the store; here only the indication of it.
  const drafts = useLanguageDraftStore((s) => s.drafts);
  const openInNewTabAction = useOpenInNewTabAction();
  const state = useCollectionState('lexicon');
  const [collapsed, toggleCollapsed] = usePersistedFlag('lexicon-list-collapsed');

  /** How many words per language — one count for all rows instead of one per row. */
  const wordCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of entries) counts.set(entry.language_id, (counts.get(entry.language_id) ?? 0) + 1);
    return counts;
  }, [entries]);

  return (
    <CollectionDashboard<Language>
      state={state}
      title={t('nav.lexicon')}
      primaryAction={{ label: t('lexicon.newLanguage'), onClick: onCreate }}
      items={languages}
      itemKey={(l) => l.id}
      itemTitle={(l) => l.name}
      itemDate={(l) => l.updated_at}
      itemCount={(l) => wordCounts.get(l.id) ?? 0}
      describe={(language) => ({
        icon: <BlockGlyph icon={language.icon} size={14} />,
        cardIcon: <BlockGlyph icon={language.icon} size={16} />,
        title: language.name,
        meta: (
          <span className="tabular-nums">
            {t('lexicon.wordCount', { count: wordCounts.get(language.id) ?? 0 })}
            {language.alphabet.length > 0 && (
              <> · {t('lexicon.letterCount', { count: language.alphabet.length })}</>
            )}
          </span>
        ),
        trailing: language.id in drafts && <span className="text-xs italic text-subtle flex-shrink-0">{t('editor.unsaved')}</span>,
        // A language with an edit left open goes straight back to it.
        view: language.id in drafts ? { type: 'lexicon', id: language.id, mode: 'edit' } : { type: 'lexicon', id: language.id },
      })}
      contextActions={(language) => [
        openInNewTabAction({ type: 'lexicon', id: language.id }),
        { label: t('contextMenu.duplicate'), icon: <Copy size={12} />, onClick: () => void duplicateLanguage(language.id) },
        { label: t('contextMenu.delete'), icon: <Trash2 size={12} />, onClick: () => onDelete(language), danger: true },
      ]}
      emptyState={{
        icon: AUX_VIEWS.lexicon.icon,
        title: t('emptyState.lexicon.title'),
        description: t('emptyState.lexicon.description'),
        actionLabel: t('lexicon.newLanguage'),
        onAction: onCreate,
      }}
      // Collapsed means an empty list instead of a special branch — like blocks and templates.
      collapsed={collapsed}
      contentHeader={
        <CollapsibleGroupHeader
          label={t('lexicon.languages')}
          collapsed={collapsed}
          onToggleCollapse={toggleCollapsed}
        />
      }
      contentFooter={<TranslatePanel />}
    />
  );
}
