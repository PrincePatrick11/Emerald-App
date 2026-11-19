import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Upload } from 'lucide-react';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import BlockCheckbox from '../blocks/BlockCheckbox';
import { VaultLocationRow } from './PickerRows';
import { VAULT_KEY_CANCELLED } from '../../store/vaultKeyStore';
import { keyErrorOf } from '../../lib/vaultKeys';
import {
  NEW_VAULT_TARGET_ERROR_KEY,
  newVaultBaseDir,
  newVaultTarget,
  probeNewVaultTarget,
} from '../../lib/vaultManager';
import {
  type ImportMode,
  type ImportTypeFilters,
  CONTENT_TYPES,
  allTypesIncluded,
  closeVaultFile,
  importDatabase,
  type OpenedVaultFile,
} from '../../lib/dbBackup';
import { EmeraldNotice } from '../../lib/emerald/file';
import { SETTINGS_GROUPS, type SettingsGroup } from '../../lib/vaultSettings';
import { resolveOpenEdits } from '../../lib/openEdits';
import { formatEntryDate } from '../../lib/formatDate';
import SettingsChoiceButton from './settings/SettingsChoiceButton';
import { SettingsCheckboxGrid, SettingsStatus } from './settings/SettingsSection';
import { categoryLabel } from '../../lib/categories';
import EntryCategoryChecks from './settings/EntryCategoryChecks';

/** A record instead of a list: a new settings group without a label is a type error. */
const SETTINGS_GROUP_LABEL_KEYS: Record<SettingsGroup, string> = {
  appearance: 'settings.groupAppearance',
  trash: 'settings.groupTrash',
  leftList: 'settings.groupLeftList',
  emojis: 'settings.groupEmojis',
  images: 'settings.groupImages',
  tags: 'settings.groupTags',
  editor: 'settings.groupEditor',
  journal: 'settings.groupJournal',
  templates: 'settings.groupTemplates',
};

/**
 * Importing a `.vault.emerald` — a vault's content or a raw backup — that
 * the title bar's Import opened: as a new vault, merged, or replacing
 * everything. The file is open when it arrives and closed here when the
 * dialog goes, imported or not.
 */
