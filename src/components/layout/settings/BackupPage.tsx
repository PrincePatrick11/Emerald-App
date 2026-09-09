import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Check, Download, FolderOpen, Upload } from 'lucide-react';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import Button from '../../ui/Button';
import { FilterChipButton } from '../../ui/FilterPanel';
import { VaultLocationRow } from '../VaultModal';
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
  type BackupFile,
  type BackupPreview,
  type ImportCategoryFilters,
  exportDatabase,
  openBackupFile,
  importDatabase,
} from '../../../lib/dbBackup';
import SettingsChoiceButton from './SettingsChoiceButton';
import SettingsSection from './SettingsSection';

const DEFAULT_EXPORT_OPTIONS: BackupOptions = {
  includeJournal: true,
  includeWiki: true,
  includeOperations: true,
  includeRoutines: true,
  includeAltars: true,
  includeTasks: true,
  includeTags: true,
  dateFrom: '',
  dateTo: '',
  includeDeleted: false,
};

/**
 * Export und Import der Datenbank. Beides steht offen da: seit die Sicherung
 * einen eigenen Bereich hat, ist der Platz vorhanden, und die Klapp-Panels von
 * vorher versteckten nur, was der Bereich ohnehin ankuendigt. Der Import zeigt
 * seine Optionen weiterhin erst, wenn eine Datei gewaehlt ist — das ist keine
 * Faltung, sondern hat ohne Datei keinen Inhalt.
 */
