import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Search, X } from 'lucide-react';
import { useLexiconStore, type EntryPatch } from '../../store/lexiconStore';
import { useUndoStore } from '../../store/undoStore';
import { generateId } from '../../lib/helpers';
import { OP_PROP_SELECT_CLASSES } from '../../lib/styleClasses';
import Button from '../ui/Button';
import type { LexiconEntry } from '../../types';

/** Die Spalten der Tabelle. Dieselbe Aufteilung in Kopf und Zeilen — eine Wahrheit, sonst versetzen sie sich. */
const COLUMNS = 'grid grid-cols-[1fr_1fr_minmax(0,0.7fr)_minmax(0,0.9fr)_auto] gap-2 items-center';

/**
 * Die Vokabeln einer Sprache als Tabelle: Begriff, Übersetzung, Aussprache,
 * Notiz. Jedes Feld speichert, sobald es den Fokus verliert — eine Vokabel ist
 * ein Wortpaar und kein Entwurf, ein „Speichern"-Knopf je Zeile wäre eine
 * Bremse beim Eintragen einer Wortliste.
 *
 * Gelöscht wird sofort, mit Rückgängig über die gewohnte Meldung unten links —
 * eine einzelne Vokabel im Papierkorb wäre dort nur Lärm neben Einträgen und
 * Sprachen.
 */
