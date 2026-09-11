import type { ReactNode } from 'react';
import { Plus } from 'lucide-react';
import Button from './Button';
import CollapseChevron from './CollapseChevron';

interface Props {
  /** Ohne onToggleCollapse entfällt der Chevron — der Kopf ist dann nicht klappbar. */
  onToggleCollapse?: () => void;
  collapsed?: boolean;
  /** Feste w-5-Spalte wie in jeder Kategoriezeile — hält die Labels einer Liste bündig. */
  emoji?: string;
  /** Statt des Emojis, in derselben w-5-Spalte (Tags: der Farbpunkt). */
  leading?: ReactNode;
  label: string;
  /** Der „(n)"-Zähler rechts vom Label — die eine Stelle für seine Klassenkette. */
  count?: number;
  /** Rechts vom Label-Freiraum, hinter dem Zähler. */
  meta?: ReactNode;
  /** Der „+"-Knopf: „Eintrag direkt in dieser Gruppe anlegen". Ein Paar, damit
   *  der Knopf nicht ohne zugänglichen Namen entstehen kann. */
  add?: { title: string; onClick: () => void };
  /** Rechtsbündige Buttons, hinter dem „+". */
  actions?: ReactNode;
}

/**
 * Der Kopf einer auf-/zuklappbaren Gruppe — Kategorien in Wiki, Operations,
 * Tasks und Altar ebenso wie die „Ohne Kategorie"-Buckets daneben, hinter
 * denen keine Kategorie steht, und die Tags. Verwaltet wird hier selbst
 * nichts: Kategorien verwaltet `CategoriesView`; die Tags-Ansicht, die ihre
 * eigene Verwaltung ist, reicht ihre Knöpfe über `leading`/`actions` herein.
 */
export default function CollapsibleGroupHeader({
  onToggleCollapse, collapsed = false, emoji, leading, label, count, meta, add, actions,
}: Props) {
  return (
    <div className="flex items-center gap-2 mb-2">
      {onToggleCollapse && <CollapseChevron collapsed={collapsed} onToggle={onToggleCollapse} />}
      {leading
        ? <span className="w-5 flex items-center justify-center flex-shrink-0">{leading}</span>
        : emoji && <span className="w-5 text-center flex-shrink-0 text-base">{emoji}</span>}
      <p className="text-xs text-stone-600 font-semibold uppercase tracking-wider flex-1">{label}</p>
      {count != null && <span className="text-xs text-stone-500">({count})</span>}
      {meta}
      {/* Getönte Row-Action in der 24px-small-Reihe — 30px würde die
          Kopfzeile aufblähen. */}
      {add && (
        <Button tone="jade" compact small title={add.title} aria-label={add.title} onClick={add.onClick}>
          <Plus size={12} />
        </Button>
      )}
      {actions}
    </div>
  );
}
