import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/shallow';
import { useTranslation } from 'react-i18next';
import { GripVertical, Pencil, Trash2 } from 'lucide-react';
import { AUX_VIEWS, CATEGORY_MODULE_IDS } from '../../lib/modules';
import { categoryLabel, categoryUsageCounts, emptyCategoryUsage } from '../../lib/categories';
import { CATEGORY_NAME_TAKEN, useCategoryStore } from '../../store/categoryStore';
import { useWikiStore } from '../../store/wikiStore';
import { useOperationStore } from '../../store/operationStore';
import { useTaskStore } from '../../store/taskStore';
import { useAltarStore } from '../../store/altarStore';
import { useUndoStore } from '../../store/undoStore';
import { useDeepLink } from '../../hooks/useDeepLink';
import { generateId } from '../../lib/helpers';
import Button from '../ui/Button';
import Dashboard from '../ui/Dashboard';
import EmojiPicker from '../ui/EmojiPicker';
import InlineConfirm from '../ui/InlineConfirm';
import InlineNameEditor from '../ui/InlineNameEditor';
import ModuleCounts from '../ui/ModuleCounts';
import type { Category } from '../../types';

/** Vorbelegung beim Anlegen: modulneutral, dieselbe Glyphe wie das Sammelbecken. */
const DEFAULT_EMOJI = '📦';

/** Wie lange die per Tiefenlink angesprungene Zeile hervorgehoben bleibt. */
const HIGHLIGHT_MS = 2000;

/**
 * Anlegen und Bearbeiten schließen sich aus — ein Zustand statt zwei parallelen
 * Tripeln, damit das nicht bloß in den Reset-Listen mehrerer Handler steht.
 */
type FormState =
  | { mode: 'add' }
  | { mode: 'edit'; id: string };

/**
 * Emoji-Trigger vor dem Namens-Editor — die eine Zeile für Entwurf und
 * Bearbeitung. Als Komponente mit benannten Props: als Helfer mit sechs
 * Stellungsparametern ließen sich Emoji und Name (beide `string`) oder
 * Speichern und Abbrechen (beide `() => void`) lautlos vertauschen.
 */
function CategoryEditRow({
  emoji, onEmoji, name, onName, error, onSave, onCancel,
}: {
  emoji: string;
  onEmoji: (value: string) => void;
  name: string;
  onName: (value: string) => void;
  error: string | null;
  onSave: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-3 rounded-md border border-stone-600/70 bg-stone-800/60 px-3 py-2">
      {/* Platzhalter für den Ziehgriff der Lesezeile — ohne ihn sprängen Emoji
          und Name beim Wechsel in den Bearbeitungsmodus nach links. */}
      <span className="w-3 flex-shrink-0" />
      <EmojiPicker
        value={emoji}
        onChange={onEmoji}
        trigger={({ toggle }) => (
          <button
            onClick={toggle}
            className="w-5 text-center flex-shrink-0 text-base hover:opacity-70 transition-opacity"
          >
            {emoji}
          </button>
        )}
      />
      <InlineNameEditor value={name} onChange={onName} error={error} onSave={onSave} onCancel={onCancel}
        placeholder={t('categories.name')} />
    </div>
  );
}

/**
 * Die eine Verwaltung der globalen Kategorienliste: anlegen, umbenennen,
 * Emoji, löschen, Reihenfolge. Die Module weisen Kategorien nur noch zu und
 * gruppieren nach ihnen — hier gehört die Liste als Liste hin, samt der
 * Antwort darauf, wer eine Kategorie überhaupt benutzt.
 *
 * `Dashboard` liefert den Kopf — Titel, „Kategorie hinzufügen" und die Suche —
 * und portalt ihn wie in jedem Modul in die rechte Seitenleiste, sobald die
 * offen ist. Ansicht und Sortierung bleiben weg: die Ordnung dieser Liste ist
 * die von Hand gezogene `sort_order`, ein Sortier-Dropdown darüber widerspräche
 * sich. Der Inhalt läuft über `grouping: { mode: 'custom' }`, weil die Liste
 * weder Gruppen noch Karten kennt.
 */
