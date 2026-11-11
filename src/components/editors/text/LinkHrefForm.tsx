import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, X } from 'lucide-react';
import { ToolbarBtn } from '../shared/toolbarParts';

/**
 * The web address of a link, typed in place: in the selection menu for a new
 * link, in the link popup to change one. Enter or the tick confirms, Escape or
 * the cross cancels; what an empty address means is `applyLinkHref`'s business.
 */
export default function LinkHrefForm({ initial, onConfirm, onCancel }: {
  initial: string;
  onConfirm: (href: string) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [href, setHref] = useState(initial);
  return (
    <div className="flex items-center gap-1 px-1">
      <input
        autoFocus
        value={href}
        onChange={(e) => setHref(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); onConfirm(href); }
          if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
        }}
        className="editor-inline-input w-56"
        // A URL scheme, the same in every language.
        placeholder="https://"
      />
      <ToolbarBtn onClick={() => onConfirm(href)} title={t('editor.confirm')}><Check size={14} /></ToolbarBtn>
      <ToolbarBtn onClick={onCancel} title={t('editor.cancel')}><X size={14} /></ToolbarBtn>
    </div>
  );
}
