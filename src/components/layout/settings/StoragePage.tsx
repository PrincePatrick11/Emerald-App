import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Brush, Check, HardDrive } from 'lucide-react';
import Button from '../../ui/Button';
import { deleteImageFiles, findUnusedImages, type UnusedImages } from '../../../lib/images';
import { getDb } from '../../../lib/db';
import { formatBytes } from '../../../lib/helpers';
import SettingsSection from './SettingsSection';

/** Was die App auf der Platte liegen hat, und was davon weg kann. */
export default function StoragePage() {
  const { t } = useTranslation();

  // Aufraeumen der Bildablage: erst zaehlen, dann auf Bestaetigung loeschen.
  const [unused, setUnused] = useState<UnusedImages | null>(null);
  const [scanning, setScanning] = useState(false);
  const [cleanupFreed, setCleanupFreed] = useState<number | null>(null);
  const byteUnits: [string, string, string] = [
    t('common.bytes'), t('common.kilobytes'), t('common.megabytes'),
  ];

  async function scanUnusedImages() {
    setScanning(true);
    setCleanupFreed(null);
    try {
      setUnused(await findUnusedImages(await getDb()));
    } catch (e) {
      console.error('[images] scan failed', e);
      setUnused({ names: [], bytes: 0 });
    } finally {
      setScanning(false);
    }
  }

  async function removeUnusedImages() {
    if (!unused?.names.length) return;
    try {
      setCleanupFreed(await deleteImageFiles(unused.names));
      setUnused(null);
    } catch (e) {
      console.error('[images] cleanup failed', e);
    }
  }

  return (
    <SettingsSection icon={<HardDrive size={14} />} title={t('settings.storage')}>
        <div className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-stone-800/60 border border-stone-700/40">
          <span className="flex items-center gap-2 text-sm text-stone-300 min-w-0">
            <Brush size={14} className="shrink-0" />
            <span className="truncate">{t('settings.cleanupImages')}</span>
          </span>

          {unused === null ? (
            <Button onClick={scanUnusedImages} disabled={scanning} tone="amber" className="shrink-0">
              {scanning ? t('settings.cleanupScanning') : t('settings.cleanupScan')}
            </Button>
          ) : unused.names.length === 0 ? (
            <span className="text-xs text-stone-500 shrink-0">{t('settings.cleanupNone')}</span>
          ) : (
            <span className="flex items-center gap-2 shrink-0">
              <span className="text-xs text-stone-400">
                {t('settings.cleanupFound', { count: unused.names.length, size: formatBytes(unused.bytes, byteUnits) })}
              </span>
              <Button onClick={removeUnusedImages} tone="danger">
                {t('settings.cleanupDelete')}
              </Button>
            </span>
          )}

          {cleanupFreed !== null && (
            <span className="text-xs text-jade-400 flex items-center gap-1 shrink-0">
              <Check size={12} /> {t('settings.cleanupDone', { size: formatBytes(cleanupFreed, byteUnits) })}
            </span>
          )}
        </div>
    </SettingsSection>
  );
}
