import { useTranslation } from 'react-i18next';
import BlockCheckbox from '../../blocks/BlockCheckbox';
import { SettingsCheckboxGrid } from './SettingsSection';
import type { EntrySelection } from '../../../lib/dbBackup';

export interface CategoryChoice {
  id: string;
  label: string;
  emoji: string;
  /** How many entries of the file it holds — the import shows it. */
  count?: number;
}

/**
 * The packing list of the entries in a backup: one box per category, and
 * "Uncategorized". Export and import share it; the selection is
 * `EntrySelection` (`categoryIds` null: every category, also one that is new
 * since).
 */
export default function EntryCategoryChecks({ categories, selection, onChange, uncategorizedCount }: {
  categories: CategoryChoice[];
  selection: EntrySelection;
  onChange: (next: EntrySelection) => void;
  uncategorizedCount?: number;
}) {
  const { t } = useTranslation();
  const isOn = (id: string) => selection.categoryIds === null || selection.categoryIds.includes(id);
  const toggle = (id: string) => {
    const on = categories.filter((c) => isOn(c.id)).map((c) => c.id);
    const next = isOn(id) ? on.filter((c) => c !== id) : [...on, id];
    onChange({ ...selection, categoryIds: next.length === categories.length ? null : next });
  };
  const withCount = (label: string, count: number | undefined) => (count === undefined ? label : `${label} (${count})`);
  return (
    <SettingsCheckboxGrid label={t('settings.entriesByCategory')}>
      {categories.map((c) => (
        <BlockCheckbox
          key={c.id}
          checked={isOn(c.id)}
          onChange={() => toggle(c.id)}
          label={withCount(`${c.emoji} ${c.label}`, c.count)}
        />
      ))}
      <BlockCheckbox
        checked={selection.includeUncategorized}
        onChange={() => onChange({ ...selection, includeUncategorized: !selection.includeUncategorized })}
        label={withCount(t('categories.uncategorized'), uncategorizedCount)}
        title={t('settings.includeUncategorizedHint')}
      />
    </SettingsCheckboxGrid>
  );
}
