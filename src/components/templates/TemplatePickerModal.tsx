import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Modal from '../ui/Modal';
import BlockGlyph from '../blocks/BlockGlyph';
import { OP_PROP_SELECT_CLASSES } from '../../lib/styleClasses';
import { templateLabel } from '../../lib/blocks/blockAttrs';
import type { Template } from '../../lib/blocks/templates';

/**
 * Die Auswahl einer Vorlage für einen Eintrag: Suche über Name und
 * Beschreibung, darunter die Vorlagen in der Reihenfolge von `templatesFor`
 * (zugewiesene zuerst). Ein Klick wählt.
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
    ? templates.filter((tpl) => `${templateLabel(t, tpl)} ${tpl.description}`.toLowerCase().includes(query))
    : templates;

  return (
    <Modal title={t('templates.insert.pickerTitle')} onClose={onClose} bodyClassName="p-4 space-y-3" maxHeightClassName="max-h-[70vh]">
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
        <p className="text-xs text-[var(--text-muted)]">{t('templates.insert.noTemplates')}</p>
      ) : (
        <ul className="space-y-0.5 overflow-y-auto">
          {shown.map((template) => (
            <li key={template.id}>
              {/* `.menu-item`: dieselben Hover- und Fokus-Farben wie die Menüs, in beiden Themes. */}
              <button type="button" className="menu-item rounded-md" onClick={() => onSelect(template)}>
                <BlockGlyph icon={template.icon} size={14} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{templateLabel(t, template)}</span>
                  {template.description && <span className="block truncate text-[var(--text-muted)]">{template.description}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
