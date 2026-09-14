import { useTranslation } from 'react-i18next';
import { LayoutTemplate } from 'lucide-react';
import { useUIStore } from '../store/uiStore';
import { saveEntryAsTemplate } from '../store/templateApply';
import type { ContextMenuAction } from '../components/ui/ContextMenu';
import type { TemplateEntryType } from '../lib/blocks/templates';

/**
 * Der Kontextmenü-Eintrag „Als Vorlage speichern" — in jedem Menü, das einen
 * Eintrag mit Blockstapel trägt. Legt die Vorlage an und öffnet ihre Seite
 * zum Nachbearbeiten.
 */
export function useSaveAsTemplateAction(): (entryType: TemplateEntryType, id: string) => ContextMenuAction {
  const { t } = useTranslation();
  const setActiveView = useUIStore((s) => s.setActiveView);
  return (entryType, id) => ({
    label: t('templates.saveAsTemplate'),
    icon: <LayoutTemplate size={12} />,
    onClick: () => {
      void saveEntryAsTemplate(entryType, id)
        .then((template) => { if (template) setActiveView({ type: 'templates', id: template.id }); })
        .catch((e: unknown) => console.error('[templates] saving the entry as a template failed:', e));
    },
  });
}
