import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HardDrive } from 'lucide-react';
import { useImageStore } from '../../store/imageStore';
import { reportImageError, useImageNoticeStore } from '../../store/imageNoticeStore';
import { settlePick, useImagePickerStore } from '../../store/imagePickerStore';
import { ACCEPTED_IMAGE_MIME, isAcceptedImageFile } from '../../lib/helpers';
import { fileBaseName, storeImageFile, storeImageFromPath } from '../../lib/storeImage';
import { DROPPED_IMAGE_RE, useFileDrop } from '../../hooks/useFileDrop';
import { searchPictures, useVaultPictures } from '../../hooks/useVaultPictures';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import { ListSearchField } from '../ui/ListToolbar';
import ImageTile from './ImageTile';

/**
 * The picture picker: where a place inserts pictures (the text's image
 * button and `/` menu, an image field). It shows "Images" to choose from —
 * a click selects, a double click takes that one right away — and takes
 * files from the disk too, by button or by dropping them on the window:
 * those are stored, taken into "Images" under their file name, and inserted.
 */
export default function ImagePickerModal({ multiple }: { multiple: boolean }) {
  const { t } = useTranslation();
  const { pictures } = useVaultPictures();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const shown = searchPictures(pictures, search);

  const toggle = (file: string) => setSelected((list) => {
    if (!multiple) return [file];
    return list.includes(file) ? list.filter((f) => f !== file) : [...list, file];
  });

  /** Files from the disk: stored, taken into "Images", inserted. */
  const takeFromDisk = async <T,>(items: T[], store: (item: T) => Promise<string>, name: (item: T) => string, label: (item: T) => string) => {
    if (!items.length) return;
    setBusy(true);
    const files: string[] = [];
    for (const item of (multiple ? items : items.slice(0, 1))) {
      try {
        const file = await store(item);
        await useImageStore.getState().takeIn(file, { name: name(item) });
        files.push(file);
      } catch (e) {
        reportImageError(e, `pick ${label(item)}`);
      }
    }
    setBusy(false);
    if (files.length) settlePick(files);
  };

  useFileDrop(true, (paths) => {
    const images = paths.filter((p) => DROPPED_IMAGE_RE.test(p));
    if (images.length < paths.length) useImageNoticeStore.getState().show({ kind: 'format' });
    void takeFromDisk(images, storeImageFromPath, fileBaseName, (p) => p);
  });

  const choose = (list: FileList | null) => {
    const files = Array.from(list ?? []);
    const images = files.filter(isAcceptedImageFile);
    if (images.length < files.length) useImageNoticeStore.getState().show({ kind: 'format' });
    void takeFromDisk(images, storeImageFile, (f) => fileBaseName(f.name), (f) => f.name);
  };

  return (
    <Modal
      title={multiple ? t('images.pickTitle') : t('images.pickOneTitle')}
      onClose={() => settlePick(null)}
      widthClassName="w-full max-w-3xl"
      bodyClassName="modal-body space-y-3"
      footer={
        <>
          <Button tone="neutral" className="mr-auto" onClick={() => inputRef.current?.click()} disabled={busy}>
            <HardDrive size={14} /> {busy ? t('images.storing') : t('images.fromDisk')}
          </Button>
          <Button tone="neutral" onClick={() => settlePick(null)}>{t('common.cancel')}</Button>
          <Button tone="jade" onClick={() => settlePick(selected)} disabled={!selected.length}>
            {t('images.insertCount', { count: selected.length })}
          </Button>
        </>
      }
    >
      <ListSearchField value={search} onChange={setSearch} placeholder={t('images.searchPlaceholder')} />
      {shown.length === 0 ? (
        <p className="text-xs text-subtle py-6 text-center">{pictures.length ? t('images.noMatch') : t('images.pickEmpty')}</p>
      ) : (
        <div className="image-picker-grid">
          {shown.map((item) => (
            <div
              key={item.file}
              className={`image-picker-cell${selected.includes(item.file) ? ' image-picker-cell--selected' : ''}`}
              onDoubleClick={() => settlePick([item.file])}
            >
              <ImageTile file={item.file} image={item.image} compact onClick={() => toggle(item.file)} />
              {selected.includes(item.file) && (
                <span className="image-picker-badge">{multiple ? selected.indexOf(item.file) + 1 : '✓'}</span>
              )}
            </div>
          ))}
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_IMAGE_MIME}
        multiple={multiple}
        className="hidden"
        onChange={(e) => { choose(e.target.files); e.target.value = ''; }}
      />
    </Modal>
  );
}

/** Shows the picker while a place has asked for pictures (`pickPictures`). Mounted once, in the shell. */
export function ImagePickerHost() {
  const request = useImagePickerStore((s) => s.request);
  return request ? <ImagePickerModal multiple={request.multiple} /> : null;
}