export default function VaultImportModal({ file, onClose }: { file: OpenedVaultFile; onClose: () => void }) {
  const { t } = useTranslation();
  // Add-vault as the default: the only mode that surely does not touch existing data.
  const [importMode, setImportMode] = useState<ImportMode>('add-vault');
  const [newVaultName, setNewVaultName] = useState(() => t('settings.importedVault'));
  // Target folder of the new vault — the same mechanism as in the vault picker:
  // `{Documents}/Emerald Vaults` as the base, a folder chosen by hand overrides it.
  const [vaultBaseDir, setVaultBaseDir] = useState<string | null>(null);
  const [vaultBaseResolved, setVaultBaseResolved] = useState(false);
  const [vaultCustomPath, setVaultCustomPath] = useState<string | null>(null);
  const [importTypeFilters, setImportTypeFilters] = useState<ImportTypeFilters>(allTypesIncluded);
  // When merging, without a choice everything stays as set in the vault.
  const [settingsGroups, setSettingsGroups] = useState<SettingsGroup[]>([]);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');
  const { preview } = file;

  // Like `openCreateRow` in the vault picker: resolve once so the row shows a
  // real path from the start — and before the import becomes clickable,
  // otherwise a quick click runs into the fallback `{appDataDir}/vaults/{id}`.
  useEffect(() => {
    let live = true;
    void newVaultBaseDir()
      .catch(() => null)
      .then((dir) => {
        if (!live) return;
        setVaultBaseDir(dir);
        setVaultBaseResolved(true);
      });
    return () => { live = false; };
  }, []);

  // Whatever happens, the file is closed with the dialog. Deferred: mounted
  // again at once (React's development double run), the dialog keeps it.
  const closeTimer = useRef<number | undefined>(undefined);
  useEffect(() => {
    window.clearTimeout(closeTimer.current);
    return () => {
      closeTimer.current = window.setTimeout(() => closeVaultFile(file), 0);
    };
  }, [file]);
  // A failed import may have stored some of the file's pictures already:
  // another attempt starts with opening the file again.
  const [spent, setSpent] = useState(false);

  async function handleImport() {
    // Replace and "New vault" close every tab — first settle what happens to
    // edits in progress. Merge leaves them open.
    if (importMode !== 'merge' && !(await resolveOpenEdits())) return;
    setImporting(true);
    setImportError('');
    const vaultName = newVaultName.trim() || t('settings.importedVault');
    const vaultTarget = importMode === 'add-vault' ? newVaultTarget(vaultBaseDir, vaultCustomPath, vaultName) : null;
    try {
      // The same check as when creating a vault — and before the import
      // touches anything: afterwards the new vault would already be in the
      // list while its folder can never come into being.
      if (vaultTarget) {
        const problem = await probeNewVaultTarget(vaultTarget);
        if (problem) {
          setImportError(t(NEW_VAULT_TARGET_ERROR_KEY[problem]));
          return;
        }
      }
      await importDatabase(
        file,
        importMode,
        importMode === 'add-vault' ? { name: vaultName, path: vaultTarget ?? undefined } : undefined,
        importTypeFilters,
        importMode === 'merge' ? settingsGroups : [],
      );
      onClose();
    } catch (err) {
      // Cancelled at the new vault's password: not an error, just no import.
      if (keyErrorOf(err) === VAULT_KEY_CANCELLED) return;
      // A damaged file says so itself; anything else as it came.
      setImportError(err instanceof EmeraldNotice ? err.message : String(err));
      setSpent(true);
    } finally {
      setImporting(false);
    }
  }

  const contains = [
    preview.entriesCount && `${preview.entriesCount} ${t('settings.previewEntries')}`,
    preview.templatesCount && `${preview.templatesCount} ${t('settings.previewTemplates')}`,
    preview.taskCount && `${preview.taskCount} ${t('settings.previewTasks')}`,
    preview.languagesCount && `${preview.languagesCount} ${t('settings.previewLanguages')}`,
  ].filter(Boolean).join(', ');

  return (
    <Modal
      title={t('settings.importDb')}
      onClose={onClose}
      dismissible={!importing}
      widthClassName="w-[560px] max-w-full"
      bodyClassName="modal-body flex-1 overflow-y-auto"
      footer={(
        <Button onClick={handleImport} disabled={importing || spent || !vaultBaseResolved} variant="primary">
          <Upload size={14} />
          {importing ? t('settings.importing') : t('settings.importBtn')}
        </Button>
      )}
    >
      <div className="space-y-3">
        <p className="text-xs text-secondary">
          {t('vaultImport.fileFrom', { date: formatEntryDate(preview.exportedAt) })}
          {contains && ` ${t('settings.previewContains')} ${contains}`}
        </p>

        {/* Type filters — the same packing list as for the export: the
            entries by the categories the file holds entries of. */}
        {preview.entriesCount > 0 && (
          <EntryCategoryChecks
            categories={preview.categories
              .filter((c) => preview.entryCounts[c.id])
              .map((c) => ({
                id: c.id,
                label: categoryLabel(t, c),
                emoji: c.emoji,
                count: preview.entryCounts[c.id],
              }))}
            selection={importTypeFilters}
            onChange={(selection) => setImportTypeFilters((f) => ({ ...f, ...selection }))}
            uncategorizedCount={preview.uncategorizedCount}
          />
        )}
        <SettingsCheckboxGrid label={t('settings.importInclude')}>
          {CONTENT_TYPES.map(([key, labelKey]) => (
            <BlockCheckbox
              key={key}
              checked={importTypeFilters[key]}
              onChange={() => setImportTypeFilters((f) => ({ ...f, [key]: !f[key] }))}
              label={t(labelKey)}
            />
          ))}
        </SettingsCheckboxGrid>

        {/* Mode as choice cards — add-vault first: the mode that touches
            nothing existing is the default and the first handle, replace
            comes last as the most destructive. */}
        <div className="space-y-1.5">
          <p className="label-xs mb-2">{t('settings.importMode')}</p>
          {(
            [
              ['add-vault', 'settings.modeAddVault', 'settings.modeAddVaultDesc'],
              ['merge', 'settings.modeMerge', 'settings.modeMergeDesc'],
              ['replace', 'settings.modeReplace', 'settings.modeReplaceDesc'],
            ] as [ImportMode, string, string][]
          ).map(([mode, labelKey, descKey]) => (
            <SettingsChoiceButton
              key={mode}
              active={importMode === mode}
              onClick={() => setImportMode(mode)}
              layout="card"
              className="block w-full text-left px-3 py-2"
            >
              <span className="block text-xs font-medium">{t(labelKey)}</span>
              <span className="block text-xs mt-0.5 text-muted">{t(descKey)}</span>
            </SettingsChoiceButton>
          ))}
        </div>

        {importMode === 'add-vault' && (
          <div className="space-y-2">
            <div>
              <label className="label-xs block mb-2">{t('settings.newVaultName')}</label>
              <input
                type="text"
                value={newVaultName}
                onChange={(e) => setNewVaultName(e.target.value)}
                placeholder={t('vault.namePlaceholder')}
                className="input-field settings-field"
              />
            </div>
            <div>
              <label className="label-xs block mb-2">{t('settings.newVaultLocation')}</label>
              <VaultLocationRow
                target={newVaultTarget(vaultBaseDir, vaultCustomPath, newVaultName.trim() || t('settings.importedVault'))}
                customPath={vaultCustomPath}
                onPickFolder={async () => {
                  const picked = await openDialog({ directory: true, multiple: false });
                  if (typeof picked !== 'string') return;
                  setVaultCustomPath(picked);
                  // Like `pickFolder` in the vault picker: the correction
                  // takes the old error message away immediately.
                  setImportError('');
                }}
                onResetFolder={() => setVaultCustomPath(null)}
              />
            </div>
          </div>
        )}

        {/* A choice only when merging: Replace and New vault take over the
            file's settings entirely. */}
        {importMode === 'merge' && preview.hasSettings && (
          <SettingsCheckboxGrid label={t('settings.importSettings')}>
            {SETTINGS_GROUPS.map((group) => {
              const active = settingsGroups.includes(group);
              return (
                <BlockCheckbox
                  key={group}
                  checked={active}
                  onChange={() => setSettingsGroups((groups) => (active ? groups.filter((g) => g !== group) : [...groups, group]))}
                  label={t(SETTINGS_GROUP_LABEL_KEYS[group])}
                />
              );
            })}
          </SettingsCheckboxGrid>
        )}

        {/* Replace warning — the danger tokens, not amber: the warning
            announces permanent data loss, and red means destructive
            (design.md), in both themes. */}
        {importMode === 'replace' && (
          <div className="flex items-start gap-2 text-xs rounded-lg border px-3 py-2 text-[var(--danger-text)] bg-[var(--danger-bg)] border-[var(--danger-border)]">
            <AlertTriangle size={12} className="shrink-0 mt-0.5" />
            <span className="min-w-0">
              {t('settings.modeReplaceWarning')}
              {preview.hasSettings && ` ${t('settings.modeReplaceSettingsWarning')}`}
            </span>
          </div>
        )}

        {importError && <SettingsStatus tone="error">{importError}</SettingsStatus>}
      </div>
    </Modal>
  );
}
