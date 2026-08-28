import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, X, Trash2, Pencil, Plus } from 'lucide-react';
import EmojiPicker from './EmojiPicker';
import Button from './Button';
import CollapsibleGroupHeader from './CollapsibleGroupHeader';
import type { CategoryEditorApi, CategoryLike } from '../../hooks/useCategoryEditor';

interface Props<C extends CategoryLike> {
  category: C;
  /** Fertig aufgelöster Anzeigename — categoryLabel() für Wiki/Operations, cat.name für Tasks. */
  label: string;
  editor: CategoryEditorApi<C>;
  /** Blendet den Lösch-Knopf aus: Wiki/Ops geben `!cat.is_builtin`, Tasks `id !== FALLBACK_CATEGORY.tasks`. */
  canDelete?: boolean;
  /** Zusammen mit `collapsed`: rendert den Auf-/Zuklapp-Chevron vor dem Emoji (nur Lese-Modus). */
  onToggleCollapse?: () => void;
  collapsed?: boolean;
  /** Der „(n)"-Zähler hinter dem Label (nur Lese-Modus). */
  count?: number;
  /** Zusammen mit `addTitle`: der „+"-Knopf vor dem Bearbeiten-Stift —
   *  „Eintrag direkt in dieser Kategorie anlegen" (nur Lese-Modus). */
  onAdd?: () => void;
  addTitle?: string;
  /** Nur im Lese-Modus, hinter dem Zähler. */
  meta?: ReactNode;
  /** Nur im Lese-Modus, vor dem Bearbeiten-Stift. */
  actions?: ReactNode;
}

/**
 * Kopfzeile einer Kategorie-Gruppe in Wiki, Operations und Tasks — Lese- und
 * Bearbeitungsmodus samt Lösch-Bestätigung. Der Zustand kommt komplett aus
 * useCategoryEditor; modulspezifisches läuft über label und die Slots.
 */
export default function CategoryHeaderRow<C extends CategoryLike>({
  category, label, editor, canDelete = true, onToggleCollapse, collapsed = false, count, onAdd, addTitle, meta, actions,
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
        {/* Die getönten Row-Actions der Button-Komponente wie im VaultModal,
            in der 24px-small-Reihe — 30px würde die Kategoriezeile aufblähen. */}
        <Button tone="jade" compact small title={t('common.save')} aria-label={t('common.save')} onClick={editor.handleSaveEditCat}>
          <Check size={12} />
        </Button>
        <Button tone="neutral" compact small title={t('common.cancel')} aria-label={t('common.cancel')} onClick={cancelEdit}>
          <X size={12} />
        </Button>
        {canDelete && (
          editor.confirmDeleteCatId === category.id ? (
            <>
              <Button onClick={() => editor.handleDeleteCat(category.id)} tone="danger" small className="shrink-0">{t('common.confirmYes')}</Button>
              <Button onClick={() => editor.setConfirmDeleteCatId(null)} tone="neutral" small className="shrink-0">{t('common.confirmNo')}</Button>
            </>
          ) : (
            <Button tone="danger" compact small title={t('common.delete')} aria-label={t('common.delete')} onClick={() => editor.handleDeleteCat(category.id)}>
              <Trash2 size={12} />
            </Button>
          )
        )}
      </div>
    );
  }

  return (
    <CollapsibleGroupHeader
      onToggleCollapse={onToggleCollapse}
      collapsed={collapsed}
      emoji={category.emoji}
      label={label}
      count={count}
      meta={meta}
      actions={
        <>
          {/* Dieselben getönten Row-Actions wie im Editiermodus — jade fürs
              Anlegen, amber fürs Bearbeiten, in der 24px-small-Reihe. */}
          {onAdd && (
            <Button tone="jade" compact small title={addTitle} aria-label={addTitle} onClick={onAdd}>
              <Plus size={12} />
            </Button>
          )}
          {actions}
          <Button
            tone="amber"
            compact
            small
            title={t('editor.edit')}
            aria-label={t('editor.edit')}
            onClick={() => editor.startEditCat(category)}
          >
            <Pencil size={12} />
          </Button>
        </>
      }
    />
  );
}
