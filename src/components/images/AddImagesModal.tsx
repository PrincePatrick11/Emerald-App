import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ImagePlus, X } from 'lucide-react';
import { useImageStore } from '../../store/imageStore';
import { reportImageError, useImageNoticeStore } from '../../store/imageNoticeStore';
import { ACCEPTED_IMAGE_MIME, isAcceptedImageFile } from '../../lib/helpers';
import { imageSrc } from '../../lib/images';
import { fileBaseName as baseName, storeImageFile, storeImageFromPath } from '../../lib/storeImage';
import { OP_PROP_SELECT_CLASSES } from '../../lib/styleClasses';
import { DROPPED_IMAGE_RE } from '../../hooks/useFileDrop';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import TagInput from '../ui/TagInput';

/** A picture waiting in the dialog: stored already, its details still open. */
interface Staged {
  file: string;
  name: string;
}

/**
 * Adding pictures to "Images": drop files from the disk onto the dialog (or
 * choose them), name each, give them all tags, then add. A file is stored as
 * it comes in, prepared like any inserted image (limits, photo as JPEG); one
 * left out with Cancel stays unreferenced and goes with the next cleanup.
 * Files dropped onto the view open the dialog with them (`dropped`).
 */
export default function AddImagesModal({ dropped, dragOver, onClose }: {
  /** Paths dropped from the disk, taken in as they arrive. */
  dropped: string[];
  dragOver: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [staged, setStaged] = useState<Staged[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [busy, setBusy] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const take = async <T,>(items: T[], store: (item: T) => Promise<string>, name: (item: T) => string, label: (item: T) => string) => {
    setBusy((n) => n + items.length);
    for (const item of items) {
      try {
        const file = await store(item);
        setStaged((list) => (list.some((s) => s.file === file) ? list : [...list, { file, name: name(item) }]));
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
    const images = fresh.filter((p) => DROPPED_IMAGE_RE.test(p));
    if (images.length < fresh.length) useImageNoticeStore.getState().show({ kind: 'format' });
    void take(images, storeImageFromPath, baseName, (p) => p);
  }, [dropped]);

  const choose = (list: FileList | null) => {
    const files = Array.from(list ?? []);
    const images = files.filter(isAcceptedImageFile);
    if (images.length < files.length) useImageNoticeStore.getState().show({ kind: 'format' });
    void take(images, storeImageFile, (f) => baseName(f.name), (f) => f.name);
  };

  const add = async () => {
    const store = useImageStore.getState();
    for (const item of staged) await store.saveDetails(item.file, { name: item.name.trim(), tags });
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
        <>
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
          <div>
            <p className="label-xs mb-1">{t('images.tagsForAll')}</p>
            <TagInput tags={tags} onChange={setTags} flush />
          </div>
        </>
      )}
    </Modal>
  );
}
