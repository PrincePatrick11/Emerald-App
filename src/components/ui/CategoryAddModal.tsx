import { useTranslation } from 'react-i18next';
import Modal from './Modal';
import EmojiPicker from './EmojiPicker';
import Button from './Button';
import type { CategoryEditorApi } from '../../hooks/useCategoryEditor';

interface Props {
  editor: Pick<CategoryEditorApi,
    'addingCategory' | 'setAddingCategory'
    | 'newCatName' | 'setNewCatName'
    | 'newCatEmoji' | 'setNewCatEmoji'
    | 'handleAddCategory'>;
  /** t('wiki.addCategory') / t('operations.addCategory') / t('tasks.newCategory') */
  title: string;
  /** t('<module>.categoryName') */
  placeholder: string;
}

/**
 * „Kategorie hinzufügen"-Modal in Wiki, Operations und Tasks — geöffnet vom
 * „Kategorie"-Knopf in der Dashboard-Kopfzeile (secondaryAction). Aufbau wie
 * die Namens-Editier-Zeile im VaultModal: Emoji-Trigger + Eingabefeld in einer
 * Reihe, darunter die getönten Speichern/Abbrechen-Buttons. Enter speichert.
 * Rendert sich nur bei editor.addingCategory.
 */
export default function CategoryAddModal({ editor, title, placeholder }: Props) {
  const { t } = useTranslation();

  if (!editor.addingCategory) return null;

  const close = () => editor.setAddingCategory(false);

  return (
    <Modal title={title} onClose={close} widthClassName="w-full max-w-xs" bodyClassName="p-4 space-y-3">
      <div className="flex gap-2 items-center">
        <EmojiPicker
          value={editor.newCatEmoji}
          onChange={editor.setNewCatEmoji}
          size="lg"
          trigger={({ toggle }) => (
            // Auf derselben Fläche wie das Eingabefeld daneben. h-[34px] ist
            // dessen exakte Höhe (py-1.5 + text-sm + Rand); self-stretch geht
            // nicht, weil EmojiPicker den Trigger in ein eigenes div wickelt.
            <button
              type="button"
              onClick={toggle}
              className="input-field w-9 h-[34px] rounded-lg shrink-0 flex items-center justify-center text-xl hover:opacity-80 transition-opacity"
            >
              {editor.newCatEmoji}
            </button>
          )}
        />
        <input
          autoFocus
          value={editor.newCatName}
          onChange={(e) => editor.setNewCatName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') editor.handleAddCategory(); }}
          placeholder={placeholder}
          className="input-field flex-1 min-w-0 rounded-lg px-2.5 py-1.5 text-sm outline-none selectable"
        />
      </div>
      <div className="flex items-center justify-end gap-2">
        <Button tone="neutral" onClick={close}>{t('common.cancel')}</Button>
        <Button tone="jade" onClick={editor.handleAddCategory} disabled={!editor.newCatName.trim()}>
          {t('common.save')}
        </Button>
      </div>
    </Modal>
  );
}
