import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download } from 'lucide-react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import BlockCheckbox from '../blocks/BlockCheckbox';
import { type BackupOptions, CONTENT_TYPES, exportDatabase, FULL_BACKUP_OPTIONS } from '../../lib/dbBackup';
import { SettingsCheckboxGrid, SettingsDescription, SettingsStatus } from './settings/SettingsSection';
import { useCategoryStore } from '../../store/categoryStore';
import { categoryLabel } from '../../lib/categories';
import EntryCategoryChecks, { type CategoryChoice } from './settings/EntryCategoryChecks';

/** Everything — except the trash, which is added by hand. */
const DEFAULT_EXPORT_OPTIONS: BackupOptions = { ...FULL_BACKUP_OPTIONS, includeDeleted: false };

/**
 * The database export as a `.vault.emerald`, from the title bar's Export —
 * until the export menu takes it over.
 */
export default function VaultExportModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const vaultCategories = useCategoryStore((s) => s.categories);
  const exportCategories: CategoryChoice[] = vaultCategories.map((c) => ({ id: c.id, label: categoryLabel(t, c), emoji: c.emoji }));
  const [exportOpts, setExportOpts] = useState<BackupOptions>(DEFAULT_EXPORT_OPTIONS);
  // Presentation only: the export reads just `dateFrom`/`dateTo`, and empty
  // means "no limit" there. On ⇒ both fields empty; off ⇒ they may stay empty
  // and then still include everything — the checkbox only enables the fields.
  const [allTime, setAllTime] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState(false);

  async function handleExport() {
    setExporting(true);
    setExportError(false);
    try {
      // Cancelling in the save dialog is no success, and no reason to close.
      if (await exportDatabase(exportOpts)) onClose();
    } catch (e) {
      console.error('[backup] export failed', e);
      setExportError(true);
    } finally {
      setExporting(false);
    }
  }

  function toggle(key: keyof BackupOptions) {
    setExportOpts((o) => ({ ...o, [key]: !o[key] }));
  }

  return (
    <Modal
      title={t('settings.exportDb')}
      onClose={onClose}
      dismissible={!exporting}
      widthClassName="w-[560px] max-w-full"
      bodyClassName="modal-body flex-1 overflow-y-auto"
      footer={(
        <Button onClick={handleExport} disabled={exporting} variant="primary">
          <Download size={14} />
          {exporting ? t('settings.exporting') : t('settings.exportBtn')}
        </Button>
      )}
    >
      <div className="space-y-3">
        <SettingsDescription>{t('settings.exportDbHint')}</SettingsDescription>
        <EntryCategoryChecks
          categories={exportCategories}
          selection={exportOpts}
          onChange={(selection) => setExportOpts((o) => ({ ...o, ...selection }))}
        />

        <SettingsCheckboxGrid label={t('settings.exportInclude')}>
          {([...CONTENT_TYPES, ['includeSettings', 'settings.includeSettings']] as [keyof BackupOptions, string][]).map(([key, labelKey]) => (
            <BlockCheckbox
              key={key}
              checked={!!exportOpts[key]}
              onChange={() => toggle(key)}
              label={t(labelKey)}
              title={key === 'includeSettings' ? t('settings.includeSettingsHint') : undefined}
            />
          ))}
        </SettingsCheckboxGrid>

        {/* The one row that takes along what was thrown away gets the warning colour and a row of its own. */}
        <BlockCheckbox
          checked={exportOpts.includeDeleted}
          onChange={() => toggle('includeDeleted')}
          label={t('settings.includeDeleted')}
          tone="danger"
        />

        {/* The checkbox disables the fields instead of hiding them; switching
            it on clears them, or a disabled date would keep taking effect. */}
        <div className="space-y-2">
          <p className="label-xs">{t('settings.exportPeriod')}</p>
          <BlockCheckbox
            checked={allTime}
            onChange={(next) => {
              setAllTime(next);
              if (next) setExportOpts((o) => ({ ...o, dateFrom: '', dateTo: '' }));
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
                  value={exportOpts[key]}
                  disabled={allTime}
                  data-empty={exportOpts[key] === '' || undefined}
                  onChange={(e) => setExportOpts((o) => ({ ...o, [key]: e.target.value }))}
                  className="input-field settings-field"
                />
              </div>
            ))}
          </div>
        </div>

        {exportError && <SettingsStatus tone="error">{t('settings.exportError')}</SettingsStatus>}
      </div>
    </Modal>
  );
}