export default function BackupPage() {
  const { t } = useTranslation();


  // Export
  const [exportOpts, setExportOpts] = useState<BackupOptions>(DEFAULT_EXPORT_OPTIONS);
  const [exporting, setExporting] = useState(false);
  const [exportDone, setExportDone] = useState(false);
  const [exportError, setExportError] = useState(false);

  // Import
  const [importedFile, setImportedFile] = useState<{ backup: BackupFile; preview: BackupPreview } | null>(null);
  // Add-Vault als Vorauswahl: der einzige Modus, der bestehende Daten sicher
  // nicht anfasst.
  const [importMode, setImportMode] = useState<ImportMode>('add-vault');
  const [newVaultName, setNewVaultName] = useState('');
  // Zielordner des neuen Vaults — dieselbe Mechanik wie im Vault-Modal:
  // `{Dokumente}/Emerald Vaults` als Basis, ein selbst gewaehlter Ordner
  // schlaegt sie.
  const [vaultBaseDir, setVaultBaseDir] = useState<string | null>(null);
  const [vaultCustomPath, setVaultCustomPath] = useState<string | null>(null);
  const [importTypeFilters, setImportTypeFilters] = useState<ImportTypeFilters>({
    includeJournal: true, includeWiki: true, includeOperations: true,
    includeRoutines: true, includeAltars: true, includeTasks: true, includeTags: true,
  });
  const [excludedCategoryIds] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [importDone, setImportDone] = useState(false);
  const [importError, setImportError] = useState('');

  // ── Export handler ─────────────────────────────────────────────────────────
  async function handleExport() {
    setExporting(true);
    setExportDone(false);
    setExportError(false);
    try {
      // Abbruch im Dialog ist kein Erfolg — `exportDatabase` meldet, ob
      // wirklich geschrieben wurde.
      setExportDone(await exportDatabase(exportOpts));
    } catch (e) {
      // Ohne catch verpuffte ein abgelehnter Schreibzugriff (z. B. Ziel
      // ausserhalb der erlaubten Wurzeln) als unhandled rejection — der Knopf
      // sprang zurueck, und nichts sagte warum.
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
      // Wie `openCreateRow` im Vault-Modal: einmal aufloesen, damit die Zeile
      // von Anfang an einen echten Pfad zeigt — und zwar bevor der Import
      // klickbar wird, sonst laeuft ein schneller Klick in den Rueckfall
      // `{appDataDir}/vaults/{id}`. Scheitert die Aufloesung, bleibt der.
      setVaultBaseDir(await newVaultBaseDir().catch(() => null));
      setImportTypeFilters({ includeJournal: true, includeWiki: true, includeOperations: true, includeRoutines: true, includeAltars: true, includeTasks: true, includeTags: true });
    } catch {
      setImportError(t('settings.importErrorInvalid'));
    }
  }

  async function handleImport() {
    if (!importedFile) return;
    setImporting(true);
    setImportDone(false);
    setImportError('');
    const categoryFilters: ImportCategoryFilters = {
      excludedCategoryIds,
    };
    const vaultName = newVaultName.trim() || t('settings.importedVault');
    const vaultTarget = importMode === 'add-vault'
      ? newVaultTarget(vaultBaseDir, vaultCustomPath, vaultName)
      : null;
    try {
      // Dieselbe Pruefung wie beim Anlegen eines Vaults — und zwar bevor der
      // Import irgendetwas anfasst: danach staende der neue Vault schon in der
      // Liste, waehrend sein Ordner nie entstehen kann.
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
        categoryFilters,
        importTypeFilters,
      );
      setImportDone(true);
      setImportedFile(null);
    } catch (err) {
      setImportError(String(err));
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
      <SettingsSection icon={<Download size={14} />} title={t('settings.exportDb')}>
        <div className="rounded-lg bg-stone-800/60 border border-stone-700/40 px-4 py-3 space-y-3">
          {/* Type chips — dieselben Pillen wie im Filter-Panel, statt
              handgebauter Kaestchen: an/aus liest sich am Chip selbst. */}
          <div>
            <p className="text-xs text-stone-500 mb-2">{t('settings.exportInclude')}</p>
            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  ['includeJournal', 'settings.includeJournal'],
                  ['includeWiki', 'settings.includeWiki'],
                  ['includeOperations', 'settings.includeOperations'],
                  ['includeRoutines', 'settings.includeRoutines'],
                  ['includeAltars', 'settings.includeAltars'],
                  ['includeTasks', 'settings.includeTasks'],
                  ['includeTags', 'settings.includeTags'],
                ] as [keyof BackupOptions, string][]
              ).map(([key, labelKey]) => (
                <FilterChipButton
                  key={key}
                  active={!!exportOpts[key]}
                  onClick={() => toggleExportOpt(key)}
                >
                  {exportOpts[key] && <Check size={12} />}
                  {t(labelKey)}
                </FilterChipButton>
              ))}
            </div>
          </div>

          {/* Date range */}
          <div className="flex gap-3 items-center">
            <div className="flex-1">
              <label className="text-xs text-stone-500 block mb-1">{t('settings.dateFrom')}</label>
              <input
                type="date"
                value={exportOpts.dateFrom}
                onChange={(e) => setExportOpts((o) => ({ ...o, dateFrom: e.target.value }))}
                className="w-full bg-stone-800 border border-stone-700/60 rounded px-2 py-1 text-xs text-stone-300 outline-none focus:border-jade-500/60"
              />
            </div>
            <div className="flex-1">
              <label className="text-xs text-stone-500 block mb-1">{t('settings.dateTo')}</label>
              <input
                type="date"
                value={exportOpts.dateTo}
                onChange={(e) => setExportOpts((o) => ({ ...o, dateTo: e.target.value }))}
                className="w-full bg-stone-800 border border-stone-700/60 rounded px-2 py-1 text-xs text-stone-300 outline-none focus:border-jade-500/60"
              />
            </div>
          </div>

          {/* Include deleted */}
          <label className="flex items-center gap-2 cursor-pointer group">
            <div
              onClick={() => toggleExportOpt('includeDeleted')}
              className={`w-4 h-4 rounded border flex items-center justify-center transition-colors cursor-pointer ${
                exportOpts.includeDeleted
                  ? 'bg-jade-500/30 border-jade-500/60'
                  : 'border-stone-600 hover:border-stone-400'
              }`}
            >
              {exportOpts.includeDeleted && <Check size={10} className="text-jade-400" />}
            </div>
            <span className="text-xs text-stone-400 group-hover:text-stone-300 transition-colors">
              {t('settings.includeDeleted')}
            </span>
          </label>

          <div className="flex items-center gap-2">
            <Button
              onClick={handleExport}
              disabled={exporting}
              variant="primary"
            >
              <Download size={14} />
              {exporting ? t('settings.exporting') : t('settings.exportBtn')}
            </Button>
            {exportDone && (
              <span className="text-xs text-jade-400 flex items-center gap-1">
                <Check size={12} /> {t('settings.exportDone')}
              </span>
            )}
            {exportError && (
              <span className="text-xs text-red-400 flex items-center gap-1">
                <AlertTriangle size={12} /> {t('settings.exportError')}
              </span>
            )}
          </div>
        </div>
      </SettingsSection>

      <SettingsSection icon={<Upload size={14} />} title={t('settings.importDb')}>
        <div className="rounded-lg bg-stone-800/60 border border-stone-700/40 px-4 py-3 space-y-3">
          {/* File picker — die Vorschau auf eigener Zeile: in der
              Button-Zeile hatte sie jeden weiteren Nachbarn auf null
              Breite gequetscht. */}
          <div className="space-y-1.5">
            {/* Ohne Datei besteht der Abschnitt nur aus einem Knopf; die Zeile
                sagt, was danach passiert, statt die Flaeche leer zu lassen. */}
            {!importedFile && (
              <p className="text-xs text-stone-500">{t('settings.importHint')}</p>
            )}
            <Button variant="secondary" onClick={handleBrowse}>
              <FolderOpen size={14} />
              {t('settings.importBrowse')}
            </Button>
            {importedFile && (
              <p className="text-xs text-stone-400">
                {t('settings.previewContains')} {[
                  importedFile.preview.journalCount && `${importedFile.preview.journalCount} J`,
                  importedFile.preview.wikiCount && `${importedFile.preview.wikiCount} W`,
                  importedFile.preview.opsCount && `${importedFile.preview.opsCount} O`,
                  importedFile.preview.routinesCount && `${importedFile.preview.routinesCount} R`,
                  importedFile.preview.altarsCount && `${importedFile.preview.altarsCount} A`,
                  importedFile.preview.altarItemsCount && `${importedFile.preview.altarItemsCount} E`,
                  importedFile.preview.taskCount && `${importedFile.preview.taskCount} T`,
                ].filter(Boolean).join(', ')}
              </p>
            )}
          </div>

          {/* Type filters — dieselben Chips wie beim Export. */}
          {importedFile && (
            <div>
              <p className="text-xs text-stone-500 mb-2">{t('settings.importInclude')}</p>
              <div className="flex flex-wrap gap-1.5">
                {(
                  [
                    ['includeJournal', 'settings.includeJournal'],
                    ['includeWiki', 'settings.includeWiki'],
                    ['includeOperations', 'settings.includeOperations'],
                    ['includeRoutines', 'settings.includeRoutines'],
                    ['includeAltars', 'settings.includeAltars'],
                    ['includeTasks', 'settings.includeTasks'],
                    ['includeTags', 'settings.includeTags'],
                  ] as [keyof ImportTypeFilters, string][]
                ).map(([key, labelKey]) => (
                  <FilterChipButton
                    key={key}
                    active={importTypeFilters[key]}
                    onClick={() => setImportTypeFilters((f) => ({ ...f, [key]: !f[key] }))}
                  >
                    {importTypeFilters[key] && <Check size={12} />}
                    {t(labelKey)}
                  </FilterChipButton>
                ))}
              </div>
            </div>
          )}

          {/* Import mode radio */}
          {importedFile && (
            <>
              {/* Modus als Choice-Karten (derselbe Knopf wie die
                  Theme-Wahl oben) — Add-Vault zuerst: der Modus, der
                  nichts Bestehendes anfasst, ist Vorauswahl und erster
                  Griff, Replace steht als destruktivster zuletzt. */}
              <div className="space-y-1.5">
                <p className="text-xs text-stone-500">{t('settings.importMode')}</p>
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
                    className="block w-full text-left px-3 py-2"
                  >
                    {/* Aktiv-Zustand nur ueber die Faerbung — wie bei
                        der Theme- und Sprachwahl oben, kein Haekchen. */}
                    <span className={`block text-xs font-medium ${
                      importMode === mode ? 'text-jade-400' : 'text-stone-300'
                    }`}>
                      {t(labelKey)}
                    </span>
                    <span className="block text-xs text-stone-500 mt-0.5">{t(descKey)}</span>
                  </SettingsChoiceButton>
                ))}
              </div>

              {/* New vault name + location */}
              {importMode === 'add-vault' && (
                <div className="space-y-2">
                  <div>
                    <label className="text-xs text-stone-500 block mb-1">{t('settings.newVaultName')}</label>
                    <input
                      type="text"
                      value={newVaultName}
                      onChange={(e) => setNewVaultName(e.target.value)}
                      placeholder={t('vault.namePlaceholder')}
                      className="w-full bg-stone-800 border border-stone-700/60 rounded px-2 py-1 text-xs text-stone-300 outline-none focus:border-jade-500/60"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-stone-500 block mb-1">{t('settings.newVaultLocation')}</label>
                    <VaultLocationRow
                      target={newVaultTarget(
                        vaultBaseDir,
                        vaultCustomPath,
                        newVaultName.trim() || t('settings.importedVault'),
                      )}
                      customPath={vaultCustomPath}
                      dense
                      onPickFolder={async () => {
                        const picked = await openDialog({ directory: true, multiple: false });
                        if (typeof picked !== 'string') return;
                        setVaultCustomPath(picked);
                        // Wie `pickFolder` im Vault-Modal: die Korrektur
                        // nimmt die alte Fehlermeldung sofort mit.
                        setImportError('');
                      }}
                      onResetFolder={() => setVaultCustomPath(null)}
                    />
                  </div>
                </div>
              )}

              {/* Replace warning — die Danger-Tokens, nicht Amber: die
                  Warnung kuendigt endgueltigen Datenverlust an, und Rot
                  heisst destruktiv (design.md), in beiden Themes. */}
              {importMode === 'replace' && (
                <div className="flex items-start gap-2 text-xs rounded-lg border px-3 py-2 text-[var(--danger-text)] bg-[var(--danger-bg)] border-[var(--danger-border)]">
                  <AlertTriangle size={12} className="shrink-0 mt-0.5" />
                  <span className="min-w-0">{t('settings.modeReplaceWarning')}</span>
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
                {importDone && (
                  <span className="text-xs text-jade-400 flex items-center gap-1">
                    <Check size={12} /> {t('settings.importDone')}
                  </span>
                )}
              </div>
            </>
          )}

          {/* Am Ende des Panels, nicht in der Datei-Zeile: dort wurde
              die Meldung neben Button und Vorschau-Text auf null
              Breite gequetscht — gesetzt, aber unsichtbar. Hier steht
              sie beim Import-Button, der sie ausloest, und darf
              umbrechen. */}
          {importError && (
            <p className="text-xs text-red-400 flex items-start gap-1.5">
              <AlertTriangle size={12} className="shrink-0 mt-0.5" />
              <span className="min-w-0 break-words">{importError}</span>
            </p>
          )}
        </div>
      </SettingsSection>
    </>
  );
}
