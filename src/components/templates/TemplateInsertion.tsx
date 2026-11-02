import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import Button from '../ui/Button';
import BlockGlyph from '../blocks/BlockGlyph';
import TemplatePickerModal from './TemplatePickerModal';
import { useTemplateNoticeStore, useTemplateStore } from '../../store/templateStore';
import { templateLabel } from '../../lib/blocks/blockAttrs';
import type { Template, TemplateEntryType } from '../../lib/blocks/templates';

export interface TemplateTarget {
  entryType: TemplateEntryType;
  /** Immediately saves what the editor still defers (title, tags), before inserting. */
  flush: () => Promise<void>;
}

interface Props {
  entryId: string;
  pickerOpen: boolean;
  onPickerOpenChange: (open: boolean) => void;
  apply: (template: Template) => void;
  /** Undo after the automatic insertion: empty the stack, restore title and tags. */
  undo: (template: Template) => void;
}

/**
 * What an entry offers in the way of templates when editing, besides the block stack,
 * which inserts the blocks itself: the notice "Template applied" after an
 * automatic insertion, with Undo, and the picker from the sidebar.
 */
export default function TemplateInsertion({ entryId, pickerOpen, onPickerOpenChange, apply, undo }: Props) {
  const { t } = useTranslation();
  const templates = useTemplateStore((s) => s.templates);
  const notice = useTemplateNoticeStore((s) => (s.notice?.entryId === entryId ? s.notice : null));
  const dismiss = useTemplateNoticeStore((s) => s.dismiss);
  const applied = notice ? templates.find((tpl) => tpl.id === notice.templateId) : undefined;

  return (
    <>
      {/* No UndoToast: the notice stays until you type or close it and sits in the document. */}
      {applied && (
        <div className="template-notice" role="status">
          <BlockGlyph icon={applied.icon} size={14} />
          <span className="min-w-0 flex-1 truncate">{t('templates.insert.noticeApplied', { name: templateLabel(t, applied) })}</span>
          <Button tone="neutral" small onClick={() => { dismiss(entryId); undo(applied); }}>
            {t('undo.action')}
          </Button>
          <button
            type="button"
            className="block-row-action"
            onClick={() => dismiss(entryId)}
            title={t('templates.insert.dismiss')}
            aria-label={t('templates.insert.dismiss')}
          >
            <X size={12} />
          </button>
        </div>
      )}

      {pickerOpen && (
        <TemplatePickerModal
          templates={templates}
          onSelect={(template) => {
            onPickerOpenChange(false);
            apply(template);
          }}
          onClose={() => onPickerOpenChange(false)}
        />
      )}
    </>
  );
}
