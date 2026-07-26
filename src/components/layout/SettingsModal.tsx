import { useState } from 'react';
import { Globe, Info, Database, Upload, Download, Check, AlertTriangle, ChevronDown, ChevronUp, Sun, Moon, Type } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Modal from '../ui/Modal';
import { useVaultStore } from '../../store/vaultStore';
import { useUIStore } from '../../store/uiStore';
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

  // ── Vault state ────────────────────────────────────────────────────────────
  const vaults = useVaultStore((s) => s.vaults);
  const activeVaultId = useVaultStore((s) => s.activeVaultId);
  const switchVault = useVaultStore((s) => s.switchVault);
  const renameVault = useVaultStore((s) => s.renameVault);
  const removeVault = useVaultStore((s) => s.removeVault);

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [switchingId, setSwitchingId] = useState<string | null>(null);

  // ── Backup panel state ─────────────────────────────────────────────────────
  const [panel, setPanel] = useState<'none' | 'export' | 'import'>('none');

  // Export
  const [exportOpts, setExportOpts] = useState<BackupOptions>(DEFAULT_EXPORT_OPTIONS);
  const [exporting, setExporting] = useState(false);
  const [exportDone, setExportDone] = useState(false);

  // Import
  const [importedFile, setImportedFile] = useState<{ backup: BackupFile; preview: BackupPreview } | null>(null);
  const [importMode, setImportMode] = useState<ImportMode>('merge');
  const [newVaultName, setNewVaultName] = useState('');
  const [importTypeFilters, setImportTypeFilters] = useState<ImportTypeFilters>({
    includeJournal: true, includeWiki: true, includeOperations: true,
    includeRoutines: true, includeAltars: true, includeTasks: true, includeTags: true,
  });
  const [excludedWikiCats] = useState<Set<string>>(new Set());
  const [excludedOpCats] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [importDone, setImportDone] = useState(false);
  const [importError, setImportError] = useState('');

  const themeIcons = {
    'emerald-noctis': Moon,
    'emerald-parchment': Sun,
  } as const;

  // ── Vault handlers ─────────────────────────────────────────────────────────
  async function handleSwitchVault(id: string) {
    setSwitchingId(id);
    try {
      await switchVault(id);
    } finally {
      setSwitchingId(null);
    }
  }

  function startRename(id: string, currentName: string) {
    setRenamingId(id);
    setRenameValue(currentName);
  }

  async function commitRename(id: string) {
    const name = renameValue.trim();
    if (name) await renameVault(id, name);
    setRenamingId(null);
  }

  // ── Export handler ─────────────────────────────────────────────────────────
  async function handleExport() {
    setExporting(true);
    setExportDone(false);
    try {
      await exportDatabase(exportOpts);
      setExportDone(true);
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
    try {
      await importDatabase(
        importedFile.backup,
        importMode,
        importMode === 'add-vault' ? (newVaultName.trim() || t('settings.importedVault')) : undefined,
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
              {([
                { code: 'en', label: 'English' },
                { code: 'de', label: 'Deutsch' },
                { code: 'es', label: 'Español' },
                { code: 'fr', label: 'Français' },
              ] as const).map(({ code, label }) => (
                <button
                  key={code}
                  onClick={() => i18n.changeLanguage(code)}
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

          {/* ── Vaults ───────────────────────────────────────────────────── */}
          <section>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-stone-500 mb-3">
              <Database size={13} />
              {t('settings.vaults')}
            </div>
            <div className="space-y-1.5">
              {vaults.map((v) => {
                const isActive = v.id === activeVaultId;
                const isSwitching = switchingId === v.id;
                const isRenaming = renamingId === v.id;
                return (
                  <div
                    key={v.id}
                    className={`settings-vault-row flex items-center gap-2 rounded-lg px-3 py-2 border transition-colors ${
                      isActive
                        ? 'settings-vault-row-active bg-jade-500/10 border-jade-500/30'
                        : 'settings-vault-row-idle bg-stone-800/40 border-stone-700/40'
                    }`}
                  >
                    {isRenaming ? (
                      <input
                        autoFocus
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitRename(v.id);
                          if (e.key === 'Escape') setRenamingId(null);
                        }}
                        onBlur={() => commitRename(v.id)}
                        className="flex-1 bg-stone-800 border border-stone-700/60 rounded px-2 py-1 text-sm text-stone-200 outline-none focus:border-jade-500/60"
                      />
                    ) : (
                      <span className={`settings-vault-name flex-1 text-sm truncate ${isActive ? 'text-jade-300' : 'text-stone-300'}`}>
                        {v.name}
                      </span>
                    )}
                    {isActive && (
                      <span className="settings-vault-active text-xs text-jade-500 shrink-0">{t('settings.vaultActive')}</span>
                    )}
                    {!isRenaming && (
                      <button
                        onClick={() => startRename(v.id, v.name)}
                        className="settings-vault-action text-xs text-stone-500 hover:text-stone-300 transition-colors shrink-0"
                      >
                        {t('settings.vaultRename')}
                      </button>
                    )}
                    {!isActive && !isSwitching && !isRenaming && (
                      <button
                        onClick={() => handleSwitchVault(v.id)}
                        className="text-xs text-stone-400 hover:text-jade-400 transition-colors shrink-0"
                      >
                        {t('settings.vaultSwitch')}
                      </button>
                    )}
                    {isSwitching && (
                      <span className="text-xs text-stone-500 shrink-0">{t('settings.vaultSwitching')}</span>
                    )}
                    {!isActive && vaults.length > 1 && !isRenaming && (
                      <button
                        onClick={() => removeVault(v.id)}
                        className="text-xs text-stone-600 hover:text-red-400 transition-colors shrink-0"
                      >
                        {t('settings.vaultDelete')}
                      </button>
                    )}
                  </div>
                );
              })}
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
                  {/* Type checkboxes */}
                  <div>
                    <p className="text-xs text-stone-500 mb-2">{t('settings.exportInclude')}</p>
                    <div className="flex flex-wrap gap-2">
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
                        <label key={key} className="flex items-center gap-1.5 cursor-pointer group">
                          <div
                            onClick={() => toggleExportOpt(key)}
                            className={`w-4 h-4 rounded border flex items-center justify-center transition-colors cursor-pointer ${
                              exportOpts[key]
                                ? 'bg-jade-500/30 border-jade-500/60'
                                : 'border-stone-600 hover:border-stone-400'
                            }`}
                          >
                            {exportOpts[key] && <Check size={10} className="text-jade-400" />}
                          </div>
                          <span className="text-xs text-stone-400 group-hover:text-stone-300 transition-colors">
                            {t(labelKey)}
                          </span>
                        </label>
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
                    <button
                      onClick={handleExport}
                      disabled={exporting}
                      className="settings-cta-btn flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-jade-500/20 border border-jade-500/40 text-jade-400 text-xs hover:bg-jade-500/30 transition-colors disabled:opacity-50"
                    >
                      <Download size={13} />
                      {exporting ? t('settings.exporting') : t('settings.exportBtn')}
                    </button>
                    {exportDone && (
                      <span className="text-xs text-jade-400 flex items-center gap-1">
                        <Check size={12} /> {t('settings.exportDone')}
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
                  {/* File picker */}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleBrowse}
                      className="px-3 py-1.5 rounded-lg border border-stone-600 text-xs text-stone-400 hover:border-stone-400 hover:text-stone-300 transition-colors"
                    >
                      {t('settings.importBrowse')}
                    </button>
                    {importedFile && (
                      <span className="text-xs text-stone-400 truncate">
                        {t('settings.previewContains')} {[
                          importedFile.preview.journalCount && `${importedFile.preview.journalCount} J`,
                          importedFile.preview.wikiCount && `${importedFile.preview.wikiCount} W`,
                          importedFile.preview.opsCount && `${importedFile.preview.opsCount} O`,
                          importedFile.preview.routinesCount && `${importedFile.preview.routinesCount} R`,
                          importedFile.preview.altarsCount && `${importedFile.preview.altarsCount} A`,
                          importedFile.preview.taskCount && `${importedFile.preview.taskCount} T`,
                        ].filter(Boolean).join(', ')}
                      </span>
                    )}
                    {importError && (
                      <span className="text-xs text-red-400 flex items-center gap-1">
                        <AlertTriangle size={12} /> {importError}
                      </span>
                    )}
                  </div>

                  {/* Type filters */}
                  {importedFile && (
                    <div>
                      <p className="text-xs text-stone-500 mb-2">{t('settings.importInclude')}</p>
                      <div className="flex flex-wrap gap-2">
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
                          <label key={key} className="flex items-center gap-1.5 cursor-pointer group">
                            <div
                              onClick={() => setImportTypeFilters((f) => ({ ...f, [key]: !f[key] }))}
                              className={`w-4 h-4 rounded border flex items-center justify-center transition-colors cursor-pointer ${
                                importTypeFilters[key]
                                  ? 'bg-jade-500/30 border-jade-500/60'
                                  : 'border-stone-600 hover:border-stone-400'
                              }`}
                            >
                              {importTypeFilters[key] && <Check size={10} className="text-jade-400" />}
                            </div>
                            <span className="text-xs text-stone-400 group-hover:text-stone-300 transition-colors">
                              {t(labelKey)}
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Import mode radio */}
                  {importedFile && (
                    <>
                      <div className="space-y-1.5">
                        <p className="text-xs text-stone-500">{t('settings.importMode')}</p>
                        {(
                          [
                            ['merge', 'settings.modeMerge', 'settings.modeMergeDesc'],
                            ['replace', 'settings.modeReplace', 'settings.modeReplaceDesc'],
                            ['add-vault', 'settings.modeAddVault', 'settings.modeAddVaultDesc'],
                          ] as [ImportMode, string, string][]
                        ).map(([mode, labelKey, descKey]) => (
                          <label key={mode} className="flex items-start gap-2 cursor-pointer group">
                            <div
                              onClick={() => setImportMode(mode)}
                              className={`mt-0.5 w-4 h-4 rounded-full border flex items-center justify-center shrink-0 transition-colors cursor-pointer ${
                                importMode === mode
                                  ? 'border-jade-500/60 bg-jade-500/30'
                                  : 'border-stone-600 hover:border-stone-400'
                              }`}
                            >
                              {importMode === mode && <div className="w-2 h-2 rounded-full bg-jade-400" />}
                            </div>
                            <div>
                              <span className="text-xs text-stone-300">{t(labelKey)}</span>
                              <p className="text-xs text-stone-500 mt-0.5">{t(descKey)}</p>
                            </div>
                          </label>
                        ))}
                      </div>

                      {/* New vault name input */}
                      {importMode === 'add-vault' && (
                        <div>
                          <label className="text-xs text-stone-500 block mb-1">{t('settings.newVaultName')}</label>
                          <input
                            type="text"
                            value={newVaultName}
                            onChange={(e) => setNewVaultName(e.target.value)}
                            placeholder={t('settings.vaultNamePlaceholder')}
                            className="w-full bg-stone-800 border border-stone-700/60 rounded px-2 py-1 text-xs text-stone-300 outline-none focus:border-jade-500/60"
                          />
                        </div>
                      )}

                      {/* Replace warning */}
                      {importMode === 'replace' && (
                        <div className="flex items-center gap-2 text-xs text-amber-400">
                          <AlertTriangle size={13} />
                          {t('settings.modeReplaceWarning')}
                        </div>
                      )}

                      {/* Import button */}
                      <div className="flex items-center gap-2">
                        <button
                          onClick={handleImport}
                          disabled={importing}
                          className="settings-cta-btn flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-jade-500/20 border border-jade-500/40 text-jade-400 text-xs hover:bg-jade-500/30 transition-colors disabled:opacity-50"
                        >
                          <Upload size={13} />
                          {importing ? t('settings.importing') : t('settings.importBtn')}
                        </button>
                        {importDone && (
                          <span className="text-xs text-jade-400 flex items-center gap-1">
                            <Check size={12} /> {t('settings.importDone')}
                          </span>
                        )}
                      </div>
                    </>
                  )}
                </div>
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
