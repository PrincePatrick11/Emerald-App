import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Modal from '../ui/Modal';
import BlockGlyph from '../blocks/BlockGlyph';
import { OP_PROP_SELECT_CLASSES } from '../../lib/styleClasses';
import { templateLabel } from '../../lib/blocks/blockAttrs';
import type { Template } from '../../lib/blocks/templates';

/**
 * The choice of a template for an entry: search by name, below it all
 * templates. A click selects.
 */
export default function TemplatePickerModal({ templates, onSelect, onClose }: {
  templates: readonly Template[];
  onSelect: (template: Template) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const query = search.trim().toLowerCase();
  const shown = query
    ? templates.filter((tpl) => templateLabel(t, tpl).toLowerCase().includes(query))
    : templates;

  return (
    <Modal title={t('templates.insert.pickerTitle')} onClose={onClose} bodyClassName="flex min-h-0 flex-1 flex-col gap-3 modal-body" maxHeightClassName="max-h-[70vh]">
      <input
        autoFocus
        className={`${OP_PROP_SELECT_CLASSES} selectable`}
        value={search}
        placeholder={t('templates.insert.searchPlaceholder')}
        aria-label={t('templates.insert.searchPlaceholder')}
        onChange={(e) => setSearch(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && shown.length > 0) onSelect(shown[0]);
        }}
      />
      {shown.length === 0 ? (
        <p className="text-sm text-muted">{t('templates.insert.noTemplates')}</p>
      ) : (
        <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto">
          {shown.map((template) => (
            <li key={template.id}>
              {/* `.menu-item`: the same hover and focus colours as the menus, in both themes. */}
              <button type="button" className="menu-item rounded-md" onClick={() => onSelect(template)}>
                <BlockGlyph icon={template.icon} size={14} />
                <span className="min-w-0 flex-1 truncate">{templateLabel(t, template)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
