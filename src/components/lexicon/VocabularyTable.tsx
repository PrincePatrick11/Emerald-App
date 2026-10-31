import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Search, X } from 'lucide-react';
import { useLexiconStore, type EntryPatch } from '../../store/lexiconStore';
import { useUndoStore } from '../../store/undoStore';
import { generateId } from '../../lib/helpers';
import { OP_PROP_SELECT_CLASSES } from '../../lib/styleClasses';
import Button from '../ui/Button';
import type { LexiconEntry } from '../../types';

/** The columns of the table. The same split in header and rows: one truth, otherwise they drift out of line. */
const COLUMNS = 'grid grid-cols-[1fr_1fr_minmax(0,0.7fr)_minmax(0,0.9fr)_auto] gap-2 items-center';

/**
 * The vocabulary of a language as a table: term, translation, pronunciation,
 * note. Each field saves as soon as it loses focus; a vocabulary item is
 * a word pair and not a draft, and a "Save" button per row would be a
 * drag when entering a word list.
 *
 * Deletion is immediate, with Undo via the usual notice at the bottom left;
 * a single vocabulary item in the trash would just be noise there next to entries and
 * languages.
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
   * The freshly created row gets focus; otherwise you would have to click after every
   * "+". It is cleared again afterwards: if it stayed, every re-render
   * (for instance while typing in the search) would yank the cursor back
   * into this row.
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
      // Nothing lost: the vocabulary item stays where it was.
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
            {/* Placeholder above the column of the delete button. */}
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

/** The four fields as local state; written only when the field is left. */
type Draft = Pick<LexiconEntry, 'term' | 'translation' | 'pronunciation' | 'note'>;

const FIELDS = ['term', 'translation', 'pronunciation', 'note'] as const;

const draftOf = (e: LexiconEntry): Draft => ({
  term: e.term, translation: e.translation, pronunciation: e.pronunciation, note: e.note,
});

function VocabularyRow({ entry, autoFocus, onFocused, onPatch, onDelete }: {
  entry: LexiconEntry;
  autoFocus: boolean;
  /** Focus has been set; the caller may forget it. */
  onFocused: () => void;
  onPatch: (patch: EntryPatch) => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<Draft>(() => draftOf(entry));
  const firstField = useRef<HTMLInputElement>(null);
  const previous = useRef(entry);

  /**
   * Sync, but field by field and only where nothing was typed.
   *
   * Saving is asynchronous: whoever leaves a field and immediately types into
   * the next already has text there by the time the row comes back
   * from the store. A blanket `setDraft(draftOf(entry))` would tear exactly that
   * text out again. A field is therefore only adopted if it has changed
   * from outside and the field still holds the previous state.
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
   * Whatever is still pending when the page is left is written during
   * cleanup; whoever types a vocabulary item and then clicks the back link
   * no longer gets a focus loss.
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
      // Enter confirms like leaving the field; typing and saving
      // should not differ depending on how you finish.
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
