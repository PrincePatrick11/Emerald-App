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

/** Wie lange nach dem letzten Tastendruck gewartet wird, bevor der Name gespeichert wird. */
const SAVE_DELAY_MS = 500;

interface Props {
  language: Language;
  onClose: () => void;
  onDelete: () => void;
}

/**
 * Die Seite einer Sprache: Name als Titel, darunter ihre Vokabeln und ihr
 * Alphabet. In der Seitenleiste Icon und Umfang.
 *
 * Auf demselben `LibraryPageFrame` wie die Seite eines eigenen Blocks und die
 * einer Vorlage, aber ohne deren Entwurfs-Betrieb: hier wird jede Zeile sofort
 * gespeichert, es gibt also nichts zurückzunehmen. Statt Fertig/Löschen/
 * Abbrechen trägt die Leiste nur das Löschen.
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
            <p className="text-xs text-stone-500">
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
 * Ein Feld, das seinen Wert erst nach einer Tippause speichert.
 *
 * Für den Namen einer Sprache: er gehört der Zeile, nicht einem Entwurf, und
 * jedes Zeichen sofort zu schreiben hieße, pro Wort ein halbes Dutzend UPDATEs
 * abzusetzen. Der lokale Stand wird nur nachgeführt, wenn der Wert von außen
 * ein anderer geworden ist — sonst risse jede eigene Speicherung den Cursor an
 * sich.
 */
function useDebouncedField(value: string, onCommit: (value: string) => void) {
  const [draft, setDraft] = useState(value);
  // Der Aufrufer reicht eine frische Funktion je Rendern herein; stünde sie in
  // den Abhängigkeiten, begänne die Wartezeit bei jedem Rendern von vorn.
  const commit = useRef(onCommit);
  commit.current = onCommit;

  // Ein neuer Wert von außen (Sprachwechsel, Rückgängig) setzt das Feld; die
  // eigene Speicherung liefert denselben Wert und lässt den Cursor in Ruhe.
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
