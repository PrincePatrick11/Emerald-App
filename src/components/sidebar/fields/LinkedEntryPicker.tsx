import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CSSProperties, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { useOutsideClick } from '../../../hooks/useOutsideClick';
import { OP_PROP_SELECT_CLASSES } from '../../../lib/styleClasses';

interface Props<T> {
  /** Die Chips darüber (typischerweise `LinkedEntryChip`); die umbrechende
   *  Zeile drumherum zieht der Picker. */
  chips?: ReactNode;
  /** Treffer zur aktuellen Eingabe; das Filtern bleibt beim Aufrufer, der
   *  seinen Bestand kennt. */
  results: T[];
  resultKey: (item: T) => string;
  renderResult: (item: T) => ReactNode;
  onSelect: (item: T) => void;
  query: string;
  onQueryChange: (query: string) => void;
  placeholder: string;
  /** Überschreibt die Klassen der Suchzeile; Standard ist die der Panels. */
  inputCls?: string;
}

/** Höhe des Menüs (`max-h-40`) — ab hier klappt es nach oben. */
const MENU_MAX_HEIGHT = 160;

/** So viele Treffer zeigt die Liste. Eine Zahl für alle drei Felder. */
export const LINK_RESULT_LIMIT = 8;

/**
 * Der Chip einer Verknüpfung. `onClick` macht das Label anklickbar (das
 * Verlinkungs-Feld springt damit zur Stelle im Text), `onRemove` hängt das „×"
 * an. Ohne beides ist es eine reine Anzeige.
 */
export function LinkedEntryChip({
  icon, label, labelMaxWidth = 'max-w-[110px]', onClick, onRemove, removeTitle,
}: {
  icon: ReactNode;
  label: string;
  labelMaxWidth?: string;
  onClick?: () => void;
  onRemove?: () => void;
  removeTitle?: string;
}) {
  const body = (
    <>
      {icon}
      <span className={`truncate ${labelMaxWidth}`}>{label}</span>
    </>
  );
  return (
    <span className="linked-entry-chip flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-stone-800/60 border border-stone-700/40 text-stone-300 transition-colors">
      {onClick ? (
        <button
          onClick={onClick}
          className="flex items-center gap-1 min-w-0 hover:text-stone-100 transition-colors"
          title={label}
        >
          {body}
        </button>
      ) : body}
      {onRemove && (
        <button
          onClick={onRemove}
          className="text-stone-600 hover:text-stone-400 ml-0.5 flex-shrink-0"
          title={removeTitle}
          aria-label={removeTitle}
        >
          <X size={12} />
        </button>
      )}
    </span>
  );
}

/**
 * Die gemeinsame Hülle der Verknüpfungs-Felder: Chip-Zeile, Suchzeile und
 * Ergebnismenü. Zuvor stand dieses Gerüst dreimal fast wortgleich in
 * `LinkedEntriesField`, `LinkedOpsInput` und `LinkedWikiInput`.
 *
 * Das Menü hängt per Portal am `body` und liegt `fixed`, wie `Dropdown` mit
 * `portal` und `ContextMenu`: die Felder sitzen im `overflow-y-auto` der
 * rechten Seitenleiste, und ein absolut positioniertes Menü würde dort an der
 * unteren Kante abgeschnitten.
 *
 * Was NICHT hierher gehört: die Chips selbst und was ein Treffer bedeutet. Die
 * drei Felder haben verschiedene Verträge — zwei bearbeiten ein ID-Array,
 * eines liest die Links aus dem Inhalt des Eintrags.
 */
export default function LinkedEntryPicker<T>({
  chips, results, resultKey, renderResult, onSelect,
  query, onQueryChange, placeholder, inputCls = OP_PROP_SELECT_CLASSES,
}: Props<T>) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPos, setMenuPos] = useState<CSSProperties | null>(null);

  // menuRef zusätzlich: im Portal ist das Menü kein Nachfahre des Wrappers.
  useOutsideClick(open, () => setOpen(false), { refs: [wrapRef, menuRef], escape: true });

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      if (!wrapRef.current) return;
      const r = wrapRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - r.bottom;
      const openUp = spaceBelow < MENU_MAX_HEIGHT && r.top > spaceBelow;
      setMenuPos({
        position: 'fixed',
        zIndex: 9999,
        width: r.width,
        left: r.left,
        ...(openUp ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }),
      });
    };
    place();
    // `capture: true`, damit auch das Scrollen der rechten Seitenleiste zählt —
    // ein fixed positioniertes Menü wandert sonst nicht mit seinem Anker mit.
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, query, results.length]);

  // Schließen UND leeren gehören zusammen — vorher tat das jedes Feld selbst.
  const select = (item: T) => {
    onSelect(item);
    onQueryChange('');
    setOpen(false);
  };

  return (
    <div className="space-y-1.5">
      {chips && <div className="flex flex-wrap gap-1">{chips}</div>}
      <div ref={wrapRef} className="relative">
        <input
          value={query}
          onChange={(e) => { onQueryChange(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          className={inputCls}
        />
        {open && createPortal(
          <div
            ref={menuRef}
            className="linked-entry-menu border border-stone-700/60 rounded-lg shadow-xl py-1 max-h-40 overflow-y-auto"
            style={menuPos ?? { position: 'fixed', visibility: 'hidden' }}
          >
            {results.length === 0 ? (
              <p className="text-xs text-stone-600 px-3 py-2">{t('search.noResultsShort')}</p>
            ) : results.map((item) => (
              <button
                key={resultKey(item)}
                // mousedown nur entschärfen (der Blur würde das Menü vor dem
                // Klick schließen); ausgelöst wird per click, damit die Zeile
                // auch mit der Tastatur erreichbar bleibt.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => select(item)}
                className="linked-entry-menu-item w-full text-left flex items-center gap-2 px-3 py-1.5 text-xs text-stone-400 hover:text-stone-200"
              >
                {renderResult(item)}
              </button>
            ))}
          </div>,
          document.body,
        )}
      </div>
    </div>
  );
}
