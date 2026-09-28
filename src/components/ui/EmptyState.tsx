import { useTranslation } from 'react-i18next';
import { Plus, RotateCcw, SearchX, type LucideIcon } from 'lucide-react';
import Button from './Button';

export interface EmptyStateProps {
  /** Meist das Rail-Icon der Ansicht bzw. des Abschnitts. */
  icon?: LucideIcon;
  /** Kurz, in der Schrift der Eintragstitel — „Noch keine Artikel". */
  title: string;
  /** Ein Satz darunter: wozu der Bereich da ist. */
  description?: string;
  /** Beschriftung des Knopfs — ohne `onAction` kein Knopf (Papierkorb). */
  actionLabel?: string;
  onAction?: () => void;
  /** Das Icon im Knopf; Default „+", denn meist legt er etwas an. */
  actionIcon?: LucideIcon;
  className?: string;
}

/**
 * Der Leer-Zustand eines Dashboards oder eines seiner Abschnitte, nach dem
 * Designer-Muster „1b": keine Box, eine 44er Icon-Kachel, Titel in der
 * Titelschrift (18px), ein Satz (13px), der sagt, was hierhin kommt, und ein
 * 30px-Knopf. Oben im Inhalt statt vertikal zentriert — 64px unter dem Kopf
 * zusammen mit dem `py-6` des Dashboards —, damit nichts springt, wenn der
 * erste Eintrag erscheint (zentriert ausprobiert und verworfen). Die grüne
 * Hauptaktion im Panel bleibt die eigentliche, der Knopf hier wiederholt sie
 * nur leise.
 */
export default function EmptyState({
  icon: Icon, title, description, actionLabel, onAction, actionIcon: ActionIcon = Plus, className,
}: EmptyStateProps) {
  return (
    <div className={`flex flex-col items-center px-6 pt-10 pb-6 text-center${className ? ` ${className}` : ''}`}>
      {Icon && (
        <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-md border border-stone-700/60 bg-stone-800/60 text-stone-400">
          <Icon size={18} />
        </div>
      )}
      <h2 className="entry-view-title text-lg font-semibold text-stone-100">{title}</h2>
      {description && <p className="mt-1.5 max-w-sm text-[13px] text-stone-400">{description}</p>}
      {actionLabel && onAction && (
        // Die 13px des Musters statt der 11px der Tone-Knöpfe — `!`, weil
        // beide Schriftgrößen beliebige Werte sind und sonst die Reihenfolge
        // im Stylesheet entschiede.
        <Button tone="neutral" onClick={onAction} className="mt-5 px-3 !text-[13px] !font-medium">
          <ActionIcon size={14} className="flex-shrink-0" />
          {actionLabel}
        </Button>
      )}
    </div>
  );
}

/**
 * Suche oder Filter haben alles weggefiltert — derselbe Aufbau wie der
 * Leer-Zustand, damit „nichts da" und „nichts gefunden" gleich aussehen. Der
 * Satz nennt den Suchbegriff; der Knopf leert Suche und Filter in einem.
 */
export function NoResults({ query, filtered = false, onReset, className }: {
  /** Der Suchtext; leer, wenn nur Filter greifen. */
  query?: string;
  /** Ob außer der Suche noch Filter aktiv sind. */
  filtered?: boolean;
  /** Ohne Handler kein Knopf. */
  onReset?: () => void;
  className?: string;
}) {
  const { t } = useTranslation();
  const q = query?.trim();
  const description = q
    ? t(filtered ? 'search.noResultsForFiltered' : 'search.noResultsFor', { query: q })
    : t('search.noResultsFiltered');
  return (
    <EmptyState
      icon={SearchX}
      title={t('search.noResultsTitle')}
      description={description}
      actionLabel={t('search.resetFilters')}
      actionIcon={RotateCcw}
      onAction={onReset}
      className={className}
    />
  );
}
