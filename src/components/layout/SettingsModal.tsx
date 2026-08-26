import { useState } from 'react';
import { Globe, Info, Database, Upload, Download, Check, AlertTriangle, ChevronDown, ChevronUp, FolderOpen, Sun, Moon, Type, Brush, HardDrive } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { LANGUAGE_OPTIONS, changeAppLanguage } from '../../i18n';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import { VaultLocationRow } from './VaultModal';
import { FilterChipButton } from '../ui/FilterPanel';
import {
  NEW_VAULT_TARGET_ERROR_KEY,
  newVaultBaseDir,
  newVaultTarget,
  probeNewVaultTarget,
} from '../../lib/vaultManager';
import { useUIStore } from '../../store/uiStore';
import { deleteImageFiles, findUnusedImages, type UnusedImages } from '../../lib/images';
import { getDb } from '../../lib/db';
import { formatBytes } from '../../lib/helpers';
import { FONT_OPTIONS, THEME_OPTIONS } from '../../themes/theme';
import packageJson from '../../../package.json';
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
} from '../../lib/dbBackup';

interface Props {
  onClose: () => void;
}

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

export default function SettingsModal({ onClose }: Props) {
  const { t, i18n } = useTranslation();

  // ── Theme state ────────────────────────────────────────────────────────────
  const theme = useUIStore((s) => s.theme);
  const setTheme = useUIStore((s) => s.setTheme);
  const uiFontId = useUIStore((s) => s.uiFontId);
  const editorFontId = useUIStore((s) => s.editorFontId);
  const setUIFontId = useUIStore((s) => s.setUIFontId);
  const setEditorFontId = useUIStore((s) => s.setEditorFontId);

  // ── Backup panel state ─────────────────────────────────────────────────────
  const [panel, setPanel] = useState<'none' | 'export' | 'import'>('none');

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
  const [excludedWikiCats] = useState<Set<string>>(new Set());
  const [excludedOpCats] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [importDone, setImportDone] = useState(false);
  const [importError, setImportError] = useState('');

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

  const themeIcons = {
    'emerald-noctis': Moon,
    'emerald-parchment': Sun,
  } as const;

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
      excludedWikiCategoryIds: excludedWikiCats,
      excludedOpCategoryIds: excludedOpCats,
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

  const modal = (
    <Modal
      title={t('nav.settings')}
      onClose={onClose}
      widthClassName="w-[520px]"
      maxHeightClassName="max-h-[88vh]"
      bodyClassName="flex-1 overflow-y-auto px-5 py-4 space-y-6"
    >
          {/* ── Appearance ───────────────────────────────────────────────── */}
          <section>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-stone-500 mb-3">
              <Sun size={13} />
              {t('settings.appearance')}
            </div>
            <div className="flex gap-2">
              {THEME_OPTIONS.map(({ id, label }) => {
                const Icon = themeIcons[id];
                return (
                <button
                  key={id}
                  onClick={() => setTheme(id)}
                  className={`settings-choice-btn flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm border transition-all duration-150 focus:outline-none focus:ring-2 ${
                    theme === id
                      ? 'settings-choice-btn-active bg-jade-500/20 border-jade-500/50 text-jade-400 focus:ring-jade-500/35'
                      : 'settings-choice-btn-idle border-stone-700/60 text-stone-400 hover:border-stone-500 hover:text-stone-300 focus:ring-jade-700/25'
                  }`}
                >
                  <Icon size={14} />
                  {label}
                </button>
                );
              })}
            </div>
            <div className="mt-4 space-y-3">
              <div>
                <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-stone-500 mb-2">
                  <Type size={13} />
                  {t('settings.uiFont')}
                </label>
                <select
                  value={uiFontId}
                  onChange={(e) => setUIFontId(e.target.value as typeof uiFontId)}
                  className="w-full bg-stone-800/70 border border-stone-700/60 rounded-lg px-3 py-2 text-sm text-stone-200 outline-none focus:border-jade-500/60"
                >
                  {FONT_OPTIONS.map((font) => (
                    <option key={font.id} value={font.id}>{font.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-stone-500 mb-2">
                  <Type size={13} />
                  {t('settings.editorFont')}
                </label>
                <select
                  value={editorFontId}
                  onChange={(e) => setEditorFontId(e.target.value as typeof editorFontId)}
                  className="w-full bg-stone-800/70 border border-stone-700/60 rounded-lg px-3 py-2 text-sm text-stone-200 outline-none focus:border-jade-500/60"
                >
                  {FONT_OPTIONS.map((font) => (
                    <option key={font.id} value={font.id}>{font.label}</option>
                  ))}
                </select>
              </div>
            </div>
          </section>

          {/* ── Language ─────────────────────────────────────────────────── */}
          <section>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-stone-500 mb-3">
              <Globe size={13} />
              {t('settings.language')}
            </div>
            <div className="flex gap-2 flex-wrap">
              {LANGUAGE_OPTIONS.map(({ code, label }) => (
                <button
                  key={code}
                  onClick={() => changeAppLanguage(code)}
                  className={`settings-choice-btn px-3 py-1.5 rounded-lg text-sm border transition-all duration-150 focus:outline-none focus:ring-2 ${
                    i18n.language === code
                      ? 'settings-choice-btn-active bg-jade-500/20 border-jade-500/50 text-jade-400 focus:ring-jade-500/35'
                      : 'settings-choice-btn-idle border-stone-700/60 text-stone-400 hover:border-stone-500 hover:text-stone-300 focus:ring-jade-700/25'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </section>

          {/* ── Backup ───────────────────────────────────────────────────── */}
          <section>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-stone-500 mb-3">
              <Database size={13} />
              {t('settings.backup')}
            </div>

            {/* Export toggle */}
            <div className="mb-2">
              <button
                onClick={() => {
                  setPanel((p) => (p === 'export' ? 'none' : 'export'));
                  setExportDone(false);
                  setExportError(false);
                }}
                className="flex items-center justify-between w-full px-3 py-2 rounded-lg bg-stone-800/60 border border-stone-700/40 text-sm text-stone-300 hover:border-stone-500 hover:text-stone-200 transition-colors"
              >
                <span className="flex items-center gap-2">
                  <Download size={14} />
                  {t('settings.exportDb')}
                </span>
                {panel === 'export' ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>

              {panel === 'export' && (
                <div className="mt-2 rounded-lg bg-stone-800/40 border border-stone-700/30 px-3 py-3 space-y-3">
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
                      <Download size={13} />
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
              )}
            </div>

            {/* Import toggle */}
            <div>
              <button
                onClick={() => {
                  setPanel((p) => (p === 'import' ? 'none' : 'import'));
                  setImportDone(false);
                  setImportError('');
                  setImportedFile(null);
                }}
                className="flex items-center justify-between w-full px-3 py-2 rounded-lg bg-stone-800/60 border border-stone-700/40 text-sm text-stone-300 hover:border-stone-500 hover:text-stone-200 transition-colors"
              >
                <span className="flex items-center gap-2">
                  <Upload size={14} />
                  {t('settings.importDb')}
                </span>
                {panel === 'import' ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>

              {panel === 'import' && (
                <div className="mt-2 rounded-lg bg-stone-800/40 border border-stone-700/30 px-3 py-3 space-y-3">
                  {/* File picker — die Vorschau auf eigener Zeile: in der
                      Button-Zeile hatte sie jeden weiteren Nachbarn auf null
                      Breite gequetscht. */}
                  <div className="space-y-1.5">
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
                      {/* Modus als Choice-Karten (dieselben Klassen wie die
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
                          <button
                            key={mode}
                            type="button"
                            onClick={() => setImportMode(mode)}
                            className={`settings-choice-btn block w-full text-left px-3 py-2 rounded-lg border transition-all duration-150 focus:outline-none focus:ring-2 ${
                              importMode === mode
                                ? 'settings-choice-btn-active bg-jade-500/20 border-jade-500/50 focus:ring-jade-500/35'
                                : 'settings-choice-btn-idle border-stone-700/60 hover:border-stone-500 focus:ring-jade-700/25'
                            }`}
                          >
                            {/* Aktiv-Zustand nur ueber die Faerbung — wie bei
                                der Theme- und Sprachwahl oben, kein Haekchen. */}
                            <span className={`block text-xs font-medium ${
                              importMode === mode ? 'text-jade-400' : 'text-stone-300'
                            }`}>
                              {t(labelKey)}
                            </span>
                            <span className="block text-xs text-stone-500 mt-0.5">{t(descKey)}</span>
                          </button>
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
                          <AlertTriangle size={13} className="shrink-0 mt-0.5" />
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
                          <Upload size={13} />
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
                      <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                      <span className="min-w-0 break-words">{importError}</span>
                    </p>
                  )}
                </div>
              )}
            </div>
          </section>

          {/* ── Speicher ─────────────────────────────────────────────────── */}
          <section>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-stone-500 mb-3">
              <HardDrive size={13} />
              {t('settings.storage')}
            </div>

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
          </section>

          {/* ── About ────────────────────────────────────────────────────── */}
          <section>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-stone-500 mb-3">
              <Info size={13} />
              {t('settings.about')}
            </div>
            <div className="rounded-lg bg-stone-800/60 border border-stone-700/40 px-4 py-3 space-y-1.5">
              <div className="flex justify-between text-sm">
                <span className="text-stone-500">{t('settings.appName')}</span>
                <span className="text-stone-300">Emerald</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-stone-500">{t('settings.version')}</span>
                <span className="text-stone-300">{packageJson.version}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-stone-500">{t('settings.description')}</span>
                <span className="text-stone-400 text-right max-w-[260px]">{t('settings.descriptionValue')}</span>
              </div>
            </div>
          </section>
    </Modal>
  );

  return modal;
}
