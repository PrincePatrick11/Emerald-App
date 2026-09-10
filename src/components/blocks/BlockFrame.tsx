import type { PointerEvent, MouseEvent, ReactNode } from 'react';
import { EyeOff, GripVertical, MoreHorizontal, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { GlyphSource } from '../../lib/blocks/presets';
import BlockGlyph from './BlockGlyph';

interface BlockFrameProps {
  isEditing: boolean;
  icon: GlyphSource;
  /** Eigener Titel der Instanz oder der Typname. */
  label: string;
  /** Ausgeblendet: im Lesemodus weg, im Bearbeitungsmodus ausgegraut. */
  hidden: boolean;
  /** Titel im Lesemodus zeigen (Anzeigeregel des Blocks). */
  showReadTitle: boolean;
  /** Kopie eines eigenen Blocks, dessen Definition inzwischen weiter ist — das Menü bietet „Block aktualisieren". */
  outdated?: boolean;
  onGripPointerDown: (e: PointerEvent) => void;
  onOpenMenu: (e: MouseEvent) => void;
  children: ReactNode;
}

/**
 * Die Hülle um einen Block. Im Lesemodus unsichtbar — die Blöcke fließen wie
 * ein Dokument, höchstens mit einem dezenten Titel darüber. Im
 * Bearbeitungsmodus ein Rahmen mit Griff zum Verschieben, Titel und Menü.
 *
 * Der Inhalt steht in beiden Modi an derselben Stelle im Baum: wechselte die
 * Struktur mit dem Modus, montierte React den Block neu, und ein Textblock
 * verlöre seinen Editor samt ungespeicherter Eingabe. Aus demselben Grund
 * wird ein ausgeblendeter Block im Lesemodus per CSS versteckt, nicht
 * weggelassen.
 */
export default function BlockFrame({
  isEditing, icon, label, hidden, showReadTitle, outdated = false, onGripPointerDown, onOpenMenu, children,
}: BlockFrameProps) {
  const { t } = useTranslation();
  const className = [
    'block-frame',
    isEditing && 'block-frame--editing',
    hidden && 'block-frame--hidden',
  ].filter(Boolean).join(' ');

  return (
    <div className={className}>
      {isEditing ? (
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
          <BlockGlyph icon={icon} />
          <span className="block-frame-label">{label}</span>
          {outdated && (
            <button type="button" className="block-frame-outdated" onClick={onOpenMenu} title={t('blocks.outdatedHint')}>
              <RefreshCw size={12} />
              <span>{t('blocks.outdated')}</span>
            </button>
          )}
          {hidden && (
            <span className="block-frame-hidden-mark" title={t('blocks.hiddenHint')}>
              <EyeOff size={12} />
            </span>
          )}
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
      ) : showReadTitle ? (
        <div className="label-xs block-read-title">{label}</div>
      ) : null}
      <div className="block-frame-body">{children}</div>
    </div>
  );
}
