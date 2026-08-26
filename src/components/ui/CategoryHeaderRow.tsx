import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, X, Trash2, Pencil } from 'lucide-react';
import EmojiPicker from './EmojiPicker';
import Button from './Button';
import type { CategoryEditorApi, CategoryLike } from '../../hooks/useCategoryEditor';

interface Props<C extends CategoryLike> {
  category: C;
  /** Fertig aufgelöster Anzeigename — categoryLabel() für Wiki/Operations, cat.name für Tasks. */
  label: string;
  editor: CategoryEditorApi<C>;
  /** Blendet den Lösch-Knopf aus: Wiki/Ops geben `!cat.is_builtin`, Tasks `id !== FALLBACK_CATEGORY.tasks`. */
  canDelete?: boolean;
  /** Nur im Lese-Modus gerendert (Tasks: Collapse-Chevron). */
  leading?: ReactNode;
  /** Nur im Lese-Modus, hinter dem Label (Tasks: „(n)"-Zähler). */
  meta?: ReactNode;
  /** Nur im Lese-Modus, vor dem Bearbeiten-Stift (Tasks: „+"-Knopf). */
  actions?: ReactNode;
}

/**
 * Kopfzeile einer Kategorie-Gruppe in Wiki, Operations und Tasks — Lese- und
 * Bearbeitungsmodus samt Lösch-Bestätigung. Der Zustand kommt komplett aus
 * useCategoryEditor; modulspezifisches läuft über label und die Slots.
 */
export default function CategoryHeaderRow<C extends CategoryLike>({
  category, label, editor, canDelete = true, leading, meta, actions,
}: Props<C>) {
  const { t } = useTranslation();

  const cancelEdit = () => {
    editor.setEditingCatId(null);
    // Sonst bleibt die Ja/Nein-Löschfrage stehen und erscheint beim nächsten Öffnen.
    editor.setConfirmDeleteCatId(null);
  };

  if (editor.editingCatId === category.id) {
    return (
      <div className="flex items-center gap-2 mb-2">
        <EmojiPicker
          value={editor.editCatEmoji}
          onChange={editor.setEditCatEmoji}
          trigger={({ toggle }) => (
            <button
              onClick={toggle}
              className="w-5 text-center flex-shrink-0 text-base hover:opacity-70 transition-opacity"
            >
              {editor.editCatEmoji}
            </button>
          )}
        />
        <input
          autoFocus
          value={editor.editCatName}
          onChange={(e) => editor.setEditCatName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') editor.handleSaveEditCat();
            if (e.key === 'Escape') cancelEdit();
          }}
          className="input-field flex-1 rounded-md px-2 py-0.5 text-xs outline-none font-semibold uppercase tracking-wider"
        />
        {/* Rohe Buttons statt btn-ghost: die Theme-Regel .btn-ghost:hover (0-3-0)
            schlägt text-jade-400 und würde die Jade-Färbung beim Hover schlucken. */}
        <button onClick={editor.handleSaveEditCat} className="text-jade-400 hover:text-jade-300"><Check size={12} /></button>
        <button onClick={cancelEdit} className="text-stone-600 hover:text-stone-400"><X size={12} /></button>
        {canDelete && (
          editor.confirmDeleteCatId === category.id ? (
            <>
              <Button onClick={() => editor.handleDeleteCat(category.id)} variant="danger" className="text-xs px-1">{t('trash.confirmYes')}</Button>
              <Button onClick={() => editor.setConfirmDeleteCatId(null)} variant="ghost" className="text-xs">{t('trash.confirmNo')}</Button>
            </>
          ) : (
            <Button onClick={() => editor.handleDeleteCat(category.id)} variant="danger" className="p-0.5 ml-1">
              <Trash2 size={12} />
            </Button>
          )
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 mb-2">
      {leading}
      <span className="w-5 text-center flex-shrink-0 text-base">{category.emoji}</span>
      <p className="text-xs text-stone-600 font-semibold uppercase tracking-wider flex-1">{label}</p>
      {meta}
      {actions}
      {/* Roh statt btn-ghost: das 11px-Icon soll bündig in der Textzeile sitzen,
          Button-Padding würde die Zeilenhöhe aufblähen. War in allen drei Views identisch. */}
      <button
        onClick={() => editor.startEditCat(category)}
        className="text-stone-500 hover:text-stone-300 transition-colors p-0.5"
        title={t('editor.edit')}
      >
        <Pencil size={11} />
      </button>
    </div>
  );
}
