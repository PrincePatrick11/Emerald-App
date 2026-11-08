import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Trash2 } from 'lucide-react';
import { useImageStore } from '../../store/imageStore';
import { useCategoryStore } from '../../store/categoryStore';
import { useUndoStore } from '../../store/undoStore';
import { categoryLabel } from '../../lib/categories';
import { generateId } from '../../lib/helpers';
import { imageSrc } from '../../lib/images';
import { OP_PROP_SELECT_CLASSES } from '../../lib/styleClasses';
import type { VaultImage } from '../../types';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import EmojiPicker from '../ui/EmojiPicker';
import CategorySelect from '../ui/CategorySelect';
import TagInput from '../ui/TagInput';

/**
 * Name, emoji, category, tags and note of a picture in "Images". A file that
 * is only in the vault so far is taken in on saving; deleting puts the row in
 * the trash, with Undo, and leaves the file to the cleanup.
 */
export default function ImageEditModal({ file, image, onClose }: {
  file: string;
  image: VaultImage | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const categories = useCategoryStore((s) => s.categories);
  const pushUndo = useUndoStore((s) => s.push);
  const [name, setName] = useState(image?.name ?? '');
  const [emoji, setEmoji] = useState(image?.emoji ?? '🖼️');
  const [categoryId, setCategoryId] = useState<string | null>(image?.category_id ?? null);
  const [tags, setTags] = useState<string[]>(image?.tags ?? []);
  const [note, setNote] = useState(image?.note ?? '');

  const save = async () => {
    const patch = { name: name.trim(), emoji, category_id: categoryId, tags, note };
    const store = useImageStore.getState();
    if (image) await store.updateImage(image.id, patch);
    else await store.adoptFile(file, patch);
    onClose();
  };

  const remove = async () => {
    if (!image) return;
    const store = useImageStore.getState();
    await store.deleteImage(image.id);
    pushUndo({ id: generateId(), description: t('undo.imageDeleted'), undo: () => store.restoreImage(image.id) });
    onClose();
  };

  return (
    <Modal
      title={image ? t('images.edit') : t('images.adopt')}
      onClose={onClose}
      widthClassName="w-full max-w-md"
      bodyClassName="modal-body space-y-3"
      footer={
        <>
          {image && (
            <Button tone="danger" className="mr-auto" onClick={remove}>
              <Trash2 size={14} /> {t('common.delete')}
            </Button>
          )}
          <Button tone="neutral" onClick={onClose}>{t('common.cancel')}</Button>
          <Button tone="jade" onClick={save}>{t('common.save')}</Button>
        </>
      }
    >
      <div className="image-edit-preview">
        <img src={imageSrc(file)} alt="" draggable={false} />
      </div>
      <div className="flex items-center gap-2">
        <EmojiPicker
          value={emoji}
          onChange={setEmoji}
          size="lg"
          trigger={({ toggle }) => (
            <button onClick={toggle} className={`${OP_PROP_SELECT_CLASSES} w-11 justify-center text-xl`} title={t('images.emoji')}>
              {emoji}
            </button>
          )}
        />
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void save(); } }}
          placeholder={t('images.name')}
          className={`${OP_PROP_SELECT_CLASSES} selectable flex-1`}
        />
      </div>
      <div>
        <p className="label-xs mb-1">{t('properties.category')}</p>
        <CategorySelect
          categories={categories}
          value={categoryId}
          onChange={setCategoryId}
          getLabel={(c) => categoryLabel(t, c)}
          variant="field"
        />
      </div>
      <div>
        <p className="label-xs mb-1">{t('nav.tags')}</p>
        <TagInput tags={tags} onChange={setTags} />
      </div>
      <div>
        <p className="label-xs mb-1">{t('images.note')}</p>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          className={`${OP_PROP_SELECT_CLASSES} selectable w-full resize-y`}
        />
      </div>
    </Modal>
  );
}
