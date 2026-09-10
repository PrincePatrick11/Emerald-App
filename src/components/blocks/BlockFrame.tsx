import type { PointerEvent, MouseEvent, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { GripVertical, MoreHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface BlockFrameProps {
  isEditing: boolean;
  icon: LucideIcon;
  label: string;
  onGripPointerDown: (e: PointerEvent) => void;
  onOpenMenu: (e: MouseEvent) => void;
  children: ReactNode;
}

/**
 * Die Hülle um einen Block. Im Lesemodus unsichtbar — die Blöcke fließen wie
 * ein Dokument. Im Bearbeitungsmodus ein dezenter Rahmen mit Griff zum
 * Verschieben, Typ und Menü.
 *
 * Der Inhalt steht in beiden Modi an derselben Stelle im Baum: wechselte die
 * Struktur mit dem Modus, montierte React den Block neu, und ein Textblock
 * verlöre seinen Editor samt ungespeicherter Eingabe.
 */
export default function BlockFrame({ isEditing, icon: Icon, label, onGripPointerDown, onOpenMenu, children }: BlockFrameProps) {
  const { t } = useTranslation();
  return (
    <div className={isEditing ? 'block-frame block-frame--editing' : 'block-frame'}>
      {isEditing && (
        <div className="block-frame-header">
          <button
            type="button"
            className="block-frame-grip"
            onPointerDown={onGripPointerDown}
            title={t('blocks.dragToMove')}
            aria-label={t('blocks.dragToMove')}
          >
            <GripVertical size={14} />
          </button>
          <Icon size={12} className="flex-shrink-0" />
          <span className="block-frame-label">{label}</span>
          <button
            type="button"
            className="block-frame-menu"
            onClick={onOpenMenu}
            title={t('blocks.actions')}
            aria-label={t('blocks.actions')}
          >
            <MoreHorizontal size={14} />
          </button>
        </div>
      )}
      <div className="block-frame-body">{children}</div>
    </div>
  );
}
