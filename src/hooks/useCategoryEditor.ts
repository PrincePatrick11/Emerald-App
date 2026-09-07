import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/shallow';
import { useUndoStore } from '../store/undoStore';
import { CATEGORY_NAME_TAKEN, useCategoryStore } from '../store/categoryStore';
import { generateId } from '../lib/helpers';
import type { Category } from '../types';

export interface CategoryLike {
  id: string;
  name: string;
  emoji: string;
}

interface UseCategoryEditorOptions {
  /** Vorbelegtes Emoji beim Anlegen — je Modul verschieden, die Liste ist dieselbe. */
  defaultEmoji: string;
  /** Called after a category is successfully created, e.g. to select it and trigger an autosave. */
  onAdded?: (category: Category) => void;
}

/**
 * Add/edit/delete-with-confirm state and handlers over the global category
 * list (`categoryStore`). Ein Hook für Wiki, Operations, Tasks und den
 * Altar-Strip — der Store ist seit v38 für alle derselbe.
 */
export function useCategoryEditor({ defaultEmoji, onAdded }: UseCategoryEditorOptions) {
  const { t } = useTranslation();
  const pushUndo = useUndoStore((s) => s.push);
  const store = useCategoryStore(
    useShallow((s) => ({
      addCategory: s.addCategory,
      updateCategory: s.updateCategory,
      deleteCategory: s.deleteCategory,
      restoreCategory: s.restoreCategory,
    })),
  );

  const [addingCategory, setAddingCategory] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [newCatEmoji, setNewCatEmoji] = useState(defaultEmoji);
  const [editingCatId, setEditingCatId] = useState<string | null>(null);
  const [editCatName, setEditCatName] = useState('');
  const [editCatEmoji, setEditCatEmoji] = useState(defaultEmoji);
  const [confirmDeleteCatId, setConfirmDeleteCatId] = useState<string | null>(null);
  /** Fehlermeldung unter dem Namensfeld — heute nur „Name schon vergeben". */
  const [nameError, setNameError] = useState<string | null>(null);
  /**
   * Die zuletzt hier angelegte Kategorie. Die Views zeigen nur Kategorien mit
   * Einträgen — eine frische hätte sonst keinen Kopf, unter dem man den ersten
   * Eintrag anlegen könnte (`categoriesUsedBy(…, [lastAddedId])`).
   */
  const [lastAddedId, setLastAddedId] = useState<string | null>(null);

  const failedOnName = (err: unknown): boolean => {
    if (err instanceof Error && err.message === CATEGORY_NAME_TAKEN) {
      setNameError(t('categories.nameTaken'));
      return true;
    }
    return false;
  };

  const handleAddCategory = async () => {
    if (!newCatName.trim()) return;
    let cat: Category;
    try {
      cat = await store.addCategory(newCatName.trim(), newCatEmoji);
    } catch (err) {
      if (!failedOnName(err)) console.error('[useCategoryEditor] addCategory failed:', err);
      return;
    }
    setNewCatName('');
    setNewCatEmoji(defaultEmoji);
    setNameError(null);
    setAddingCategory(false);
    setLastAddedId(cat.id);
    onAdded?.(cat);
  };

  const startEditCat = (cat: CategoryLike) => {
    setEditingCatId(cat.id);
    setEditCatName(cat.name);
    setEditCatEmoji(cat.emoji);
    setNameError(null);
  };

  const cancelEditCat = () => {
    setEditingCatId(null);
    setNameError(null);
  };

  const handleSaveEditCat = async () => {
    if (!editingCatId || !editCatName.trim()) return;
    try {
      await store.updateCategory(editingCatId, editCatName.trim(), editCatEmoji);
    } catch (err) {
      if (!failedOnName(err)) console.error('[useCategoryEditor] updateCategory failed:', err);
      return;
    }
    setEditingCatId(null);
    setNameError(null);
  };

  /** Erster Aufruf fragt nach, zweiter löscht. `true`, wenn gelöscht wurde. */
  const handleDeleteCat = async (id: string): Promise<boolean> => {
    if (confirmDeleteCatId !== id) {
      setConfirmDeleteCatId(id);
      return false;
    }
    setConfirmDeleteCatId(null);
    // Eingebaute Kategorien lehnt der Store ab. Ohne diese Prüfung meldete die
    // Oberfläche „Kategorie gelöscht" samt Rückgängig-Knopf für etwas, das nie
    // passiert ist.
    if ((await store.deleteCategory(id)) === false) return false;
    if (editingCatId === id) setEditingCatId(null);
    pushUndo({
      id: generateId(),
      description: t('undo.categoryDeleted'),
      undo: () => store.restoreCategory(id),
    });
    return true;
  };

  return {
    addingCategory, setAddingCategory,
    newCatName, setNewCatName,
    newCatEmoji, setNewCatEmoji,
    editingCatId, setEditingCatId,
    editCatName, setEditCatName,
    editCatEmoji, setEditCatEmoji,
    confirmDeleteCatId, setConfirmDeleteCatId,
    nameError, setNameError,
    lastAddedId,
    handleAddCategory,
    startEditCat,
    cancelEditCat,
    handleSaveEditCat,
    handleDeleteCat,
  };
}

/** Das komplette Editor-Objekt, wie es CategoryHeaderRow/CategoryModal entgegennehmen. */
export type CategoryEditorApi = ReturnType<typeof useCategoryEditor>;
