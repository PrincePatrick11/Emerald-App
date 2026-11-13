import { useEffect, useState } from 'react';
import { VAULT_KEY_CANCELLED } from '../../../store/vaultKeyStore';
import { keyErrorOf } from '../../../lib/vaultKeys';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Download, FolderOpen, Upload } from 'lucide-react';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import Button from '../../ui/Button';
import BlockCheckbox from '../../blocks/BlockCheckbox';
import { VaultLocationRow } from '../VaultPicker';
import {
  NEW_VAULT_TARGET_ERROR_KEY,
  newVaultBaseDir,
  newVaultTarget,
  probeNewVaultTarget,
} from '../../../lib/vaultManager';
import {
  type BackupOptions,
  type ImportMode,
  type ImportTypeFilters,
  CONTENT_TYPES,
  allTypesIncluded,
  BACKUP_OUTDATED,
  BACKUP_TOO_NEW,
  type BackupFile,
  type BackupPreview,
  exportDatabase,
  FULL_BACKUP_OPTIONS,
  openBackupFile,
  importDatabase,
} from '../../../lib/dbBackup';
import { SETTINGS_GROUPS, type SettingsGroup } from '../../../lib/vaultSettings';
import { resolveOpenEdits } from '../../../lib/openEdits';
import AutoBackupSection from './AutoBackupSection';
import SettingsChoiceButton from './SettingsChoiceButton';
import SettingsSection, { SettingsCheckboxGrid, SettingsStatus } from './SettingsSection';
import { useVaultStore } from '../../../store/vaultStore';
import { syncStatus } from '../../../lib/sync/engine';

/** Everything as in the automatic backup — except the trash, which is added by hand. */
const DEFAULT_EXPORT_OPTIONS: BackupOptions = { ...FULL_BACKUP_OPTIONS, includeDeleted: false };

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
  backup: 'settings.groupBackup',
};

/**
 * Export and import of the database. Both are shown open: now that backup has
 * its own area there is room for it, and the collapsible panels from before
 * only hid what the area announces anyway. The import still shows its options
 * only once a file is chosen — that is not folding, it simply has no content
 * without a file.
 */
