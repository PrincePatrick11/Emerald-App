import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/shallow';
import { ImagePlus, Trash2 } from 'lucide-react';
import { useAltarStore } from '../../store/altarStore';
import { useUndoStore } from '../../store/undoStore';
import { categoryLabel } from '../../lib/categories';
import { readFileAsDataUrl, ACCEPTED_IMAGE_MIME, generateId, isAcceptedImageFile } from '../../lib/helpers';
import { ImageTooLargeError, imageSizeLabel, prepareImageDataUrl } from '../../lib/imageLimits';
import { imageSrc } from '../../lib/images';
import type { AltarItem, Category } from '../../types';
import Modal from '../ui/Modal';
import EmojiPicker from '../ui/EmojiPicker';
import Button from '../ui/Button';
import CategorySelect from '../ui/CategorySelect';
import { OP_PROP_SELECT_CLASSES } from '../../lib/styleClasses';

const IMAGE_MAX_BYTES = 2 * 1024 * 1024; // 2 MB

/**
 * Creating and editing a library element. One modal for the strip in the
 * editor and the library section in the dashboard.
 */
export function AltarItemModal({
  item,
  categories,
  defaultCategory,
  onClose,
}: {
  item: AltarItem | null;
  /** The full list: an element may go into any category, even one that so far only the wiki uses. */
  categories: Category[];
  defaultCategory: string | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { addItem, updateItem, deleteItem, restoreItem } = useAltarStore(
    useShallow((s) => ({ addItem: s.addItem, updateItem: s.updateItem, deleteItem: s.deleteItem, restoreItem: s.restoreItem })),
  );
  const pushUndo = useUndoStore((s) => s.push);
  const [editName, setEditName] = useState(item?.name ?? '');
  const [editEmoji, setEditEmoji] = useState(item?.emoji ?? '');
  const [editCategory, setEditCategory] = useState<string | null>(item?.category_id ?? defaultCategory);
  const [editImageData, setEditImageData] = useState<string | null>(item?.image_data ?? null);
  const [imageError, setImageError] = useState<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const getCategoryEmoji = (catId: string | null) => (catId ? categories.find((c) => c.id === catId)?.emoji : undefined) ?? '✨';

  // A self-chosen emoji survives a category change. Only if the element
  // so far carried the default emoji of its category does it follow the new one.
  const changeCategory = (catId: string | null) => {
    if (editEmoji === getCategoryEmoji(editCategory)) setEditEmoji('');
    setEditCategory(catId);
  };

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!isAcceptedImageFile(file)) {
      setImageError(t('common.unsupportedImageFormat'));
      e.target.value = '';
      return;
    }
    setImageError(null);
    // Shrink first, then check: a large photo often fits under the fixed cap
    // once shrunk. The notice is shown in its own row; a notice in the
    // modal above it would also close this dialog on Escape.
    readFileAsDataUrl(file).then((data) => prepareImageDataUrl(data, { capBytes: IMAGE_MAX_BYTES })).then((data) => {
      setEditImageData(data);
      if (!editName.trim()) {
        setEditName(file.name.replace(/\.[^.]+$/, ''));
        setTimeout(() => nameInputRef.current?.select(), 0);
      }
    }).catch((err) => {
      if (err instanceof ImageTooLargeError) {
        setImageError(t('altar.imageTooLarge', { max: imageSizeLabel(err.maxBytes, t('common.megabytes')) }));
      } else {
        console.error('[altar] could not read image', err);
      }
    });
    e.target.value = '';
  };

  const save = async () => {
    if (!editName.trim()) return;
    const fallbackEmoji = getCategoryEmoji(editCategory);
    if (item) {
      await updateItem(item.id, {
        name: editName.trim(),
        emoji: editEmoji || fallbackEmoji,
        category_id: editCategory,
        image_data: editImageData ?? undefined,
      });
    } else {
      await addItem(editName.trim(), editEmoji || fallbackEmoji, editCategory, undefined, editImageData ?? undefined);
    }
    onClose();
  };

  // To the trash without confirmation: gone from every altar, it comes back
  // to the same places with Undo or from the trash.
  const doDelete = async () => {
    if (!item) return;
    await deleteItem(item.id);
    pushUndo({ id: generateId(), description: t('undo.altarItemDeleted'), undo: () => restoreItem(item.id) });
    onClose();
  };

  return (
    <Modal
      title={item ? t('editor.edit') : t('altar.addElement')}
      onClose={onClose}
      widthClassName="w-full max-w-md"
      bodyClassName="px-3.5 py-4 space-y-3"
      footer={
        <>
          {item && (
            <Button tone="danger" className="mr-auto" onClick={doDelete} title={t('common.delete')}>
              <Trash2 size={14} /> {t('common.delete')}
            </Button>
          )}
          <Button tone="neutral" onClick={onClose}>{t('common.cancel')}</Button>
          <Button tone="jade" onClick={save} disabled={!editName.trim()}>{t('common.save')}</Button>
        </>
      }
    >
        <div className="flex items-center gap-2">
          <EmojiPicker
            value={editEmoji}
            onChange={(emoji) => { setEditEmoji(emoji); setEditImageData(null); }}
            size="lg"
            wrapperClassName="relative flex-1"
            trigger={({ toggle }) => (
              <button onClick={toggle} className={`${OP_PROP_SELECT_CLASSES} flex items-center gap-2`}>
                {imageSrc(editImageData)
                  ? <img src={imageSrc(editImageData)} alt="" className="w-6 h-6 object-contain rounded-md" />
                  : <span className="text-xl">{editEmoji || getCategoryEmoji(editCategory)}</span>}
                <span className="text-xs text-subtle">{t('altar.chooseEmoji')}</span>
              </button>
            )}
          />
          <Button tone="neutral" compact title={t('altar.uploadImage')} aria-label={t('altar.uploadImage')} onClick={() => imageInputRef.current?.click()}><ImagePlus size={14} /></Button>
        </div>
        {imageError && <p className="text-xs text-danger">{imageError}</p>}
        <input ref={imageInputRef} type="file" accept={ACCEPTED_IMAGE_MIME} className="hidden" onChange={handleImageChange} />
        <input ref={nameInputRef} value={editName} onChange={(e) => setEditName(e.target.value)} placeholder={t('altar.elementName')} className={`${OP_PROP_SELECT_CLASSES} selectable`} />
        <div>
          <p className="label-xs mb-1">{t('properties.category')}</p>
          <CategorySelect
            categories={categories}
            value={editCategory}
            onChange={changeCategory}
            getLabel={(c) => categoryLabel(t, c)}
            variant="field"
          />
        </div>
    </Modal>
  );
}
