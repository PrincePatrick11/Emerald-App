import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import BlockCheckbox from '../../blocks/BlockCheckbox';
import { type BackupOptions, CONTENT_TYPES } from '../../../lib/dbBackup';
import { SettingsCheckboxGrid } from '../settings/SettingsSection';
import { useCategoryStore } from '../../../store/categoryStore';
import { categoryLabel } from '../../../lib/categories';
import EntryCategoryChecks, { type CategoryChoice } from '../settings/EntryCategoryChecks';

/**
 * What a database export takes along, under "Advanced": entries by category,
 * tasks, tags, lexicon, settings, the trash, and a period. Under "Normal" all
 * of it goes, except the trash.
 */
export default function VaultExportOptions({ options, onChange }: {
  options: BackupOptions;
  onChange: (next: BackupOptions) => void;
}) {
  const { t } = useTranslation();
  const vaultCategories = useCategoryStore((s) => s.categories);
  const categories: CategoryChoice[] = vaultCategories.map((c) => ({ id: c.id, label: categoryLabel(t, c), emoji: c.emoji }));
  const toggle = (key: keyof BackupOptions) => onChange({ ...options, [key]: !options[key] });

  return (
    <div className="space-y-5">
      <EntryCategoryChecks
        categories={categories}
        selection={options}
        onChange={(selection) => onChange({ ...options, ...selection })}
      />

      <SettingsCheckboxGrid label={t('settings.exportInclude')}>
        {([...CONTENT_TYPES, ['includeSettings', 'settings.includeSettings']] as [keyof BackupOptions, string][]).map(([key, labelKey]) => (
          <BlockCheckbox
            key={key}
            checked={!!options[key]}
            onChange={() => toggle(key)}
            label={t(labelKey)}
            title={key === 'includeSettings' ? t('settings.includeSettingsHint') : undefined}
          />
        ))}
      </SettingsCheckboxGrid>

      {/* The one row that takes along what was thrown away gets the warning colour and a row of its own. */}
      <BlockCheckbox
        checked={options.includeDeleted}
        onChange={() => toggle('includeDeleted')}
        label={t('settings.includeDeleted')}
        tone="danger"
      />

      <div className="space-y-2">
        <p className="label-xs">{t('settings.exportPeriod')}</p>
        <VaultPeriod options={options} onChange={onChange} />
      </div>
    </div>
  );
}

function VaultPeriod({ options, onChange }: {
  options: BackupOptions;
  onChange: (next: BackupOptions) => void;
}) {
  const { t } = useTranslation();
  // Presentation only: the export reads just `dateFrom`/`dateTo`, and empty
  // means "no limit" there. On ⇒ both fields empty; off ⇒ they may stay empty
  // and then still include everything — the checkbox only enables the fields.
  const [allTime, setAllTime] = useState(options.dateFrom === '' && options.dateTo === '');
  return (
    <>
      <BlockCheckbox
        checked={allTime}
        onChange={(next) => {
          setAllTime(next);
          if (next) onChange({ ...options, dateFrom: '', dateTo: '' });
        }}
        label={t('settings.exportAllTime')}
        hint={t('settings.exportAllTimeHint')}
        tone="warning"
      />
      <div className={`flex gap-3 items-center ${allTime ? 'opacity-50' : ''}`}>
        {(['dateFrom', 'dateTo'] as const).map((key) => (
          <div key={key} className="flex-1">
            <label className="label-xs block mb-2">{t(key === 'dateFrom' ? 'settings.dateFrom' : 'settings.dateTo')}</label>
            <input
              type="date"
              value={options[key]}
              disabled={allTime}
              data-empty={options[key] === '' || undefined}
              onChange={(e) => onChange({ ...options, [key]: e.target.value })}
              className="input-field settings-field"
            />
          </div>
        ))}
      </div>
    </>
  );
}
