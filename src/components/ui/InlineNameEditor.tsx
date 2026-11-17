import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, X } from 'lucide-react';
import Button from './Button';

interface InlineNameEditorProps {
  value: string;
  onChange: (value: string) => void;
  /** Shown next to the field, e.g. "Name already taken". */
  error: string | null;
  onSave: () => void;
  onCancel: () => void;
  placeholder?: string;
  /** Between the field and its buttons — a further choice of the same row (a category's start template). */
  beforeActions?: ReactNode;
}

/**
 * The body of a name editor in one row: field (Enter saves,
 * Escape cancels), error message, save, cancel. A fragment without
 * a frame of its own; the row and leading glyph (emoji picker, colour dot,
 * placeholder for handle or chevron) are brought by the caller.
 */
export default function InlineNameEditor({
  value, onChange, error, onSave, onCancel, placeholder, beforeActions,
}: InlineNameEditorProps) {
  const { t } = useTranslation();
  return (
    <>
      <input
        autoFocus
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onSave();
          if (e.key === 'Escape') onCancel();
        }}
        placeholder={placeholder}
        className="input-field flex-1 min-w-0 rounded-md px-2 py-0.5 text-sm outline-none selectable"
      />
      {error && <span className="text-xs text-danger shrink-0">{error}</span>}
      {beforeActions}
      <Button tone="jade" compact small title={t('common.save')} aria-label={t('common.save')} onClick={onSave}>
        <Check size={12} />
      </Button>
      <Button tone="neutral" compact small title={t('common.cancel')} aria-label={t('common.cancel')} onClick={onCancel}>
        <X size={12} />
      </Button>
    </>
  );
}
