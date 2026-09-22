import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRightLeft, Check, Copy } from 'lucide-react';
import { useLexiconStore } from '../../store/lexiconStore';
import { usePersistedFlag } from '../../hooks/usePersistedFlag';
import { entriesOfLanguage, translateText, type TranslateDirection, type TranslateMode } from '../../lib/lexicon';
import { GroupDivider } from '../ui/Dashboard';
import Button from '../ui/Button';
import Dropdown from '../ui/Dropdown';

/** Wie lange „Kopiert" nach dem Klick stehen bleibt. */
const COPIED_MS = 1500;

/** Eingabe und Ergebnis stehen nebeneinander und sehen deshalb gleich aus. */
const FIELD_CLASSES =
  'input-field selectable w-full h-40 rounded-md px-3 py-2 text-sm outline-none transition-colors';

/**
 * Das Übersetzen-Feld unter der Sprachliste: Text hinein, Sprache und Richtung
 * wählen, Ergebnis daneben. Es übersetzt bei jedem Zeichen neu — bei einem
 * Lexikon dieser Größe ist das eine Schleife über ein paar hundert Wörter,
 * kein Grund für einen Knopf, der einen Zwischenzustand erzeugt.
 *
 * Übersetzt wird ausschließlich aus dem Vault (`lib/lexicon.ts`): Wort für
 * Wort aus den Vokabeln, Zeichen für Zeichen aus dem Alphabet, oder beides
 * nacheinander. Was die Sprache nicht kennt, steht markiert im Ergebnis —
 * raten kann eine Wortliste nicht, und so zu tun als ob wäre schlimmer als
 * die Lücke zu zeigen.
 */
export default function TranslatePanel() {
  const { t } = useTranslation();
  const languages = useLexiconStore((s) => s.languages);
  const allEntries = useLexiconStore((s) => s.entries);
  const [collapsed, toggleCollapsed] = usePersistedFlag('lexicon-translate-collapsed');

  const [languageId, setLanguageId] = useState('');
  const [direction, setDirection] = useState<TranslateDirection>('toLanguage');
  const [mode, setMode] = useState<TranslateMode>('both');
  const [input, setInput] = useState('');
  const [copied, setCopied] = useState(false);

  // Die erste Sprache, solange keine gewählt ist — und wieder, wenn die
  // gewählte gelöscht wurde.
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
      // Kein Grund für ein Fenster: der Text steht sichtbar da und lässt sich
      // von Hand markieren.
      console.error('[TranslatePanel] copying the translation failed:', err);
    }
  };

  return (
    <div className="mt-8">
      <GroupDivider label={t('lexicon.translate')} collapsed={collapsed} onToggleCollapse={toggleCollapsed} />
      {collapsed ? null : !language ? (
        <p className="text-sm text-stone-600">{t('lexicon.translateNoLanguage')}</p>
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
              {/* Kein `.panel`: das Ergebnis ist das Gegenstück zum Feld links,
                  kein Inhalts-Träger — also dasselbe Maß und derselbe Radius
                  (design.md: was ein Element *ist*, entscheidet). */}
              <div className={`${FIELD_CLASSES} overflow-y-auto text-stone-300 whitespace-pre-wrap break-words`}>
                {result && result.segments.length > 0 ? (
                  result.segments.map((segment, i) => (
                    segment.kind === 'unknown' ? (
                      // Nicht gefunden: das eigene Wort bleibt stehen, gestrichelt
                      // unterstrichen. So ist auf einen Blick zu sehen, was noch
                      // ins Lexikon gehört.
                      <span
                        key={i}
                        title={t(mode === 'letters' ? 'lexicon.unmappedWord' : 'lexicon.unknownWord')}
                        className="text-stone-500 underline decoration-dotted underline-offset-2"
                      >
                        {segment.text}
                      </span>
                    ) : (
                      <span key={i} title={segment.kind === 'gap' ? undefined : segment.source}>{segment.text}</span>
                    )
                  ))
                ) : (
                  <span className="text-stone-600">{t('lexicon.resultPlaceholder')}</span>
                )}
              </div>
              {result && result.wordCount > 0 && (
                <p className="text-xs text-stone-600 mt-2">
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
    </div>
  );
}
