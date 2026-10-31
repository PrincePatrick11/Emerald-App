import { useTranslation } from 'react-i18next';
import { CopyPlus } from 'lucide-react';
import { useUIStore } from '../store/uiStore';
import { saveEntryAsTemplate } from '../store/templateApply';
import type { ContextMenuAction } from '../components/ui/ContextMenu';
import type { TemplateEntryType } from '../lib/blocks/templates';

/**
 * The context menu item "Save as template" — in every menu that carries an
 * entry with a block stack. Creates the template and opens its page
 * for further editing.
 */
export function useSaveAsTemplateAction(): (entryType: TemplateEntryType, id: string) => ContextMenuAction {
  const { t } = useTranslation();
  const setActiveView = useUIStore((s) => s.setActiveView);
  return (entryType, id) => ({
    label: t('templates.saveAsTemplate'),
    icon: <CopyPlus size={12} />,
    onClick: () => {
      void saveEntryAsTemplate(entryType, id)
        .then((template) => { if (template) setActiveView({ type: 'templates', id: template.id }); })
        .catch((e: unknown) => console.error('[templates] saving the entry as a template failed:', e));
    },
  });
}