export default function CategoriesView() {
  const { t } = useTranslation();
  const { categories, addCategory, updateCategory, deleteCategory, restoreCategory, reorderCategories } =
    useCategoryStore(
      useShallow((s) => ({
        categories: s.categories,
        addCategory: s.addCategory,
        updateCategory: s.updateCategory,
        deleteCategory: s.deleteCategory,
        restoreCategory: s.restoreCategory,
        reorderCategories: s.reorderCategories,
      })),
    );
  const pushUndo = useUndoStore((s) => s.push);

  // Kein fetch beim Mount: reloadAllStores() lädt beim Start und beim
  // Vault-Wechsel alle vier Modul-Stores samt Kategorien.
  const articles = useWikiStore((s) => s.articles);
  const operations = useOperationStore((s) => s.operations);
  const tasks = useTaskStore((s) => s.tasks);
  const items = useAltarStore((s) => s.items);

  const [form, setForm] = useState<FormState | null>(null);
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState(DEFAULT_EMOJI);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  /** Fehlermeldung neben dem Namensfeld — heute nur „Name schon vergeben". */
  const [nameError, setNameError] = useState<string | null>(null);

  /**
   * Der Tiefenlink aus der globalen Suche scrollt zur Zeile und hebt sie kurz
   * hervor — es gibt hier keine Auswahl, an der ein Treffer sonst
   * hängenbleiben könnte.
   */
  const [highlightId, setHighlightId] = useState<string | null>(null);
  useDeepLink({
    type: 'categories',
    items: categories,
    rowAttribute: 'data-category-id',
    onOpen: (cat) => setHighlightId(cat.id),
  });

  // Das Ausblenden hängt an `highlightId`, nicht am Tiefenlink: dort räumte
  // jede Kategorienänderung innerhalb der zwei Sekunden den Timer ab — die
  // Hervorhebung bliebe bis zum Verlassen der Ansicht stehen.
  useEffect(() => {
    if (!highlightId) return;
    const timer = window.setTimeout(() => setHighlightId(null), HIGHLIGHT_MS);
    return () => window.clearTimeout(timer);
  }, [highlightId]);

  /**
   * Zwei Feinheiten der Zahlen: Unteraufgaben zählen mit (sie tragen eine
   * eigene `category_id`, die ein endgültiges Löschen mit umhängt), und die
   * Stores halten nur lebende Zeilen — was im Papierkorb liegt, zählt nicht.
   */
  const countsById = useMemo(
    () => categoryUsageCounts({ wiki: articles, operations, tasks, altar: items }),
    [articles, operations, tasks, items],
  );

  // ── Drag-Sortieren ────────────────────────────────────────────────────────
  // Dasselbe Pointer-Muster wie die Ebenenliste im Altar-Panel: kein
  // HTML5-Drag, kein Paket. `visualRef` hält die Endordnung für die
  // pointerup-Closure, die sonst den Stand vom Drag-Beginn sähe.
  const [dragState, setDragState] = useState<{ fromId: string; overIndex: number } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const visualRef = useRef<Category[]>([]);

  const query = search.trim().toLowerCase();
  /**
   * Die Suche dünnt nur aus. Ziehen ist dabei gesperrt: `reorderCategories`
   * schreibt die komplette Ordnung, aus einer gefilterten Liste käme die
   * Reihenfolge der ausgeblendeten Kategorien nicht zurück.
   */
  const matches = useMemo(
    () => (query ? categories.filter((c) => categoryLabel(t, c).toLowerCase().includes(query)) : categories),
    [categories, query, t],
  );

  const visualCategories = useMemo(() => {
    if (!dragState) return matches;
    const list = [...categories];
    const fromIdx = list.findIndex((c) => c.id === dragState.fromId);
    if (fromIdx < 0) return categories;
    const [item] = list.splice(fromIdx, 1);
    list.splice(Math.min(dragState.overIndex, list.length), 0, item);
    return list;
  }, [dragState, categories, matches]);
  useEffect(() => { visualRef.current = visualCategories; }, [visualCategories]);

  const startDrag = useCallback((e: React.PointerEvent, fromId: string) => {
    e.preventDefault();
    const fromIndex = categories.findIndex((c) => c.id === fromId);
    setDragState({ fromId, overIndex: fromIndex });

    const getOverIndex = (clientY: number): number => {
      if (!listRef.current) return fromIndex;
      const rows = Array.from(listRef.current.children) as HTMLElement[];
      let best = 0, bestDist = Infinity;
      rows.forEach((row, i) => {
        const rect = row.getBoundingClientRect();
        const dist = Math.abs(clientY - (rect.top + rect.height / 2));
        if (dist < bestDist) { bestDist = dist; best = i; }
      });
      return best;
    };

    const onMove = (ev: PointerEvent) => {
      setDragState((prev) => (prev ? { ...prev, overIndex: getOverIndex(ev.clientY) } : null));
    };
    const onUp = () => {
      const order = visualRef.current.map((c) => c.id);
      // Ein Fehlklick auf den Griff soll kein UPDATE über die ganze Tabelle auslösen.
      if (order.some((id, i) => categories[i]?.id !== id)) reorderCategories(order);
      setDragState(null);
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }, [categories, reorderCategories]);

  // ── Anlegen / Bearbeiten / Löschen ────────────────────────────────────────
  const openForm = (next: FormState, withName: string, withEmoji: string) => {
    setConfirmDeleteId(null);
    setNameError(null);
    setName(withName);
    setEmoji(withEmoji);
    setForm(next);
  };

  const closeForm = () => {
    setConfirmDeleteId(null);
    setNameError(null);
    setForm(null);
  };

  /** Legt an oder speichert um — je nachdem, welches Formular offen ist. */
  const submitForm = async () => {
    const trimmed = name.trim();
    if (!form || !trimmed) return;
    try {
      if (form.mode === 'add') await addCategory(trimmed, emoji);
      else await updateCategory(form.id, trimmed, emoji);
    } catch (err) {
      // Der Store wirft bei vergebenem Namen, statt einen Fehlerwert zu liefern.
      if (err instanceof Error && err.message === CATEGORY_NAME_TAKEN) setNameError(t('categories.nameTaken'));
      else console.error('[CategoriesView] saving the category failed:', err);
      return;
    }
    closeForm();
  };

  /** Erster Aufruf fragt nach, zweiter löscht. */
  const handleDelete = async (id: string) => {
    if (confirmDeleteId !== id) {
      setConfirmDeleteId(id);
      return;
    }
    setConfirmDeleteId(null);
    // Eingebaute Kategorien lehnt der Store ab. Ohne diese Prüfung meldete die
    // Oberfläche „Kategorie gelöscht" samt Rückgängig-Knopf für etwas, das nie
    // passiert ist.
    if ((await deleteCategory(id)) === false) return;
    pushUndo({
      id: generateId(),
      description: t('undo.categoryDeleted'),
      undo: () => restoreCategory(id),
    });
  };

  const formProps = {
    emoji,
    onEmoji: setEmoji,
    name,
    onName: (value: string) => { setName(value); setNameError(null); },
    error: nameError,
    onSave: submitForm,
    onCancel: closeForm,
  };

  // ── Zeilen ────────────────────────────────────────────────────────────────
  const renderRow = (cat: Category) => {
    if (form?.mode === 'edit' && form.id === cat.id) {
      return <CategoryEditRow key={cat.id} {...formProps} />;
    }

    const counts = countsById.get(cat.id) ?? emptyCategoryUsage();
    const isDragging = dragState?.fromId === cat.id;
    const confirming = confirmDeleteId === cat.id;

    return (
      <div
        key={cat.id}
        data-category-id={cat.id}
        title={cat.is_builtin ? t('categories.builtinHint') : undefined}
        className={`flex items-center gap-3 rounded-md border px-3 py-2 transition-colors ${
          isDragging
            ? 'border-jade-600/70 bg-jade-900/30 opacity-50'
            : highlightId === cat.id
              ? 'border-jade-600/70 bg-jade-900/30'
              : 'border-stone-700/40 bg-stone-800/50 hover:border-stone-500/70'
        }`}
      >
        {query ? (
          // Platz halten, damit die gefilterte Liste nicht um 12px verspringt.
          <span className="w-3 flex-shrink-0" />
        ) : (
          <span
            onPointerDown={(e) => startDrag(e, cat.id)}
            className="flex-shrink-0 cursor-grab active:cursor-grabbing touch-none text-stone-600 hover:text-stone-400 transition-colors"
          >
            <GripVertical size={12} />
          </span>
        )}
        <span className="w-5 text-center flex-shrink-0 text-base">{cat.emoji}</span>
        <span className="flex-1 min-w-0 truncate text-sm text-stone-200">{categoryLabel(t, cat)}</span>

        <ModuleCounts modules={CATEGORY_MODULE_IDS} counts={counts} />

        {/* Sigillen: nicht löschbar, und ein Umbenennen liefe ins Leere — der
            Name kommt aus der Locale, nicht aus der Zeile. Der Block bleibt
            trotzdem stehen, sonst rückte die Zahlenspalte dieser einen Zeile um
            die Breite der beiden Knöpfe aus der Flucht. */}
        <span className="flex items-center justify-end gap-1.5 flex-shrink-0 min-w-[54px]">
          {cat.is_builtin ? null : (
            confirming ? (
              <InlineConfirm small onConfirm={() => handleDelete(cat.id)} onCancel={() => setConfirmDeleteId(null)} />
            ) : (
              <>
                <Button
                  tone="amber" compact small
                  title={t('editor.edit')} aria-label={t('editor.edit')}
                  onClick={() => openForm({ mode: 'edit', id: cat.id }, cat.name, cat.emoji)}
                >
                  <Pencil size={12} />
                </Button>
                <Button tone="danger" compact small title={t('common.delete')} aria-label={t('common.delete')} onClick={() => handleDelete(cat.id)}>
                  <Trash2 size={12} />
                </Button>
              </>
            )
          )}
        </span>
      </div>
    );
  };


  return (
    <Dashboard<Category>
      title={t('nav.categories')}
      titleIcon={AUX_VIEWS.categories.icon}
      titleCount={categories.length}
      primaryAction={{ label: t('categories.add'), onClick: () => openForm({ mode: 'add' }, '', DEFAULT_EMOJI) }}
      search={search}
      onSearch={setSearch}
      items={categories}
      itemKey={(cat) => cat.id}
      grouping={{
        mode: 'custom',
        render: () => (
          <div className="max-w-2xl">
            {query
              ? visualCategories.length === 0 && <p className="text-sm text-stone-600">{t('search.noResults')}</p>
              : <p className="text-xs text-stone-600 mb-3">{t('categories.dragHint')}</p>}
            <div ref={listRef} className="space-y-1">
              {visualCategories.map(renderRow)}
            </div>
            {/* Der Entwurf steht bewusst außerhalb der Liste: er wäre sonst ein
                Kind mehr, über das die Index-Rechnung des Ziehens stolpert. */}
            {form?.mode === 'add' && (
              <div className="mt-1">
                <CategoryEditRow {...formProps} />
              </div>
            )}
          </div>
        ),
      }}
    />
  );
}
