import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { BookA, CaseSensitive, Smile } from 'lucide-react';
import { useLexiconStore } from '../../store/lexiconStore';
import { useLanguageDraftStore } from '../../store/draftStore';
import { useDraftPage } from '../../hooks/useDraftPage';
import { useShrunkIcon } from '../../hooks/useShrunkIcon';
import { formatEntryDate } from '../../lib/formatDate';
import { DEFAULT_LANGUAGE_ICON, entriesOfLanguage, isFilledPair, languageDraftOf, wordDraftOf } from '../../lib/lexicon';
import LibraryPageFrame from '../ui/LibraryPageFrame';
import { PropertiesSection } from '../sidebar/fields/EntryReadSections';
import { EditSidebarBody, MediaPropertyRow } from '../sidebar/fields/EditProperties';
import { SidebarPropertyRow } from '../sidebar/fields/SidebarSection';
import { FaviconGlyph } from '../sidebar/fields/Favicon';
import VocabularyTable from './VocabularyTable';
import AlphabetTable from './AlphabetTable';
import type { AlphabetPair, Language } from '../../types';

/** The two counts in the properties: how many words, how many character pairs. */
function CountRows({ words, alphabet }: { words: number; alphabet: readonly AlphabetPair[] }) {
  const { t } = useTranslation();
  return (
    <>
      <SidebarPropertyRow icon={<BookA size={14} />} label={t('lexicon.vocabulary')} value={String(words)} />
      <SidebarPropertyRow icon={<CaseSensitive size={14} />} label={t('lexicon.alphabet')} value={String(alphabet.filter(isFilledPair).length)} />
    </>
  );
}

/**
 * A language's read view (`{ type: 'lexicon', id }`): name as heading, the
 * date of the last change top right, below it its vocabulary and its
 * alphabet. In the sidebar "Edit" and the properties — like an entry.
 */
export function LanguagePage({ language, onClose, onEdit }: {
  language: Language;
  onClose: () => void;
  onEdit: () => void;
}) {
  const { t } = useTranslation();
  const entries = useLexiconStore((s) => s.entries);
  const words = entriesOfLanguage(entries, language.id).map(wordDraftOf);

  return (
    <LibraryPageFrame
      backLabel={t('nav.lexicon')}
      onBack={onClose}
      read={{ onEdit, meta: <span>{formatEntryDate(language.updated_at)}</span> }}
      name={language.name}
      nameLabel={t('lexicon.name')}
      namePlaceholder={t('lexicon.namePlaceholder')}
      sidebar={(
        <EditSidebarBody>
          <PropertiesSection>
            <SidebarPropertyRow icon={<Smile size={14} />} label={t('properties.icon')} value={<FaviconGlyph value={language.icon} className="w-4 h-4 text-sm" />} />
            <CountRows words={words.length} alphabet={language.alphabet} />
          </PropertiesSection>
        </EditSidebarBody>
      )}
    >
      <VocabularyTable words={words} />
      <AlphabetTable alphabet={language.alphabet} />
    </LibraryPageFrame>
  );
}

/**
 * A language while editing (`{ type: 'lexicon', id, mode: 'edit' }`): name,
 * icon, words and alphabet as one draft (`useDraftPage`), saved with "Done"
 * and dropped with "Cancel" — both lead back to the read view. Above the
 * title "Editing…", on the tab the dot, as with an entry; leaving with
 * changes any other way asks.
 */
export function LanguageEditor({ language, onClose, onDone, onDelete, isNew }: {
  language: Language;
  /** Back to the list (the link above the title); asks if something changed. */
  onClose: () => void;
  /** Back to the read view, after "Done" or "Cancel". */
  onDone: () => void;
  onDelete: () => void;
  /** Just created with "New": "Cancel" moves it to the trash (`onDelete`). */
  isNew?: boolean;
}) {
  const { t } = useTranslation();
  const entries = useLexiconStore((s) => s.entries);
  const saveLanguage = useLexiconStore((s) => s.saveLanguage);
  // The ids of the words the page opened with — the only ones "Done" may delete (`wordChanges`).
  const openedWith = useRef<string[]>([]);
  const { base, draft, patch, dirty, busy, finish, cancel } = useDraftPage({
    store: useLanguageDraftStore,
    viewType: 'lexicon',
    id: language.id,
    label: (current) => current.name.trim() || t('lexicon.defaultName'),
    saved: languageDraftOf(language, entries),
    save: (id, changes) => saveLanguage(id, changes, openedWith.current),
    onClose: onDone,
    onCancelNew: isNew ? onDelete : undefined,
    logTag: 'LanguageEditor',
  });
  openedWith.current = base.words.map((word) => word.id);
  const setIcon = useShrunkIcon((icon) => patch({ icon }), 'LanguageEditor');

  return (
    <LibraryPageFrame
      backLabel={t('nav.lexicon')}
      onBack={onClose}
      draft={{ dirty, busy, onDone: () => void finish(), onCancel: cancel, onDelete, markUnsaved: false }}
      name={draft.name}
      nameLabel={t('lexicon.name')}
      namePlaceholder={t('lexicon.namePlaceholder')}
      onNameChange={(name) => patch({ name })}
      sidebar={(
        <EditSidebarBody>
          <PropertiesSection>
            <MediaPropertyRow
              rowIcon={<Smile size={14} />}
              label={t('properties.icon')}
              kind="icon"
              value={draft.icon}
              onChange={(icon) => void setIcon(icon)}
              fallback={DEFAULT_LANGUAGE_ICON}
            />
            <CountRows words={draft.words.length} alphabet={draft.alphabet} />
          </PropertiesSection>
        </EditSidebarBody>
      )}
    >
      <VocabularyTable words={draft.words} onChange={(words) => patch({ words })} />
      <AlphabetTable alphabet={draft.alphabet} onChange={(alphabet) => patch({ alphabet })} />
    </LibraryPageFrame>
  );
}
