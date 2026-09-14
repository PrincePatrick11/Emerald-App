import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import Button from '../ui/Button';
import BlockGlyph from '../blocks/BlockGlyph';
import TemplatePickerModal from './TemplatePickerModal';
import TemplateApplyDialog from './TemplateApplyDialog';
import { useTemplateNoticeStore, useTemplateStore } from '../../store/templateStore';
import type { TemplateApplyOptions } from '../../store/templateApply';
import { templateLabel } from '../../lib/blocks/blockAttrs';
import { templatesFor, type Template, type TemplateEntryType } from '../../lib/blocks/templates';

/** So viele Vorlagen stehen im leeren Eintrag als Knopf — der Rest über „Alle Vorlagen". */
const SUGGESTION_LIMIT = 5;

export interface TemplateTarget {
  entryType: TemplateEntryType;
  categoryId: string | null;
  /** Speichert sofort, was der Editor noch aufschiebt (Titel, Tags) — vor dem Einsetzen. */
  flush: () => Promise<void>;
}

interface Props {
  entryId: string;
  target: TemplateTarget;
  /** Ist der Stapel gerade leer? Dann setzt eine Wahl direkt ein, und die Vorschläge stehen da. */
  empty: boolean;
  pickerOpen: boolean;
  onPickerOpenChange: (open: boolean) => void;
  apply: (template: Template, options: TemplateApplyOptions) => void;
  /** Rückgängig nach dem automatischen Einsetzen: Stapel leeren, Titel und Tags zurück. */
  undo: (template: Template) => void;
}

/**
 * Was ein Eintrag im Bearbeiten an Vorlagen anbietet — neben dem Blockstapel,
 * der die Blöcke selbst einsetzt:
 * - der Hinweis „Vorlage angewendet" nach dem automatischen Standard, mit
 *   Rückgängig und „Andere Vorlage";
 * - im leeren Eintrag die passenden Vorlagen als Knöpfe;
 * - die Auswahl (auch aus der Seitenleiste) und, wenn schon Inhalt da ist,
 *   der Dialog Anhängen/Ersetzen.
 */
export default function TemplateInsertion({ entryId, target, empty, pickerOpen, onPickerOpenChange, apply, undo }: Props) {
  const { t } = useTranslation();
  const templates = useTemplateStore((s) => s.templates);
  const notice = useTemplateNoticeStore((s) => (s.notice?.entryId === entryId ? s.notice : null));
  const dismiss = useTemplateNoticeStore((s) => s.dismiss);
  const [choosing, setChoosing] = useState<Template | null>(null);
  /** Die Auswahl kam über „Andere Vorlage": sie ersetzt die angewendete. */
  const [replacing, setReplacing] = useState<Template | null>(null);

  const available = templatesFor(templates, target.entryType, target.categoryId);
  const applied = notice ? templates.find((tpl) => tpl.id === notice.templateId) : undefined;

  const closePicker = () => {
    onPickerOpenChange(false);
    setReplacing(null);
  };

  const select = (template: Template) => {
    onPickerOpenChange(false);
    if (replacing) {
      apply(template, { mode: 'replace', title: 'ifUntitled', tags: true, replaces: replacing, notice: true });
      setReplacing(null);
      return;
    }
    if (empty) {
      apply(template, { mode: 'replace', title: 'ifUntitled', tags: true });
      return;
    }
    setChoosing(template);
  };

  return (
    <>
      {/* Kein UndoToast: der Hinweis bleibt, bis man tippt oder ihn schließt,
          steht im Dokument und braucht einen zweiten Knopf („Andere Vorlage"). */}
      {applied && (
        <div className="template-notice" role="status">
          <BlockGlyph icon={applied.icon} size={14} />
          <span className="min-w-0 flex-1 truncate">{t('templates.insert.noticeApplied', { name: templateLabel(t, applied) })}</span>
          <Button tone="neutral" small onClick={() => { dismiss(entryId); undo(applied); }}>
            {t('undo.action')}
          </Button>
          <Button tone="neutral" small onClick={() => { setReplacing(applied); onPickerOpenChange(true); }}>
            {t('templates.insert.other')}
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

      {empty && !applied && available.length > 0 && (
        <div className="template-suggestions">
          <p className="label-xs">{t('templates.insert.suggestionsLabel')}</p>
          <div className="flex flex-wrap gap-1.5">
            {available.slice(0, SUGGESTION_LIMIT).map((template) => (
              <Button key={template.id} tone="neutral" small onClick={() => select(template)} title={template.description || undefined}>
                <BlockGlyph icon={template.icon} size={12} />
                <span>{templateLabel(t, template)}</span>
              </Button>
            ))}
            {available.length > SUGGESTION_LIMIT && (
              <Button tone="neutral" small onClick={() => onPickerOpenChange(true)}>
                {t('templates.insert.allTemplates')}
              </Button>
            )}
          </div>
        </div>
      )}

      {pickerOpen && (
        <TemplatePickerModal
          templates={replacing ? available.filter((tpl) => tpl.id !== replacing.id) : available}
          onSelect={select}
          onClose={closePicker}
        />
      )}
      {choosing && (
        <TemplateApplyDialog
          template={choosing}
          onApply={(options) => {
            apply(choosing, options);
            setChoosing(null);
          }}
          onClose={() => setChoosing(null)}
        />
      )}
    </>
  );
}
