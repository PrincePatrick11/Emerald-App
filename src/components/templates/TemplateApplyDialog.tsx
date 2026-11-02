import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import BlockCheckbox from '../blocks/BlockCheckbox';
import { templateLabel } from '../../lib/blocks/blockAttrs';
import type { Template } from '../../lib/blocks/templates';
import type { TemplateApplyOptions } from '../../store/templateApply';
import { usableTemplateTags } from '../../lib/templateTags';
import { useTagMap, visibleTags } from '../../store/tagStore';

/**
 * A template into an entry that already has content: append, or replace
 * the whole content, plus whether title and tags come along. An empty entry
 * does not need the dialog; there the selection inserts directly.
 */
export default function TemplateApplyDialog({ template, onApply, onClose }: {
  template: Template;
  onApply: (options: TemplateApplyOptions) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<TemplateApplyOptions['mode']>('append');
  const hasTitle = !!template.title.trim();
  // Only what actually arrives; a tag in the trash stays in the template.
  const shownTags = visibleTags(usableTemplateTags(template.tags), useTagMap()).map((tag) => tag.name);
  const hasTags = shownTags.length > 0;
  const [title, setTitle] = useState(false);
  const [tags, setTags] = useState(hasTags);

  return (
    <Modal title={t('templates.insert.applyTitle', { name: templateLabel(t, template) })} onClose={onClose} bodyClassName="px-3.5 py-4 space-y-4" footer={
      <>
        <Button tone="neutral" onClick={onClose}>{t('common.cancel')}</Button>
        <Button tone="jade" onClick={() => onApply({ mode, title: hasTitle && title, tags: hasTags && tags })}>
          {t('templates.insert.apply')}
        </Button>
      </>
    }>
      <div className="space-y-2">
        <div className="flex gap-2" role="group" aria-label={t('templates.insert.modeLabel')}>
          {(['append', 'replace'] as const).map((value) => (
            <Button
              key={value}
              tone={mode === value ? 'jade' : 'neutral'}
              small
              aria-pressed={mode === value}
              onClick={() => setMode(value)}
            >
              {t(`templates.insert.${value}`)}
            </Button>
          ))}
        </div>
        <p className="block-field-hint">{t(mode === 'append' ? 'templates.insert.appendHint' : 'templates.insert.replaceHint')}</p>
      </div>

      <div className="space-y-2">
        <BlockCheckbox
          checked={hasTitle && title}
          disabled={!hasTitle}
          onChange={setTitle}
          label={hasTitle ? t('templates.insert.takeTitle', { title: template.title.trim() }) : t('templates.insert.noTitle')}
        />
        <BlockCheckbox
          checked={hasTags && tags}
          disabled={!hasTags}
          onChange={setTags}
          label={hasTags ? t('templates.insert.addTags', { tags: shownTags.join(', ') }) : t('templates.insert.noTags')}
        />
      </div>
    </Modal>
  );
}