export default function BackupPage() {
  const { t } = useTranslation();
  // Replacing a vault that syncs replaces it on the other devices too.
  const [syncsToOthers, setSyncsToOthers] = useState(false);
  const syncVaultId = useVaultStore((s) => s.activeVaultId);
  useEffect(() => {
    syncStatus(syncVaultId).then((status) => setSyncsToOthers(status.connected), () => setSyncsToOthers(false));
  }, [syncVaultId]);


  // Export
  const [exportOpts, setExportOpts] = useState<BackupOptions>(DEFAULT_EXPORT_OPTIONS);
  // Presentation only: the export reads just `dateFrom`/`dateTo`, and empty
  // means "no limit" there (see lib/dbBackup). On ⇒ both fields empty; off ⇒
  // they may stay empty and then still include everything — the checkbox
  // restricts nothing, it only enables the fields.
  const [allTime, setAllTime] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [exportDone, setExportDone] = useState(false);
  const [exportError, setExportError] = useState(false);

  // Import
  const [importedFile, setImportedFile] = useState<{ backup: BackupFile; preview: BackupPreview } | null>(null);
  // Add-vault as the default: the only mode that surely does not touch
  // existing data.
  const [importMode, setImportMode] = useState<ImportMode>('add-vault');
  const [newVaultName, setNewVaultName] = useState('');
  // Target folder of the new vault — the same mechanism as in the vault picker:
  // `{Documents}/Emerald Vaults` as the base, a folder chosen by hand
  // overrides it.
  const [vaultBaseDir, setVaultBaseDir] = useState<string | null>(null);
  const [vaultCustomPath, setVaultCustomPath] = useState<string | null>(null);
  const [importTypeFilters, setImportTypeFilters] = useState<ImportTypeFilters>(allTypesIncluded);
  // When merging, without a choice everything stays as set in the vault.
  const [settingsGroups, setSettingsGroups] = useState<SettingsGroup[]>([]);
  const [importing, setImporting] = useState(false);
  const [importDone, setImportDone] = useState(false);
  const [importError, setImportError] = useState('');

  // ── Export handler ─────────────────────────────────────────────────────────
  async function handleExport() {
    setExporting(true);
    setExportDone(false);
    setExportError(false);
    try {
      // Cancelling in the dialog is not a success — `exportDatabase` reports
      // whether anything was actually written.
      setExportDone(await exportDatabase(exportOpts));
    } catch (e) {
      // Without the catch, a rejected write (e.g. target outside the allowed
      // roots) would fizzle out as an unhandled rejection — the button would
      // snap back and nothing said why.
      console.error('[backup] export failed', e);
      setExportError(true);
    } finally {
      setExporting(false);
    }
  }

  // ── Import handlers ────────────────────────────────────────────────────────
  async function handleBrowse() {
    setImportError('');
    try {
      const result = await openBackupFile();
      if (!result) return;
      setImportedFile({ backup: result.backup, preview: result.preview });
      setNewVaultName(t('settings.importedVault'));
      setVaultCustomPath(null);
      // Like `openCreateRow` in the vault picker: resolve once so the row shows
      // a real path from the start — and before the import becomes clickable,
      // otherwise a quick click runs into the fallback
      // `{appDataDir}/vaults/{id}`. If resolving fails, that fallback stays.
      setVaultBaseDir(await newVaultBaseDir().catch(() => null));
      setImportTypeFilters(allTypesIncluded());
      setSettingsGroups([]);
    } catch (err) {
      // Emerald reads nothing outside its own folders (`guarded_read_path`) —
      // so an automatic backup on another drive is not a broken one, and the
      // message says what to do. A file from another version is not broken
      // either: it says which.
      const code = keyErrorOf(err);
      setImportError(t(
        code.includes('access denied') ? 'settings.importErrorOutside'
          : code.includes(BACKUP_OUTDATED) ? 'settings.importErrorOldVersion'
            : code.includes(BACKUP_TOO_NEW) ? 'settings.importErrorNewVersion'
              : 'settings.importErrorInvalid',
      ));
    }
  }

  async function handleImport() {
    if (!importedFile) return;
    // Replace and "New vault" close every tab — first settle what happens to
    // edits in progress. Merge leaves them open.
    if (importMode !== 'merge' && !(await resolveOpenEdits())) return;
    setImporting(true);
    setImportDone(false);
    setImportError('');
    const vaultName = newVaultName.trim() || t('settings.importedVault');
    const vaultTarget = importMode === 'add-vault'
      ? newVaultTarget(vaultBaseDir, vaultCustomPath, vaultName)
      : null;
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
        importedFile.backup,
        importMode,
        importMode === 'add-vault'
          ? { name: vaultName, path: vaultTarget ?? undefined }
          : undefined,
        importTypeFilters,
        importMode === 'merge' ? settingsGroups : [],
      );
      setImportDone(true);
      setImportedFile(null);
    } catch (err) {
      // Cancelled at the new vault's password: not an error, just no import.
      if (keyErrorOf(err) !== VAULT_KEY_CANCELLED) setImportError(String(err));
    } finally {
      setImporting(false);
    }
  }

  // ── Checkbox helper ────────────────────────────────────────────────────────
  function toggleExportOpt(key: keyof BackupOptions) {
    setExportOpts((o) => ({ ...o, [key]: !o[key] }));
  }

  return (
    <>
      <SettingsSection icon={<Download size={14} />} title={t('settings.exportDb')} description={t('settings.exportDbHint')}>
        <div className="space-y-3">
          {/* Packing list = checkbox, single choice = choice button (below, the
              three import modes). The same form for both would read like a
              setting from the other pages. */}
          <SettingsCheckboxGrid label={t('settings.exportInclude')}>
            {(
              // The settings appear only here, not for the import: there they
              // are picked group by group further down.
              [...CONTENT_TYPES, ['includeSettings', 'settings.includeSettings']] as [keyof BackupOptions, string][]
            ).map(([key, labelKey]) => (
              <BlockCheckbox
                key={key}
                checked={!!exportOpts[key]}
                onChange={() => toggleExportOpt(key)}
                label={t(labelKey)}
                title={key === 'includeSettings' ? t('settings.includeSettingsHint') : undefined}
              />
            ))}
          </SettingsCheckboxGrid>

          {/* Part of the packing list, but outside the grid: the one row that
              takes along what was thrown away gets the warning colour and a
              row of its own. */}
          <BlockCheckbox
            checked={exportOpts.includeDeleted}
            onChange={() => toggleExportOpt('includeDeleted')}
            label={t('settings.includeDeleted')}
            tone="danger"
          />

          {/* Period: the checkbox sits above the fields and disables them
              instead of hiding them — so you can see what the other choice
              would be. Switching it on clears them, otherwise a disabled date
              would keep silently taking effect in the export. */}
          <div className="space-y-2">
            {/* Its own heading like "Content" above: without it the checkbox
                would read like an eighth entry of the packing list. */}
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
              <div className="flex-1">
                <label className="label-xs block mb-2">{t('settings.dateFrom')}</label>
                <input
                  type="date"
                  value={exportOpts.dateFrom}
                  disabled={allTime}
                  // When empty, the field shows its format instead of a date — that
                  // should be as pale as a placeholder (see index.css).
                  data-empty={exportOpts.dateFrom === '' || undefined}
                  onChange={(e) => setExportOpts((o) => ({ ...o, dateFrom: e.target.value }))}
                  className="input-field settings-field"
                />
              </div>
              <div className="flex-1">
                <label className="label-xs block mb-2">{t('settings.dateTo')}</label>
                <input
                  type="date"
                  value={exportOpts.dateTo}
                  disabled={allTime}
                  data-empty={exportOpts.dateTo === '' || undefined}
                  onChange={(e) => setExportOpts((o) => ({ ...o, dateTo: e.target.value }))}
                  className="input-field settings-field"
                />
              </div>
            </div>
          </div>

          {/* A bit more air than between the groups above: the button triggers
              what they describe together, and would otherwise stick to the
              date fields. */}
          <div className="flex items-center gap-2 pt-2">
            <Button
              onClick={handleExport}
              disabled={exporting}
              variant="primary"
            >
              <Download size={14} />
              {exporting ? t('settings.exporting') : t('settings.exportBtn')}
            </Button>
            {exportDone && <SettingsStatus tone="success">{t('settings.exportDone')}</SettingsStatus>}
            {exportError && <SettingsStatus tone="error">{t('settings.exportError')}</SettingsStatus>}
          </div>
        </div>
      </SettingsSection>

      <SettingsSection icon={<Upload size={14} />} title={t('settings.importDb')} description={t('settings.importDbHint')}>
        <div className="space-y-3">
          {/* File picker — the preview on its own line: in the button row it
              had squeezed every further neighbour to zero width. */}
          <div className="space-y-1.5">
            {/* Without a file the section is just one button; the line says
                what happens next, instead of leaving the area empty. */}
            <Button variant="secondary" onClick={handleBrowse}>
              <FolderOpen size={14} />
              {t('settings.importBrowse')}
            </Button>
            {importedFile && (
              <p className="text-xs text-secondary">
                {t('settings.previewContains')} {[
                  importedFile.preview.journalCount && `${importedFile.preview.journalCount} J`,
                  importedFile.preview.wikiCount && `${importedFile.preview.wikiCount} W`,
                  importedFile.preview.opsCount && `${importedFile.preview.opsCount} O`,
                  importedFile.preview.templatesCount && `${importedFile.preview.templatesCount} V`,
                  importedFile.preview.taskCount && `${importedFile.preview.taskCount} T`,
                  importedFile.preview.languagesCount && `${importedFile.preview.languagesCount} L`,
                ].filter(Boolean).join(', ')}
              </p>
            )}
          </div>

          {/* Type filters — the same packing list as for the export. */}
          {importedFile && (
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
          )}

          {/* Import mode radio */}
          {importedFile && (
            <>
              {/* Mode as choice cards (the same button as the theme
                  choice above) — add-vault first: the mode that touches
                  nothing existing is the default and the first handle,
                  replace comes last as the most destructive. */}
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
                    {/* Active only through the colouring of the button itself
                        (settings-choice-btn), as with the sizes on the
                        General page — no checkmark. */}
                    <span className="block text-xs font-medium">{t(labelKey)}</span>
                    <span className="block text-xs mt-0.5 text-muted">{t(descKey)}</span>
                  </SettingsChoiceButton>
                ))}
              </div>

              {/* New vault name + location */}
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
                      target={newVaultTarget(
                        vaultBaseDir,
                        vaultCustomPath,
                        newVaultName.trim() || t('settings.importedVault'),
                      )}
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

              {/* A choice only when merging: Replace and New vault take over
                  the file's settings entirely. */}
              {importMode === 'merge' && importedFile.preview.hasSettings && (
                <SettingsCheckboxGrid label={t('settings.importSettings')}>
                  {SETTINGS_GROUPS.map((group) => {
                    const active = settingsGroups.includes(group);
                    return (
                      <BlockCheckbox
                        key={group}
                        checked={active}
                        onChange={() => setSettingsGroups((groups) =>
                          active ? groups.filter((g) => g !== group) : [...groups, group])}
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
                    {/* Replace is the one mode in which language and appearance
                        switch without a choice of their own. */}
                    {syncsToOthers && ` ${t('sync.replaceWarning')}`}
                    {importedFile.preview.hasSettings && ` ${t('settings.modeReplaceSettingsWarning')}`}
                  </span>
                </div>
              )}

              {/* Import button */}
              <div className="flex items-center gap-2">
                <Button
                  onClick={handleImport}
                  disabled={importing}
                  variant="primary"
                >
                  <Upload size={14} />
                  {importing ? t('settings.importing') : t('settings.importBtn')}
                </Button>
                {importDone && <SettingsStatus tone="success">{t('settings.importDone')}</SettingsStatus>}
              </div>
            </>
          )}

          {/* At the end of the panel, not in the file row: there the message
              was squeezed to zero width next to the button and preview text —
              set, but invisible. Here it sits by the import button that
              triggers it, and may wrap. */}
          {importError && <SettingsStatus tone="error">{importError}</SettingsStatus>}
        </div>
      </SettingsSection>

      {/* Below export and import: those two are what the page is opened for;
          the automatic backup is set once. */}
      <AutoBackupSection />
    </>
  );
}
