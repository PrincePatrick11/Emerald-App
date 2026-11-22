import { useTranslation } from 'react-i18next';
import BlockCheckbox from '../../blocks/BlockCheckbox';
import { displayTitle } from '../../../lib/entryTitle';
import { formatEntryDate } from '../../../lib/formatDate';
import { categoryLabel } from '../../../lib/categories';
import { useCategoryStore } from '../../../store/categoryStore';
import type { Entry } from '../../../types';

/**
 * The export menu's list to tick entries off (Advanced): a collective
 * export's entries, or the linked ones. Unticked ones stay out of the file.
 */
export default function ExportEntryChecklist({ entries, excluded, onToggle }: {
  entries: readonly Entry[];
  excluded: ReadonlySet<string>;
  onToggle: (id: string) => void;
}) {
  const { t } = useTranslation();
  const categories = useCategoryStore((s) => s.categories);
  return (
    <div className="rounded-md border border-edge max-h-44 overflow-y-auto px-3 py-2 space-y-1.5">
      {entries.map((entry) => {
        const category = categories.find((c) => c.id === entry.category_id);
        const meta = [formatEntryDate(entry.created_at), category ? categoryLabel(t, category) : null].filter(Boolean).join(' · ');
        return (
          <BlockCheckbox
            key={entry.id}
            checked={!excluded.has(entry.id)}
            onChange={() => onToggle(entry.id)}
            label={`${category?.emoji ? `${category.emoji} ` : ''}${displayTitle(t, 'entry', entry.title)} · ${meta}`}
          />
        );
      })}
    </div>
  );
}
