import { Check, X, Plus } from 'lucide-react';
import EmojiPicker from './EmojiPicker';
import type { CategoryEditorApi } from '../../hooks/useCategoryEditor';

interface Props {
  editor: Pick<CategoryEditorApi,
    'addingCategory' | 'setAddingCategory'
    | 'newCatName' | 'setNewCatName'
    | 'newCatEmoji' | 'setNewCatEmoji'
    | 'handleAddCategory'>;
  /** t('wiki.addCategory') / t('operations.addCategory') / t('tasks.newCategory') */
  buttonLabel: string;
  /** t('<module>.categoryName') */
  placeholder: string;
}

/**
 * „Kategorie hinzufügen"-Zeile in Wiki, Operations und Tasks: eingeklappt der
 * Plus-Knopf, aufgeklappt EmojiPicker + Eingabefeld + Speichern/Abbrechen.
 */
export default function CategoryAddRow({ editor, buttonLabel, placeholder }: Props) {
  if (!editor.addingCategory) {
    return (
      <button
        onClick={() => editor.setAddingCategory(true)}
        className="flex items-center gap-2 mb-2 w-full text-stone-600 hover:text-stone-400 transition-colors"
      >
        <span className="w-5 flex items-center justify-center flex-shrink-0"><Plus size={18} /></span>
        <span className="flex-1 text-left text-xs font-semibold uppercase tracking-wider">{buttonLabel}</span>
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2 mb-2">
      <EmojiPicker
        value={editor.newCatEmoji}
        onChange={editor.setNewCatEmoji}
        trigger={({ toggle }) => (
          <button
            onClick={toggle}
            className="w-5 text-center flex-shrink-0 text-base hover:opacity-70 transition-opacity"
          >
            {editor.newCatEmoji}
          </button>
        )}
      />
      <input
        autoFocus
        value={editor.newCatName}
        onChange={(e) => editor.setNewCatName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') editor.handleAddCategory();
          if (e.key === 'Escape') editor.setAddingCategory(false);
        }}
        placeholder={placeholder}
        className="input-field flex-1 rounded-md px-2 py-0.5 text-xs outline-none font-semibold uppercase tracking-wider"
      />
      {/* Rohe Buttons statt btn-ghost: die Theme-Regel .btn-ghost:hover (0-3-0)
          schlägt text-jade-400 und würde die Jade-Färbung beim Hover schlucken. */}
      <button onClick={editor.handleAddCategory} className="text-jade-400 hover:text-jade-300"><Check size={12} /></button>
      <button onClick={() => editor.setAddingCategory(false)} className="text-stone-600 hover:text-stone-400"><X size={12} /></button>
    </div>
  );
}
