import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Brush, HardDrive, Trash2 } from 'lucide-react';
import Button from '../../ui/Button';
import { deleteImageFiles, findUnusedImages } from '../../../lib/images';
import { deleteIconFiles, findUnusedIcons } from '../../../lib/icons';
import { getDb } from '../../../lib/db';
import { fileNamesHeldByDrafts } from '../../../store/draftStore';
import { formatBytes } from '../../../lib/helpers';
import { TRASH_RETENTION_OPTIONS } from '../../../lib/vaultSettings';
import { useSettingsStore } from '../../../store/settingsStore';
import SettingsChoiceButton, { SettingsChoiceRow } from './SettingsChoiceButton';
import SettingsSection, { SettingsStatus } from './SettingsSection';

/** What the app has lying on the disk, and which of it can go. */
export default function StoragePage() {
  const { t } = useTranslation();
  const retentionDays = useSettingsStore((s) => s.settings.trash.retentionDays);
  const update = useSettingsStore((s) => s.update);

  // Cleaning up the image store and the icons beside it: count first, then
  // delete on confirmation. One action for both — an icon is a picture too.
  const [unused, setUnused] = useState<{ names: string[]; bytes: number; images: string[]; icons: string[] } | null>(null);
  const [scanning, setScanning] = useState(false);
  const [cleanupFreed, setCleanupFreed] = useState<number | null>(null);
  const byteUnits: [string, string, string] = [
    t('common.bytes'), t('common.kilobytes'), t('common.megabytes'),
  ];

  async function scanUnusedImages() {
    setScanning(true);
    setCleanupFreed(null);
    try {
      const db = await getDb();
      const [found, foundIcons] = await Promise.all([findUnusedImages(db), findUnusedIcons(db)]);
      // A file an unsaved draft of a template or a block already names stays.
      const held = fileNamesHeldByDrafts();
      const images = found.names.filter((name) => !held.has(name));
      const icons = foundIcons.names.filter((name) => !held.has(name));
      const sizes = new Map([...found.sizes, ...foundIcons.sizes]);
      const bytes = [...images, ...icons].reduce((total, name) => total + (sizes.get(name) ?? 0), 0);
      setUnused({ names: [...images, ...icons], bytes, images, icons });
    } catch (e) {
      console.error('[images] scan failed', e);
      setUnused({ names: [], bytes: 0, images: [], icons: [] });
    } finally {
      setScanning(false);
    }
  }

  async function removeUnusedImages() {
    if (!unused?.names.length) return;
    try {
      const [images, iconBytes] = await Promise.all([
        unused.images.length ? deleteImageFiles(unused.images) : Promise.resolve(0),
        unused.icons.length ? deleteIconFiles(unused.icons) : Promise.resolve(0),
      ]);
      setCleanupFreed(images + iconBytes);
      setUnused(null);
    } catch (e) {
      console.error('[images] cleanup failed', e);
    }
  }

  return (
    <>
      <SettingsSection icon={<Trash2 size={14} />} title={t('settings.trashRetention')} description={t('settings.trashRetentionHint')}>
        <SettingsChoiceRow>
          {TRASH_RETENTION_OPTIONS.map((days) => (
            <SettingsChoiceButton
              key={days ?? 'never'}
              active={retentionDays === days}
              onClick={() => update('trash', { retentionDays: days })}
            >
              {days === null ? t('settings.trashRetentionNever') : t('settings.trashRetentionDays', { count: days })}
            </SettingsChoiceButton>
          ))}
        </SettingsChoiceRow>
      </SettingsSection>

      <SettingsSection icon={<HardDrive size={14} />} title={t('settings.storage')} description={t('settings.storageHint')}>
        <div className="settings-row">
          <span className="flex items-center gap-2 text-sm min-w-0 text-secondary">
            <Brush size={14} className="shrink-0" />
            <span className="truncate">{t('settings.cleanupImages')}</span>
          </span>

          {unused === null ? (
            <Button onClick={scanUnusedImages} disabled={scanning} tone="neutral" className="shrink-0">
              {scanning ? t('settings.cleanupScanning') : t('settings.cleanupScan')}
            </Button>
          ) : unused.names.length === 0 ? (
            <span className="text-xs shrink-0 text-muted">{t('settings.cleanupNone')}</span>
          ) : (
            <span className="flex items-center gap-2 shrink-0">
              <span className="text-xs text-secondary">
                {t('settings.cleanupFound', { count: unused.names.length, size: formatBytes(unused.bytes, byteUnits) })}
              </span>
              <Button onClick={removeUnusedImages} tone="danger">
                {t('settings.cleanupDelete')}
              </Button>
            </span>
          )}

          {cleanupFreed !== null && (
            <SettingsStatus tone="success" className="shrink-0">
              {t('settings.cleanupDone', { size: formatBytes(cleanupFreed, byteUnits) })}
            </SettingsStatus>
          )}
        </div>
      </SettingsSection>
    </>
  );
}