export default function VocabularyTable({ languageId, entries }: {
  languageId: string;
  entries: readonly LexiconEntry[];
}) {
  const { t } = useTranslation();
  const addEntry = useLexiconStore((s) => s.addEntry);
  const updateEntry = useLexiconStore((s) => s.updateEntry);
  const deleteEntry = useLexiconStore((s) => s.deleteEntry);
  const restoreEntry = useLexiconStore((s) => s.restoreEntry);
  const pushUndo = useUndoStore((s) => s.push);
  const [search, setSearch] = useState('');
  /**
   * Die frisch angelegte Zeile bekommt den Fokus — sonst müsste man nach jedem
   * „+" klicken. Danach wird er wieder abgeräumt: bliebe er stehen, risse
   * jedes erneute Rendern (etwa beim Tippen in der Suche) den Cursor zurück
   * in diese Zeile.
   */
  const [focusId, setFocusId] = useState<string | null>(null);

  const query = search.trim().toLowerCase();
  const visible = query
    ? entries.filter((e) => `${e.term} ${e.translation} ${e.pronunciation} ${e.note}`.toLowerCase().includes(query))
    : entries;

  const add = async () => {
    const entry = await addEntry(languageId);
    setFocusId(entry.id);
  };

  const remove = async (entry: LexiconEntry) => {
    let removed: LexiconEntry | undefined;
    try {
      removed = await deleteEntry(entry.id);
    } catch (err) {
      // Nichts verloren: die Vokabel bleibt, wo sie war.
      console.error('[VocabularyTable] deleting the word failed:', err);
      return;
    }
    if (!removed) return;
    pushUndo({
      id: generateId(),
      description: t('undo.wordDeleted'),
      undo: () => restoreEntry(removed),
    });
  };

  return (
    <section className="max-w-4xl">
      <div className="flex items-center gap-2 mb-3">
        <p className="label-xs">{t('lexicon.vocabulary')}</p>
        <span className="text-xs text-stone-600">({entries.length})</span>
        <span className="flex-1" />
        <div className="relative">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-stone-600 pointer-events-none" />
          <input
            className={`${OP_PROP_SELECT_CLASSES} w-48 pl-7`}
            value={search}
            placeholder={t('lexicon.searchWords')}
            aria-label={t('lexicon.searchWords')}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Button tone="jade" small onClick={() => void add()}>
          <Plus size={12} />
          {t('lexicon.addWord')}
        </Button>
      </div>

      {entries.length === 0 ? (
        <p className="text-sm text-stone-600">{t('lexicon.noWords')}</p>
      ) : visible.length === 0 ? (
        <p className="text-sm text-stone-600">{t('search.noResults')}</p>
      ) : (
        <>
          <div className={`${COLUMNS} px-1 mb-1`}>
            <span className="label-xs">{t('lexicon.term')}</span>
            <span className="label-xs">{t('lexicon.translation')}</span>
            <span className="label-xs">{t('lexicon.pronunciation')}</span>
            <span className="label-xs">{t('lexicon.note')}</span>
            {/* Platzhalter über der Spalte des Löschen-Knopfes. */}
            <span className="w-6" />
          </div>
          <div className="space-y-1">
            {visible.map((entry) => (
              <VocabularyRow
                key={entry.id}
                entry={entry}
                autoFocus={entry.id === focusId}
                onFocused={() => setFocusId(null)}
                onPatch={(patch) => void updateEntry(entry.id, patch)}
                onDelete={() => void remove(entry)}
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

/** Die vier Felder als lokaler Stand — geschrieben wird erst beim Verlassen des Feldes. */
type Draft = Pick<LexiconEntry, 'term' | 'translation' | 'pronunciation' | 'note'>;

const FIELDS = ['term', 'translation', 'pronunciation', 'note'] as const;

const draftOf = (e: LexiconEntry): Draft => ({
  term: e.term, translation: e.translation, pronunciation: e.pronunciation, note: e.note,
});

function VocabularyRow({ entry, autoFocus, onFocused, onPatch, onDelete }: {
  entry: LexiconEntry;
  autoFocus: boolean;
  /** Der Fokus ist gesetzt — der Aufrufer darf ihn vergessen. */
  onFocused: () => void;
  onPatch: (patch: EntryPatch) => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<Draft>(() => draftOf(entry));
  const firstField = useRef<HTMLInputElement>(null);
  const previous = useRef(entry);

  /**
   * Nachführen, aber feldweise und nur dort, wo nicht getippt wurde.
   *
   * Speichern ist asynchron: Wer ein Feld verlässt und sofort ins nächste
   * tippt, hat dort schon Text stehen, wenn die Zeile aus dem Store
   * zurückkommt. Ein pauschales `setDraft(draftOf(entry))` risse genau diesen
   * Text wieder heraus. Übernommen wird ein Feld deshalb nur, wenn es sich
   * von außen geändert hat und im Feld noch der vorherige Stand steht.
   */
  useEffect(() => {
    const before = previous.current;
    previous.current = entry;
    if (before === entry) return;
    setDraft((current) => {
      let next = current;
      for (const key of FIELDS) {
        if (entry[key] !== before[key] && current[key] === before[key]) {
          next = next === current ? { ...current } : next;
          next[key] = entry[key];
        }
      }
      return next;
    });
  }, [entry]);

  useEffect(() => {
    if (!autoFocus) return;
    firstField.current?.focus();
    onFocused();
  }, [autoFocus, onFocused]);

  /**
   * Was beim Verlassen der Seite noch offen ist, wird beim Aufräumen
   * geschrieben — wer eine Vokabel tippt und dann die Brotkrume klickt,
   * bekommt keinen Fokusverlust mehr mit.
   */
  const pending = useRef({ draft, entry, onPatch });
  pending.current = { draft, entry, onPatch };
  useEffect(() => () => {
    const { draft: d, entry: e, onPatch: patch } = pending.current;
    const changed = FIELDS.filter((key) => d[key] !== e[key]);
    if (changed.length > 0) patch(Object.fromEntries(changed.map((key) => [key, d[key]])) as EntryPatch);
  }, []);

  const commit = (field: keyof Draft) => {
    if (draft[field] === entry[field]) return;
    onPatch({ [field]: draft[field] } as EntryPatch);
  };

  const field = (name: keyof Draft, label: string, ref?: React.Ref<HTMLInputElement>) => (
    <input
      ref={ref}
      className={`${OP_PROP_SELECT_CLASSES} selectable`}
      value={draft[name]}
      placeholder={label}
      aria-label={label}
      onChange={(e) => setDraft((d) => ({ ...d, [name]: e.target.value }))}
      onBlur={() => commit(name)}
      // Enter bestätigt wie das Verlassen des Feldes — Tippen und Speichern
      // sollen sich nicht unterscheiden, je nachdem womit man abschließt.
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
    />
  );

  return (
    <div className={`${COLUMNS} rounded-md border border-stone-700/40 bg-stone-800/40 px-1 py-1`}>
      {field('term', t('lexicon.term'), firstField)}
      {field('translation', t('lexicon.translation'))}
      {field('pronunciation', t('lexicon.pronunciation'))}
      {field('note', t('lexicon.note'))}
      <Button tone="danger" compact small title={t('common.delete')} aria-label={t('common.delete')} onClick={onDelete}>
        <X size={12} />
      </Button>
    </div>
  );
}
