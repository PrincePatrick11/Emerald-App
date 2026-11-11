import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ImagePlus, X } from 'lucide-react';
import { useImageStore } from '../../store/imageStore';
import { reportImageError } from '../../store/imageNoticeStore';
import { ACCEPTED_IMAGE_MIME } from '../../lib/helpers';
import { imageSrc } from '../../lib/images';
import { getDb } from '../../lib/db';
import {
  acceptedImageFiles, acceptedImagePaths, fileBaseName as baseName, storeImageFile, storeImageFromPath,
} from '../../lib/storeImage';
import { OP_PROP_SELECT_CLASSES } from '../../lib/styleClasses';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import TagInput from '../ui/TagInput';

/** A picture waiting in the dialog: stored already, its details still open. */
interface Staged {
  file: string;
  name: string;
  /** The name it was staged with: only a name typed over it renames a picture already in "Images". */
  staged: string;
}

/**
 * Adding pictures to "Images": drop files from the disk onto the dialog (or
 * choose them), name each, give them all tags, then add. A picture already
 * there keeps its name and gains the tags (`takeIn`). A file is stored as
 * it comes in, prepared like any inserted image (limits, photo as JPEG); one
 * left out with Cancel stays unreferenced and goes with the next cleanup.
 * Files dropped onto the view open the dialog with them (`dropped`).
 */
export default function AddImagesModal({ dropped, dragOver, initialTags, onClose }: {
  /** Paths dropped from the disk, taken in as they arrive. */
  dropped: string[];
  dragOver: boolean;
  /** Tags the new pictures start with (the tag a canvas' strip shows). */
  initialTags?: string[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [staged, setStaged] = useState<Staged[]>([]);
  const [tags, setTags] = useState<string[]>(() => initialTags ?? []);
  const [busy, setBusy] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const take = async <T,>(items: T[], store: (item: T) => Promise<string>, name: (item: T) => string, label: (item: T) => string) => {
    setBusy((n) => n + items.length);
    for (const item of items) {
      try {
        const file = await store(item);
        // A picture already in "Images" (from the trash too) keeps its name (`takeIn`): shown as it is.
        const [known] = await (await getDb()).select<{ name: string }[]>('SELECT name FROM images WHERE file=$1', [file]);
        const shown = known?.name || name(item);
        setStaged((list) => (list.some((s) => s.file === file) ? list : [...list, { file, name: shown, staged: shown }]));
      } catch (e) {
        reportImageError(e, `add ${label(item)}`);
      } finally {
        setBusy((n) => n - 1);
      }
    }
  };

  const handled = useRef(0);
  useEffect(() => {
    const fresh = dropped.slice(handled.current);
    handled.current = dropped.length;
    if (!fresh.length) return;
    void take(acceptedImagePaths(fresh), storeImageFromPath, baseName, (p) => p);
  }, [dropped]);

  const choose = (list: FileList | null) => {
    void take(acceptedImageFiles(Array.from(list ?? [])), storeImageFile, (f) => baseName(f.name), (f) => f.name);
  };

  const add = async () => {
    const store = useImageStore.getState();
    for (const item of staged) {
      const row = await store.takeIn(item.file, { name: item.name, tags });
      // A name typed over the one it was staged with.
      const typed = item.name.trim();
      if (row && typed && typed !== item.staged.trim() && row.name !== typed) await store.updateImage(row.id, { name: typed });
    }
    await store.refreshFiles();
    onClose();
  };

  return (
    <Modal
      title={t('images.add')}
      onClose={onClose}
      widthClassName="w-full max-w-lg"
      bodyClassName="modal-body space-y-3"
      footer={
        <>
          <Button tone="neutral" onClick={onClose}>{t('common.cancel')}</Button>
          <Button tone="jade" onClick={add} disabled={!staged.length || busy > 0}>
            {t('images.addCount', { count: staged.length })}
          </Button>
        </>
      }
    >
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className={`image-drop-zone${dragOver ? ' image-drop-zone--over' : ''}`}
      >
        <ImagePlus size={22} />
        <span>{busy > 0 ? t('images.storing') : t('images.dropHere')}</span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_IMAGE_MIME}
        multiple
        className="hidden"
        onChange={(e) => { choose(e.target.files); e.target.value = ''; }}
      />
      {staged.length > 0 && (
        <ul className="image-staged-list">
          {staged.map((item) => (
            <li key={item.file} className="image-staged-row">
              <img src={imageSrc(item.file)} alt="" draggable={false} />
              <input
                value={item.name}
                onChange={(e) => setStaged((list) => list.map((s) => (s.file === item.file ? { ...s, name: e.target.value } : s)))}
                placeholder={t('images.name')}
                className={`${OP_PROP_SELECT_CLASSES} selectable flex-1`}
              />
              <Button
                tone="neutral"
                compact
                title={t('images.leaveOut')}
                aria-label={t('images.leaveOut')}
                onClick={() => setStaged((list) => list.filter((s) => s.file !== item.file))}
              >
                <X size={14} />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {(staged.length > 0 || !!initialTags?.length) && (
        <div>
          <p className="label-xs mb-1">{t('images.tagsForAll')}</p>
          <TagInput tags={tags} onChange={setTags} flush />
        </div>
      )}
    </Modal>
  );
}
