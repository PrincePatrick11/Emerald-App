import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useUndoStore } from '../store/undoStore';
import { generateId } from '../lib/helpers';

interface CategoryLike {
  id: string;
  name: string;
  emoji: string;
}

interface CategoryEditorStore<C extends CategoryLike> {
  addCategory: (name: string, emoji: string) => Promise<C>;
  updateCategory: (id: string, name: string, emoji: string) => Promise<void>;
  deleteCategory: (id: string) => Promise<void>;
  restoreCategory: (id: string) => Promise<void>;
}

interface UseCategoryEditorOptions<C extends CategoryLike> {
  defaultEmoji: string;
  /** Called after a category is successfully created, e.g. to select it and trigger an autosave. */
  onAdded?: (category: C) => void;
}

/** Shared add/edit/delete-with-confirm state and handlers for a module's category list. */
export function useCategoryEditor<C extends CategoryLike>(
  store: CategoryEditorStore<C>,
  { defaultEmoji, onAdded }: UseCategoryEditorOptions<C>,
) {
  const { t } = useTranslation();
  const pushUndo = useUndoStore((s) => s.push);

  const [addingCategory, setAddingCategory] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [newCatEmoji, setNewCatEmoji] = useState(defaultEmoji);
  const [editingCatId, setEditingCatId] = useState<string | null>(null);
  const [editCatName, setEditCatName] = useState('');
  const [editCatEmoji, setEditCatEmoji] = useState(defaultEmoji);
  const [confirmDeleteCatId, setConfirmDeleteCatId] = useState<string | null>(null);

  const handleAddCategory = async () => {
    if (!newCatName.trim()) return;
    let cat: C;
    try {
      cat = await store.addCategory(newCatName.trim(), newCatEmoji);
    } catch (err) {
      console.error('[useCategoryEditor] addCategory failed:', err);
      return;
    }
    setNewCatName('');
    setNewCatEmoji(defaultEmoji);
    setAddingCategory(false);
    onAdded?.(cat);
  };

  const startEditCat = (cat: C) => {
    setEditingCatId(cat.id);
    setEditCatName(cat.name);
    setEditCatEmoji(cat.emoji);
  };

  const handleSaveEditCat = async () => {
    if (!editingCatId || !editCatName.trim()) return;
    await store.updateCategory(editingCatId, editCatName.trim(), editCatEmoji);
    setEditingCatId(null);
  };

  const handleDeleteCat = async (id: string) => {
    if (confirmDeleteCatId !== id) {
      setConfirmDeleteCatId(id);
      return;
    }
    setConfirmDeleteCatId(null);
    await store.deleteCategory(id);
    pushUndo({
      id: generateId(),
      description: t('undo.categoryDeleted'),
      undo: () => store.restoreCategory(id),
    });
  };

  return {
    addingCategory, setAddingCategory,
    newCatName, setNewCatName,
    newCatEmoji, setNewCatEmoji,
    editingCatId, setEditingCatId,
    editCatName, setEditCatName,
    editCatEmoji, setEditCatEmoji,
    confirmDeleteCatId, setConfirmDeleteCatId,
    handleAddCategory,
    startEditCat,
    handleSaveEditCat,
    handleDeleteCat,
  };
}
