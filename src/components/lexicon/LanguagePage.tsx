import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Trash2 } from 'lucide-react';
import { useLexiconStore } from '../../store/lexiconStore';
import { useShrunkIcon } from '../../hooks/useShrunkIcon';
import { DEFAULT_LANGUAGE_ICON, entriesOfLanguage } from '../../lib/lexicon';
import Button from '../ui/Button';
import LibraryPageFrame from '../ui/LibraryPageFrame';
import PropertiesEditView from '../sidebar/fields/PropertiesEditView';
import IconField from '../sidebar/fields/IconField';
import VocabularyTable from './VocabularyTable';
import AlphabetTable from './AlphabetTable';
import type { Language } from '../../types';

/** How long to wait after the last keystroke before the name is saved. */
const SAVE_DELAY_MS = 500;

interface Props {
  language: Language;
  onClose: () => void;
  onDelete: () => void;
}

/**
 * A language's page: name as title, below it its vocabulary and its
 * alphabet. In the sidebar icon and size.
 *
 * On the same `LibraryPageFrame` as the page of a custom block and that
 * of a template, but without their draft mode: here every row is saved
 * immediately, so there is nothing to take back. Instead of Done/Delete/
 * Cancel the bar carries only Delete.
 */
export default function LanguagePage({ language, onClose, onDelete }: Props) {
  const { t } = useTranslation();
  const entries = useLexiconStore((s) => s.entries);
  const updateLanguage = useLexiconStore((s) => s.updateLanguage);
  const setIcon = useShrunkIcon((icon) => void updateLanguage(language.id, { icon }), 'LanguagePage');

  const words = entriesOfLanguage(entries, language.id);
  const [name, setName] = useDebouncedField(
    language.name,
    (value) => void updateLanguage(language.id, { name: value }),
  );

  return (
    <LibraryPageFrame
      backLabel={t('nav.lexicon')}
      onBack={onClose}
      name={name}
      nameLabel={t('lexicon.name')}
      namePlaceholder={t('lexicon.namePlaceholder')}
      onNameChange={setName}
      actions={(
        <>
          <span className="flex-1" />
          <Button tone="danger" compact title={t('editor.delete')} aria-label={t('editor.delete')} onClick={onDelete}>
            <Trash2 size={14} />
          </Button>
        </>
      )}
      sidebar={(
        <PropertiesEditView>
          <IconField value={language.icon} onChange={(icon) => void setIcon(icon)} fallback={DEFAULT_LANGUAGE_ICON} />

          <div>
            <p className="label-xs mb-2">{t('lexicon.stats')}</p>
            <p className="text-xs text-subtle">
              {t('lexicon.wordCount', { count: words.length })}
              {' · '}
              {t('lexicon.letterCount', { count: language.alphabet.length })}
            </p>
          </div>
        </PropertiesEditView>
      )}
    >
      <VocabularyTable languageId={language.id} entries={words} />
      <AlphabetTable language={language} />
    </LibraryPageFrame>
  );
}

/**
 * A field that only saves its value after a typing pause.
 *
 * For a language's name: it belongs to the row, not to a draft, and
 * writing every character immediately would mean issuing half a dozen UPDATEs
 * per word. The local state is only updated when the value has changed
 * from outside; otherwise each of its own saves would yank the cursor
 * away.
 */
function useDebouncedField(value: string, onCommit: (value: string) => void) {
  const [draft, setDraft] = useState(value);
  // The caller passes in a fresh function on every render; if it were in
  // the dependencies, the wait would start over on every render.
  const commit = useRef(onCommit);
  commit.current = onCommit;

  // A new value from outside (language switch, undo) sets the field; its own
  // save returns the same value and leaves the cursor alone.
  useEffect(() => {
    setDraft((current) => (current === value ? current : value));
  }, [value]);

  useEffect(() => {
    if (draft === value) return;
    const timer = window.setTimeout(() => commit.current(draft), SAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [draft, value]);

  return [draft, setDraft] as const;
}
