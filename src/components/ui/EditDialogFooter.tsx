import { useTranslation } from 'react-i18next';
import { Trash2 } from 'lucide-react';
import Button from './Button';

/**
 * The action row of a dialog that edits one thing (a category, a symbol, a
 * picture, a dashboard's settings): Delete on the far left — only with
 * `onDelete` —, then Cancel and Save. A `Modal`'s `footer`.
 */
export default function EditDialogFooter({ onDelete, onCancel, onSave, saveDisabled }: {
  onDelete?: () => void;
  onCancel: () => void;
  onSave: () => void;
  saveDisabled?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <>
      {onDelete && (
        <Button tone="danger" className="mr-auto" onClick={onDelete}>
          <Trash2 size={14} /> {t('common.delete')}
        </Button>
      )}
      <Button tone="neutral" onClick={onCancel}>{t('common.cancel')}</Button>
      <Button tone="jade" onClick={onSave} disabled={saveDisabled}>{t('common.save')}</Button>
    </>
  );
}
