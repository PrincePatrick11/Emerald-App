import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/shallow';
import { ImagePlus, Trash2 } from 'lucide-react';
import { useAltarStore } from '../../store/altarStore';
import { categoryLabel } from '../../lib/categories';
import { readFileAsDataUrl, ACCEPTED_IMAGE_MIME, isAcceptedImageFile } from '../../lib/helpers';
import { imageSrc } from '../../lib/images';
import type { AltarItem, Category } from '../../types';
import Modal from '../ui/Modal';
import EmojiPicker from '../ui/EmojiPicker';
import Button from '../ui/Button';
import InlineConfirm from '../ui/InlineConfirm';
import CategorySelect from '../ui/CategorySelect';

const IMAGE_MAX_BYTES = 2 * 1024 * 1024; // 2 MB

/**
 * Anlegen und Bearbeiten eines Bibliothekselements. Ein Modal für die Leiste
 * im Editor und den Bibliotheks-Teil im Dashboard.
 */
export function AltarItemModal({
  item,
  categories,
  defaultCategory,
  onClose,
}: {
  item: AltarItem | null;
  /** Die Volliste — ein Element darf in jede Kategorie, auch eine, die bisher nur das Wiki nutzt. */
  categories: Category[];
  defaultCategory: string | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { addItem, updateItem, deleteItem } = useAltarStore(
    useShallow((s) => ({ addItem: s.addItem, updateItem: s.updateItem, deleteItem: s.deleteItem })),
  );
  const [editName, setEditName] = useState(item?.name ?? '');
  const [editEmoji, setEditEmoji] = useState(item?.emoji ?? '');
  const [editCategory, setEditCategory] = useState<string | null>(item?.category_id ?? defaultCategory);
  const [editImageData, setEditImageData] = useState<string | null>(item?.image_data ?? null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const getCategoryEmoji = (catId: string | null) => (catId ? categories.find((c) => c.id === catId)?.emoji : undefined) ?? '✨';

  // Ein selbst gewähltes Emoji überlebt den Kategoriewechsel. Nur wenn das
  // Element bisher das Standard-Emoji seiner Kategorie trug, folgt es der neuen.
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
    if (file.size > IMAGE_MAX_BYTES) {
      setImageError(t('altar.imageTooLarge', { max: '2 MB' }));
      e.target.value = '';
      return;
    }
    setImageError(null);
    readFileAsDataUrl(file).then((data) => {
      setEditImageData(data);
      if (!editName.trim()) {
        setEditName(file.name.replace(/\.[^.]+$/, ''));
        setTimeout(() => nameInputRef.current?.select(), 0);
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

  const doDelete = async () => {
    if (!item) return;
    if (!confirmDelete) { setConfirmDelete(true); return; }
    await deleteItem(item.id);
    onClose();
  };

  return (
    <Modal
      title={item ? t('editor.edit') : t('altar.addElement')}
      onClose={onClose}
      widthClassName="w-full max-w-md"
      bodyClassName="p-4 space-y-3"
    >
        <div className="flex items-center gap-2">
          <EmojiPicker
            value={editEmoji}
            onChange={(emoji) => { setEditEmoji(emoji); setEditImageData(null); }}
            size="lg"
            wrapperClassName="relative flex-1"
            trigger={({ toggle }) => (
              <button onClick={toggle} className="w-full flex items-center gap-2 bg-stone-800/60 rounded-lg px-3 py-2 text-sm hover:bg-stone-700/60 transition-colors">
                {imageSrc(editImageData)
                  ? <img src={imageSrc(editImageData)} alt="" className="w-6 h-6 object-contain rounded" />
                  : <span className="text-xl">{editEmoji || getCategoryEmoji(editCategory)}</span>}
                <span className="text-xs text-stone-500">{t('altar.chooseEmoji')}</span>
              </button>
            )}
          />
          <Button tone="neutral" compact title={t('altar.uploadImage')} aria-label={t('altar.uploadImage')} onClick={() => imageInputRef.current?.click()}><ImagePlus size={14} /></Button>
        </div>
        {imageError && <p className="text-xs text-red-400">{imageError}</p>}
        <input ref={imageInputRef} type="file" accept={ACCEPTED_IMAGE_MIME} className="hidden" onChange={handleImageChange} />
        <input ref={nameInputRef} value={editName} onChange={(e) => setEditName(e.target.value)} placeholder={t('altar.elementName')} className="w-full bg-stone-800/60 rounded-lg px-3 py-2 text-xs text-stone-200 outline-none selectable" />
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
        {item && confirmDelete ? (
          <InlineConfirm variant="banner" message={t('common.deleteConfirm')} onConfirm={doDelete} onCancel={() => setConfirmDelete(false)} />
        ) : (
          <div className="flex items-center justify-between gap-2">
            {item ? (
              <Button tone="danger" onClick={doDelete} title={t('common.delete')}>
                <Trash2 size={12} /> {t('common.delete')}
              </Button>
            ) : <span />}
            <span className="flex items-center gap-2">
              <Button tone="neutral" onClick={onClose}>{t('common.cancel')}</Button>
              <Button tone="jade" onClick={save} disabled={!editName.trim()}>{t('common.save')}</Button>
            </span>
          </div>
        )}
    </Modal>
  );
}
