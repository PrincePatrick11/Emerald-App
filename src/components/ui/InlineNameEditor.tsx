import { useTranslation } from 'react-i18next';
import { Check, X } from 'lucide-react';
import Button from './Button';

interface InlineNameEditorProps {
  value: string;
  onChange: (value: string) => void;
  /** Steht neben dem Feld, z. B. „Name schon vergeben". */
  error: string | null;
  onSave: () => void;
  onCancel: () => void;
  placeholder?: string;
}

/**
 * Der Körper eines Namens-Editors in einer Zeile: Feld (Enter speichert,
 * Escape bricht ab), Fehlermeldung, Speichern, Abbrechen. Ein Fragment ohne
 * eigenen Rahmen — Zeile und führende Glyphe (Emoji-Picker, Farbpunkt,
 * Platzhalter für Griff oder Chevron) bringt der Aufrufer mit.
 */
export default function InlineNameEditor({
  value, onChange, error, onSave, onCancel, placeholder,
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
      {error && <span className="text-xs text-[var(--danger-text)] shrink-0">{error}</span>}
      <Button tone="jade" compact small title={t('common.save')} aria-label={t('common.save')} onClick={onSave}>
        <Check size={12} />
      </Button>
      <Button tone="neutral" compact small title={t('common.cancel')} aria-label={t('common.cancel')} onClick={onCancel}>
        <X size={12} />
      </Button>
    </>
  );
}
