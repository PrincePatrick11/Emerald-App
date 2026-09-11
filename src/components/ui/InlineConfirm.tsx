import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import Button from './Button';

interface InlineConfirmProps {
  onConfirm: () => void;
  onCancel: () => void;
  /** Die Frage vor den Knöpfen. Default: „Sicher?". */
  message?: ReactNode;
  /** Beschriftung des Bestätigens. Default: „Ja, löschen". */
  confirmLabel?: ReactNode;
  /** `inline` sitzt in einer Zeile anstelle ihrer Aktionen; `banner` ist ein
   *  eigener roter Streifen in voller Breite, für Dialoge. */
  variant?: 'inline' | 'banner';
  /** Die 24px-Knöpfe für dichte Zeilen (Kategorien- und Tag-Köpfe). */
  small?: boolean;
}

/**
 * Die Rückfrage vor einem Löschen, an Ort und Stelle statt in einem Dialog:
 * Frage, „Ja" (danger) und „Nein" (neutral). Wann sie steht, entscheidet der
 * Aufrufer — meist ein `confirmingId`-State, den der erste Klick setzt.
 */
export default function InlineConfirm({
  onConfirm, onCancel, message, confirmLabel, variant = 'inline', small,
}: InlineConfirmProps) {
  const { t } = useTranslation();
  const buttons = (
    <span className="flex items-center gap-1.5 flex-shrink-0">
      <Button tone="danger" small={small} onClick={onConfirm}>{confirmLabel ?? t('common.confirmYes')}</Button>
      <Button tone="neutral" small={small} onClick={onCancel}>{t('common.confirmNo')}</Button>
    </span>
  );

  if (variant === 'banner') {
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg border border-red-700/40 bg-red-950/20 px-3 py-2">
        <span className="text-xs text-red-300">{message ?? t('common.confirmSure')}</span>
        {buttons}
      </div>
    );
  }

  return (
    <span className="flex items-center gap-1.5 flex-shrink-0">
      <span className="text-xs text-stone-400">{message ?? t('common.confirmSure')}</span>
      {buttons}
    </span>
  );
}
