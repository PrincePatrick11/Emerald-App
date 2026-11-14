import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Trash2 } from 'lucide-react';
import { useImageStore } from '../../store/imageStore';
import { deletePicture, placesShowing } from '../../store/imageActions';
import { useUndoStore } from '../../store/undoStore';
import { useUIStore } from '../../store/uiStore';
import { imageSrc } from '../../lib/images';
import { imageRoleLabelKey, isRemovableUse, type ImageUse } from '../../lib/imageUsage';
import { displayTitle } from '../../lib/entryTitle';
import { MODULES, AUX_VIEWS, viewTypeForKind } from '../../lib/modules';
import { kindOfEntry } from '../../store/dashboardStore';
import { OP_PROP_SELECT_CLASSES } from '../../lib/styleClasses';
import type { ActiveView, VaultImage } from '../../types';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import TagInput from '../ui/TagInput';

/** The kind of an entry using the picture — under the dashboards loaded now. */
function kindOfUse(use: ImageUse) {
  return kindOfEntry(use.entry ?? { category_id: null, tags: [] });
}

/** The icon of a place of use: its module, the templates, the custom blocks. */
function iconOf(use: ImageUse) {
  if (use.kind === 'entry') return MODULES[viewTypeForKind(kindOfUse(use))].icon;
  if (use.kind === 'template') return AUX_VIEWS.templates.icon;
  return AUX_VIEWS.blocks.icon;
}

/** Where a place of use opens. */
function viewOf(use: ImageUse): ActiveView {
  switch (use.kind) {
    case 'entry': return { type: viewTypeForKind(kindOfUse(use)), id: use.id, mode: 'view' };
    case 'template': return { type: 'templates', id: use.id };
    case 'blockDefinition': return { type: 'blocks', id: use.id };
  }
}

/**
 * Name, tags and note of a picture in "Images", and where it is used, each
 * place a click away. Deleting puts the picture in the trash with Undo; where
 * it is still shown in texts or image fields, it asks first, naming how many
 * places, and takes it out of them too (`deletePicture`). Opened with
 * `confirmDelete`, it starts at that question (the right-click menu).
 */
export default function ImageEditModal({ file, image, confirmDelete = false, onClose }: {
  file: string;
  image: VaultImage | null;
  confirmDelete?: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const pushUndo = useUndoStore((s) => s.push);
  const setActiveView = useUIStore((s) => s.setActiveView);
  const uses = useImageStore((s) => s.uses.get(file)) ?? [];
  const removable = uses.filter(isRemovableUse);
  const [name, setName] = useState(image?.name ?? '');
  const [tags, setTags] = useState<string[]>(image?.tags ?? []);
  const [note, setNote] = useState(image?.note ?? '');
  const [asking, setAsking] = useState(confirmDelete);
  const [showing, setShowing] = useState(removable.length);

  // Where it is used now, not as of the view's last scan.
  useEffect(() => { void useImageStore.getState().refreshUses(); }, []);

  const save = async () => {
    await useImageStore.getState().saveDetails(file, { name: name.trim(), tags, note });
    onClose();
  };

  // The places are read at the click, not taken from a scan that may be old.
  const askOrRemove = async () => {
    const places = await placesShowing(file);
    if (!places.length) { await remove(); return; }
    setShowing(places.length);
    setAsking(true);
  };

  const remove = async () => {
    await deletePicture(file, image, t('undo.imageDeleted'), pushUndo);
    onClose();
  };

  return (
    <Modal
      title={t('images.edit')}
      onClose={onClose}
      widthClassName="w-full max-w-md"
      bodyClassName="modal-body space-y-3"
      footer={asking ? (
        <>
          <p className="mr-auto text-xs text-soft">{t('images.removeFromUses', { count: showing })}</p>
          <Button tone="neutral" onClick={() => setAsking(false)}>{t('common.cancel')}</Button>
          <Button tone="danger" onClick={remove}>{t('images.removeAndDelete')}</Button>
        </>
      ) : (
        <>
          <Button tone="danger" className="mr-auto" onClick={() => void askOrRemove()}>
            <Trash2 size={14} /> {t('common.delete')}
          </Button>
          <Button tone="neutral" onClick={onClose}>{t('common.cancel')}</Button>
          <Button tone="jade" onClick={save}>{t('common.save')}</Button>
        </>
      )}
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
      <div>
        <p className="label-xs mb-1">{t('images.usedIn')}</p>
        {uses.length === 0 ? (
          <p className="text-xs text-subtle">{t('images.unused')}</p>
        ) : (
          <ul className="image-uses">
            {uses.map((use) => {
              const Icon = iconOf(use);
              const title = use.kind === 'entry' ? displayTitle(t, kindOfUse(use), use.title) : use.title;
              return (
                <li key={`${use.kind}:${use.id}:${use.role}`}>
                  <button type="button" className="image-use-row" onClick={() => { setActiveView(viewOf(use)); onClose(); }}>
                    <Icon size={14} className="text-subtle flex-shrink-0" />
                    <span className="flex-1 truncate">{title}</span>
                    {use.role !== 'content' && <span className="text-[11px] text-subtle">{t(imageRoleLabelKey(use.role))}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Modal>
  );
}
