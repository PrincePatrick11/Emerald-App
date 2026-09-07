import { useTranslation } from 'react-i18next';
import { Trash2 } from 'lucide-react';
import Modal from './Modal';
import EmojiPicker from './EmojiPicker';
import Button from './Button';
import type { CategoryEditorApi } from '../../hooks/useCategoryEditor';
import type { Category } from '../../types';

interface Props {
  editor: CategoryEditorApi;
  /**
   * Bearbeiten-Modus: die Kategorie, die gerade in `editor.editingCatId`
   * steht. Nur der Altar-Strip nutzt das — Wiki, Operations und Tasks
   * bearbeiten inline in der CategoryHeaderRow und lassen das Prop weg,
   * damit deren Inline-Editor das Modal nicht mit öffnet.
   */
  editing?: Category | null;
}

/**
 * „Kategorie hinzufügen"-Modal in Wiki, Operations, Tasks und Altar — geöffnet
 * vom „Kategorie"-Knopf in der Dashboard-Kopfzeile (secondaryAction) bzw. der
 * Altar-Tab-Leiste. Aufbau wie die Namens-Editier-Zeile im VaultModal:
 * Emoji-Trigger + Eingabefeld in einer Reihe, darunter die getönten
 * Speichern/Abbrechen-Buttons. Enter speichert. Mit `editing` wird daraus das
 * Bearbeiten-Modal samt Löschen mit Rückfrage.
 */
export default function CategoryModal({ editor, editing = null }: Props) {
  const { t } = useTranslation();

  const isEdit = !!editing && editor.editingCatId === editing.id;
  if (!editor.addingCategory && !isEdit) return null;

  const name = isEdit ? editor.editCatName : editor.newCatName;
  const setName = isEdit ? editor.setEditCatName : editor.setNewCatName;
  const emoji = isEdit ? editor.editCatEmoji : editor.newCatEmoji;
  const setEmoji = isEdit ? editor.setEditCatEmoji : editor.setNewCatEmoji;
  const save = isEdit ? editor.handleSaveEditCat : editor.handleAddCategory;
  const close = () => {
    editor.setConfirmDeleteCatId(null);
    if (isEdit) editor.cancelEditCat();
    else { editor.setAddingCategory(false); editor.setNameError(null); }
  };
  const confirmingDelete = isEdit && editor.confirmDeleteCatId === editing.id;

  return (
    <Modal
      title={isEdit ? t('editor.edit') : t('categories.add')}
      onClose={close}
      widthClassName="w-full max-w-xs"
      bodyClassName="p-4 space-y-3"
    >
      <div className="flex gap-2 items-center">
        <EmojiPicker
          value={emoji}
          onChange={setEmoji}
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
              {emoji}
            </button>
          )}
        />
        <input
          autoFocus
          value={name}
          onChange={(e) => { setName(e.target.value); editor.setNameError(null); }}
          onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
          placeholder={t('categories.name')}
          className="input-field flex-1 min-w-0 rounded-lg px-2.5 py-1.5 text-sm outline-none selectable"
        />
      </div>
      {editor.nameError && <p className="text-xs text-[var(--danger-text)]">{editor.nameError}</p>}
      {confirmingDelete ? (
        <div className="flex items-center justify-between rounded-lg border border-red-700/40 bg-red-950/20 px-3 py-2">
          <span className="text-xs text-red-300">{t('common.deleteConfirm')}</span>
          <span className="flex items-center gap-2">
            <Button tone="danger" onClick={async () => { if (await editor.handleDeleteCat(editing.id)) close(); }}>
              {t('common.confirmYes')}
            </Button>
            <Button tone="neutral" onClick={() => editor.setConfirmDeleteCatId(null)}>{t('common.confirmNo')}</Button>
          </span>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2">
          {isEdit && !editing.is_builtin ? (
            <Button tone="danger" onClick={() => editor.handleDeleteCat(editing.id)} title={t('common.delete')}>
              <Trash2 size={12} /> {t('common.delete')}
            </Button>
          ) : <span />}
          <span className="flex items-center gap-2">
            <Button tone="neutral" onClick={close}>{t('common.cancel')}</Button>
            <Button tone="jade" onClick={save} disabled={!name.trim()}>
              {t('common.save')}
            </Button>
          </span>
        </div>
      )}
    </Modal>
  );
}
