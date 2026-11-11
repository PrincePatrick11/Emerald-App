import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRightLeft, Check, Copy } from 'lucide-react';
import { useLexiconStore } from '../../store/lexiconStore';
import { entriesOfLanguage, translateText, type TranslateDirection, type TranslateMode } from '../../lib/lexicon';
import DashboardSection from '../ui/DashboardSection';
import Button from '../ui/Button';
import EmptyState from '../ui/EmptyState';
import Dropdown from '../ui/Dropdown';

/** How long "Copied" stays after the click. */
const COPIED_MS = 1500;

/** Input and result stand side by side and therefore look the same. */
const FIELD_CLASSES =
  'input-field selectable w-full h-40 rounded-md px-3 py-2 text-sm outline-none transition-colors';

/**
 * The translate field below the language list: text in, choose language and
 * direction, result beside it. It translates anew on every character; for a
 * lexicon of this size that is a loop over a few hundred words,
 * no reason for a button that creates an intermediate state.
 *
 * Translation uses the vault exclusively (`lib/lexicon.ts`): word by
 * word from the vocabulary, character by character from the alphabet, or both
 * in sequence. What the language does not know is marked in the result;
 * a word list cannot guess, and pretending otherwise would be worse than
 * showing the gap.
 */
export default function TranslatePanel() {
  const { t } = useTranslation();
  const languages = useLexiconStore((s) => s.languages);
  const allEntries = useLexiconStore((s) => s.entries);

  const [languageId, setLanguageId] = useState('');
  const [direction, setDirection] = useState<TranslateDirection>('toLanguage');
  const [mode, setMode] = useState<TranslateMode>('both');
  const [input, setInput] = useState('');
  const [copied, setCopied] = useState(false);

  // The first language as long as none is chosen, and again when the
  // chosen one was deleted.
  const language = languages.find((l) => l.id === languageId) ?? languages[0] ?? null;

  const entries = useMemo(
    () => (language ? entriesOfLanguage(allEntries, language.id) : []),
    [allEntries, language],
  );

  const result = useMemo(
    () => (language ? translateText(input, language, entries, direction, mode) : null),
    [input, language, entries, direction, mode],
  );

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), COPIED_MS);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    if (!result?.text) return;
    try {
      await navigator.clipboard.writeText(result.text);
      setCopied(true);
    } catch (err) {
      // No reason for a window: the text is visibly there and can be
      // selected by hand.
      console.error('[TranslatePanel] copying the translation failed:', err);
    }
  };

  return (
    <DashboardSection storageKey="lexicon-translate-collapsed" label={t('lexicon.translate')}>
      {!language ? (
        // No button: "New language" is already in the section above.
        <EmptyState
          icon={ArrowRightLeft}
          title={t('emptyState.translate.title')}
          description={t('emptyState.translate.description')}
        />
      ) : (
        <div className="max-w-5xl">
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <Dropdown
              label={t('lexicon.language')}
              value={language.id}
              options={languages.map((l) => ({ value: l.id, label: l.name, emoji: l.icon }))}
              onChange={setLanguageId}
            />
            <Button
              tone="neutral"
              small
              title={t('lexicon.swapDirection')}
              onClick={() => setDirection((d) => (d === 'toLanguage' ? 'fromLanguage' : 'toLanguage'))}
            >
              <ArrowRightLeft size={12} />
              {direction === 'toLanguage'
                ? t('lexicon.intoLanguage', { name: language.name })
                : t('lexicon.outOfLanguage', { name: language.name })}
            </Button>
            <Dropdown
              label={t('lexicon.mode')}
              value={mode}
              options={[
                { value: 'both', label: t('lexicon.modes.both') },
                { value: 'words', label: t('lexicon.modes.words') },
                { value: 'letters', label: t('lexicon.modes.letters') },
              ]}
              onChange={(v) => setMode(v as TranslateMode)}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <div>
              <p className="label-xs mb-2">{t('lexicon.yourText')}</p>
              <textarea
                className={`${FIELD_CLASSES} resize-y`}
                value={input}
                placeholder={t('lexicon.inputPlaceholder')}
                aria-label={t('lexicon.yourText')}
                onChange={(e) => setInput(e.target.value)}
              />
            </div>

            <div>
              <div className="flex items-center gap-2 mb-2">
                <p className="label-xs">{t('lexicon.result')}</p>
                <span className="flex-1" />
                <Button tone="neutral" small disabled={!result?.text} title={t('lexicon.copy')} onClick={() => void copy()}>
                  {copied ? <Check size={12} /> : <Copy size={12} />}
                  {copied ? t('lexicon.copied') : t('lexicon.copy')}
                </Button>
              </div>
              {/* No `.panel`: the result is the counterpart to the field on the left,
                  not a content container, so the same size and the same radius
                  (design.md: what an element *is* decides). */}
              <div className={`${FIELD_CLASSES} overflow-y-auto text-soft whitespace-pre-wrap break-words`}>
                {result && result.segments.length > 0 ? (
                  result.segments.map((segment, i) => (
                    segment.kind === 'unknown' ? (
                      // Not found: the original word stays, underlined with
                      // a dashed line. That way you can see at a glance what still
                      // belongs in the lexicon.
                      <span
                        key={i}
                        title={t(mode === 'letters' ? 'lexicon.unmappedWord' : 'lexicon.unknownWord')}
                        className="text-subtle underline decoration-dotted underline-offset-2"
                      >
                        {segment.text}
                      </span>
                    ) : (
                      <span key={i} title={segment.kind === 'gap' ? undefined : segment.source}>{segment.text}</span>
                    )
                  ))
                ) : (
                  <span className="text-subtle">{t('lexicon.resultPlaceholder')}</span>
                )}
              </div>
              {result && result.wordCount > 0 && (
                <p className="text-xs text-subtle mt-2">
                  {t('lexicon.textWordCount', { count: result.wordCount })}
                  {result.unknownCount > 0 && (
                    <> · {t(mode === 'letters' ? 'lexicon.unmappedCount' : 'lexicon.unknownCount', { count: result.unknownCount })}</>
                  )}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </DashboardSection>
  );
}
