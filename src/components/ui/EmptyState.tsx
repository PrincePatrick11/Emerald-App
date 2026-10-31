import { useTranslation } from 'react-i18next';
import { Plus, RotateCcw, SearchX, type LucideIcon } from 'lucide-react';
import Button from './Button';

export interface EmptyStateProps {
  /** Usually the rail icon of the view or section. */
  icon?: LucideIcon;
  /** Short, in the font of the entry titles: "No articles yet". */
  title: string;
  /** One sentence below it: what the area is for. */
  description?: string;
  /** Label of the button; without `onAction` there is no button (trash). */
  actionLabel?: string;
  onAction?: () => void;
  /** The icon in the button; default "+", since it usually creates something. */
  actionIcon?: LucideIcon;
  className?: string;
}

/**
 * The empty state of a dashboard or one of its sections, following the
 * designer pattern "1b": no box, a 44px icon tile, title in the
 * title font (18px), one sentence (13px) saying what goes here, and a
 * 30px button. At the top of the content instead of vertically centred (64px below the header
 * together with the dashboard's `py-6`) so that nothing jumps when the
 * first entry appears (centred was tried and discarded). The green
 * main action in the panel remains the real one, the button here only
 * repeats it quietly.
 */
export default function EmptyState({
  icon: Icon, title, description, actionLabel, onAction, actionIcon: ActionIcon = Plus, className,
}: EmptyStateProps) {
  return (
    <div className={`flex flex-col items-center px-6 pt-10 pb-6 text-center${className ? ` ${className}` : ''}`}>
      {Icon && (
        <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-md border border-edge bg-well-strong text-muted">
          <Icon size={18} />
        </div>
      )}
      <h2 className="entry-view-title text-lg font-semibold text-primary">{title}</h2>
      {description && <p className="mt-1.5 max-w-sm text-[13px] text-muted">{description}</p>}
      {actionLabel && onAction && (
        // The pattern's 13px instead of the tone buttons' 11px; `!` because
        // both font sizes are arbitrary values and the order
        // in the stylesheet would otherwise decide.
        <Button tone="neutral" onClick={onAction} className="mt-5 px-3 !text-[13px] !font-medium">
          <ActionIcon size={14} className="flex-shrink-0" />
          {actionLabel}
        </Button>
      )}
    </div>
  );
}

/**
 * Search or filters have filtered everything out; the same structure as the
 * empty state, so that "nothing there" and "nothing found" look alike. The
 * sentence names the search term; the button clears search and filters in one go.
 */
export function NoResults({ query, filtered = false, onReset, className }: {
  /** The search text; empty if only filters apply. */
  query?: string;
  /** Whether filters are active besides the search. */
  filtered?: boolean;
  /** Without a handler there is no button. */
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
