import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle } from 'lucide-react';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import BlockCheckbox from '../../blocks/BlockCheckbox';
import { VaultLocationRow } from '../PickerRows';
import SettingsChoiceButton from '../settings/SettingsChoiceButton';
import { SettingsCheckboxGrid } from '../settings/SettingsSection';
import EntryCategoryChecks from '../settings/EntryCategoryChecks';
import { VAULT_KEY_CANCELLED } from '../../../store/vaultKeyStore';
import { keyErrorOf } from '../../../lib/vaultKeys';
import { NEW_VAULT_TARGET_ERROR_KEY, newVaultBaseDir, newVaultTarget, probeNewVaultTarget } from '../../../lib/vaultManager';
import {
  CONTENT_TYPES, allTypesIncluded, importDatabase,
  type ImportMode, type ImportTypeFilters, type OpenedVaultFile,
} from '../../../lib/dbBackup';
import { EmeraldNotice } from '../../../lib/emerald/file';
import { SETTINGS_GROUPS, type SettingsGroup } from '../../../lib/vaultSettings';
import { resolveOpenEdits } from '../../../lib/openEdits';
import { categoryLabel } from '../../../lib/categories';

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

/** The modes as choice cards — the one that touches nothing existing first, replacing last as the most destructive. */
const MODES: readonly [ImportMode, string, string][] = [
  ['add-vault', 'settings.modeAddVault', 'settings.modeAddVaultDesc'],
  ['merge', 'settings.modeMerge', 'settings.modeMergeDesc'],
  ['replace', 'settings.modeReplace', 'settings.modeReplaceDesc'],
];

export interface VaultImport {
  /** The choices, for the import window's body. */
  part: ReactNode;
  /** The mode chosen — the window's button turns red for `replace`. */
  mode: ImportMode;
  /** Whether the import can start — the new vault's folder is known. */
  ready: boolean;
  /**
   * Imports the file. `false`: nothing happened and the window stays (edits
   * kept open, the new vault's password cancelled, its folder not usable —
   * then `error` says why). Other failures throw.
   */
  run: () => Promise<boolean>;
  /** Why the last attempt did not start — shown by the window. */
  error: string;
}

/**
 * The import window's part for a vault's content or a raw backup (`file`, open;
 * `null` while the window holds another kind): as a new vault, merged, or
 * replacing everything. `advanced` adds which of the content comes along and,
 * when merging, which settings. Each file starts with the remembered mode
 * (`initialMode`); `onMode` tells the window a choice to remember.
 */
