import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Trash2 } from 'lucide-react';
import { useImageStore } from '../../store/imageStore';
import { useUndoStore } from '../../store/undoStore';
import { generateId } from '../../lib/helpers';
import { imageSrc } from '../../lib/images';
import { OP_PROP_SELECT_CLASSES } from '../../lib/styleClasses';
import type { VaultImage } from '../../types';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import TagInput from '../ui/TagInput';

/**
 * Name, tags and note of a picture in "Images". A file without details so far
 * gets them on saving; deleting puts the row in the trash, with Undo, and
 * leaves the file to the cleanup.
 */
export default function ImageEditModal({ file, image, onClose }: {
  file: string;
  image: VaultImage | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const pushUndo = useUndoStore((s) => s.push);
  const [name, setName] = useState(image?.name ?? '');
  const [tags, setTags] = useState<string[]>(image?.tags ?? []);
  const [note, setNote] = useState(image?.note ?? '');

  const save = async () => {
    await useImageStore.getState().saveDetails(file, { name: name.trim(), tags, note });
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
      title={t('images.edit')}
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
      <p className="label-xs -mb-2">{t('images.name')}</p>
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void save(); } }}
        placeholder={t('images.name')}
        className={`${OP_PROP_SELECT_CLASSES} selectable w-full`}
      />
      <div>
        <p className="label-xs mb-1">{t('nav.tags')}</p>
        <TagInput tags={tags} onChange={setTags} flush />
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
