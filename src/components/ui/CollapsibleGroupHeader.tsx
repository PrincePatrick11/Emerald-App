import type { ReactNode } from 'react';
import CollapseChevron from './CollapseChevron';

interface Props {
  /** Ohne onToggleCollapse entfällt der Chevron — der Kopf ist dann nicht klappbar. */
  onToggleCollapse?: () => void;
  collapsed?: boolean;
  /** Feste w-5-Spalte wie in jeder Kategoriezeile — hält die Labels einer Liste bündig. */
  emoji?: string;
  label: string;
  /** Der „(n)"-Zähler rechts vom Label — die eine Stelle für seine Klassenkette. */
  count?: number;
  /** Rechts vom Label-Freiraum, hinter dem Zähler. */
  meta?: ReactNode;
  /** Rechtsbündige Buttons. */
  actions?: ReactNode;
}

/**
 * Lese-Kopf einer auf-/zuklappbaren Gruppe. CategoryHeaderRow komponiert ihn
 * für echte Kategorien; die „Ohne Kategorie"-Buckets in Tasks/Wiki/Operations
 * nutzen ihn direkt — sie haben keine Kategoriezeile hinter sich und damit
 * weder Umbenennen noch Löschen.
 */
export default function CollapsibleGroupHeader({
  onToggleCollapse, collapsed = false, emoji, label, count, meta, actions,
}: Props) {
  return (
    <div className="flex items-center gap-2 mb-2">
      {onToggleCollapse && <CollapseChevron collapsed={collapsed} onToggle={onToggleCollapse} />}
      {emoji && <span className="w-5 text-center flex-shrink-0 text-base">{emoji}</span>}
      <p className="text-xs text-stone-600 font-semibold uppercase tracking-wider flex-1">{label}</p>
      {count != null && <span className="text-xs text-stone-500">({count})</span>}
      {meta}
      {actions}
    </div>
  );
}
