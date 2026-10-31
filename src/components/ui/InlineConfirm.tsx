import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import Button from './Button';

interface InlineConfirmProps {
  onConfirm: () => void;
  onCancel: () => void;
  /** The question before the buttons. Default: "Sure?". */
  message?: ReactNode;
  /** Label of the confirm button. Default: "Yes, delete". */
  confirmLabel?: ReactNode;
  /** Tone of the confirm button. Default `danger`; `jade` for a confirmation that
   *  deletes nothing (updating a block in all entries). Only
   *  `inline`; the `banner` is a delete strip. */
  tone?: 'danger' | 'jade';
  /** `inline` sits in a row in place of its actions; `banner` is a
   *  strip of its own at full width, for dialogs. */
  variant?: 'inline' | 'banner';
  /** The 24px buttons for dense rows (category and tag headers). */
  small?: boolean;
  /** Question and buttons may wrap, for narrow header rows (the right
   *  sidebar is as narrow as 180px). It stays off in rows, where the
   *  confirmation should not shrink. */
  wrap?: boolean;
}

/**
 * The confirmation before a deletion, in place instead of in a dialog:
 * question, "Yes" (danger) and "No" (neutral). When it shows is decided by the
 * caller, usually a `confirmingId` state that the first click sets.
 */
export default function InlineConfirm({
  onConfirm, onCancel, message, confirmLabel, tone = 'danger', variant = 'inline', small, wrap,
}: InlineConfirmProps) {
  const { t } = useTranslation();
  const buttons = (
    <span className="flex items-center gap-1.5 flex-shrink-0">
      <Button tone={tone} small={small} onClick={onConfirm}>{confirmLabel ?? t('common.confirmYes')}</Button>
      <Button tone="neutral" small={small} onClick={onCancel}>{t('common.confirmNo')}</Button>
    </span>
  );

  if (variant === 'banner') {
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 bg-[var(--danger-bg)] border-[var(--danger-border)]">
        <span className="text-xs text-danger">{message ?? t('common.confirmSure')}</span>
        {buttons}
      </div>
    );
  }

  return (
    <span className={`flex items-center gap-1.5 ${wrap ? 'flex-wrap min-w-0' : 'flex-shrink-0'}`}>
      <span className="text-xs text-[var(--text-muted)]">{message ?? t('common.confirmSure')}</span>
      {buttons}
    </span>
  );
}