export function useVaultImport({ file, advanced, initialMode, onMode }: {
  file: OpenedVaultFile | null;
  advanced: boolean;
  initialMode: ImportMode;
  onMode: (mode: ImportMode) => void;
}): VaultImport {
  const { t } = useTranslation();
  const [mode, setMode] = useState<ImportMode>(initialMode);
  const [newVaultName, setNewVaultName] = useState(() => t('settings.importedVault'));
  // Target folder of the new vault — the same mechanism as in the vault picker:
  // `{Documents}/Emerald Vaults` as the base, a folder chosen by hand overrides it.
  const [vaultBaseDir, setVaultBaseDir] = useState<string | null>(null);
  const [vaultBaseResolved, setVaultBaseResolved] = useState(false);
  const [vaultCustomPath, setVaultCustomPath] = useState<string | null>(null);
  const [typeFilters, setTypeFilters] = useState<ImportTypeFilters>(allTypesIncluded);
  // When merging, without a choice everything stays as set in the vault.
  const [settingsGroups, setSettingsGroups] = useState<SettingsGroup[]>([]);
  const [error, setError] = useState('');

  // Every file starts afresh — but with the mode remembered.
  const ticket = file?.ticket;
  useEffect(() => {
    setMode(initialMode);
    setNewVaultName(t('settings.importedVault'));
    setVaultCustomPath(null);
    setTypeFilters(allTypesIncluded());
    setSettingsGroups([]);
    setError('');
    // Only a new file resets; the remembered mode is read at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticket]);

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

  const vaultName = newVaultName.trim() || t('settings.importedVault');

  async function run(): Promise<boolean> {
    if (!file) return false;
    // Replace and "New vault" close every tab — first settle what happens to
    // edits in progress. Merge leaves them open.
    if (mode !== 'merge' && !(await resolveOpenEdits())) return false;
    setError('');
    const vaultTarget = mode === 'add-vault' ? newVaultTarget(vaultBaseDir, vaultCustomPath, vaultName) : null;
    // The same check as when creating a vault — and before the import
    // touches anything: afterwards the new vault would already be in the
    // list while its folder can never come into being.
    if (vaultTarget) {
      const problem = await probeNewVaultTarget(vaultTarget);
      if (problem) {
        setError(t(NEW_VAULT_TARGET_ERROR_KEY[problem]));
        return false;
      }
    }
    try {
      await importDatabase(
        file,
        mode,
        mode === 'add-vault' ? { name: vaultName, path: vaultTarget ?? undefined } : undefined,
        // Normal brings everything; the choice of content is Advanced's.
        advanced ? typeFilters : allTypesIncluded(),
        mode === 'merge' && advanced ? settingsGroups : [],
      );
      return true;
    } catch (err) {
      // Cancelled at the new vault's password: not an error, just no import.
      if (keyErrorOf(err) === VAULT_KEY_CANCELLED) return false;
      throw err instanceof EmeraldNotice ? err : new EmeraldNotice(String(err));
    }
  }

  if (!file) return { part: null, mode, ready: false, run, error };
  const { preview } = file;

  const part = (
    <div className="space-y-4">
      {/* Which content — the same packing list as for the export: the entries
          by the categories the file holds entries of. */}
      {advanced && preview.entriesCount > 0 && (
        <EntryCategoryChecks
          categories={preview.categories
            .filter((c) => preview.entryCounts[c.id])
            .map((c) => ({ id: c.id, label: categoryLabel(t, c), emoji: c.emoji, count: preview.entryCounts[c.id] }))}
          selection={typeFilters}
          onChange={(selection) => setTypeFilters((f) => ({ ...f, ...selection }))}
          uncategorizedCount={preview.uncategorizedCount}
        />
      )}
      {advanced && (
        <SettingsCheckboxGrid label={t('settings.importInclude')}>
          {CONTENT_TYPES.map(([key, labelKey]) => (
            <BlockCheckbox
              key={key}
              checked={typeFilters[key]}
              onChange={() => setTypeFilters((f) => ({ ...f, [key]: !f[key] }))}
              label={t(labelKey)}
            />
          ))}
        </SettingsCheckboxGrid>
      )}

      <div className="space-y-1.5">
        <p className="label-xs mb-2">{t('settings.importMode')}</p>
        {MODES.map(([value, labelKey, descKey]) => (
          <SettingsChoiceButton
            key={value}
            active={mode === value}
            onClick={() => { setMode(value); onMode(value); setError(''); }}
            layout="card"
            className="block w-full text-left px-3 py-2"
          >
            <span className="block text-xs font-medium">{t(labelKey)}</span>
            <span className="block text-xs mt-0.5 text-muted">{t(descKey)}</span>
          </SettingsChoiceButton>
        ))}
      </div>

      {mode === 'add-vault' && (
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
              target={newVaultTarget(vaultBaseDir, vaultCustomPath, vaultName)}
              customPath={vaultCustomPath}
              onPickFolder={async () => {
                const picked = await openDialog({ directory: true, multiple: false });
                if (typeof picked !== 'string') return;
                setVaultCustomPath(picked);
                // Like `pickFolder` in the vault picker: the correction
                // takes the old error message away immediately.
                setError('');
              }}
              onResetFolder={() => setVaultCustomPath(null)}
            />
          </div>
        </div>
      )}

      {/* A choice only when merging: Replace and New vault take over the
          file's settings entirely. */}
      {advanced && mode === 'merge' && preview.hasSettings && (
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
      {mode === 'replace' && (
        <div className="flex items-start gap-2 text-xs rounded-lg border px-3 py-2 text-[var(--danger-text)] bg-[var(--danger-bg)] border-[var(--danger-border)]">
          <AlertTriangle size={12} className="shrink-0 mt-0.5" />
          <span className="min-w-0">
            {t('settings.modeReplaceWarning')}
            {preview.hasSettings && ` ${t('settings.modeReplaceSettingsWarning')}`}
          </span>
        </div>
      )}
    </div>
  );

  return { part, mode, ready: vaultBaseResolved, run, error };
}
