import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FileUp, Loader2, Upload } from 'lucide-react';
import { message } from '@tauri-apps/plugin-dialog';
import Modal from '../../ui/Modal';
import Button from '../../ui/Button';
import SegmentedControl from '../../ui/SegmentedControl';
import FieldDropdown from '../../ui/FieldDropdown';
import { SettingsStatus } from '../settings/SettingsSection';
import { Checklist, Part } from '../menuParts';
import { useVaultImport } from './useVaultImport';
import { useImportWindowStore } from '../../../store/importWindowStore';
import { useBackupSecretStore } from '../../../store/backupSecretStore';
import { useFileDrop } from '../../../hooks/useFileDrop';
import { useDashboardStore } from '../../../store/dashboardStore';
import { useCategoryStore } from '../../../store/categoryStore';
import { useVaultStore } from '../../../store/vaultStore';
import { categoryLabel } from '../../../lib/categories';
import { dashboardLabel } from '../../../lib/dashboards';
import { displayTitle } from '../../../lib/entryTitle';
import { formatEntryDate } from '../../../lib/formatDate';
import { EmeraldNotice } from '../../../lib/emerald/file';
import { isImportPath } from '../../../lib/importPaths';
import { plausibleEmoji } from '../../../lib/icons';
import {
  closeImportSource, fileNameOf, loadImportPrefs, openImportFile, pickImportFile, saveImportPrefs, targetOf, targetValue,
  type ImportPrefs, type ImportSource,
} from '../../../lib/importFile';
import type { ImportTarget } from '../../../lib/emeraldFormat';
import type { ManifestItem } from '../../../lib/emerald/manifest';

/**
 * The import window, the export menu's counterpart: a file dragged in or
 * chosen — Emerald (`.emerald`, `.vault.emerald`) or Markdown — what it is,
 * and how it comes in: under "Normal" with the few choices it needs, under
 * "Advanced" with all of them. Opened by the title bar's Import and by files
 * dragged into the app window (`useImportDrop`); the imports themselves are
 * `lib/emeraldFormat.ts` and `lib/dbBackup.ts`.
 */
export default function ImportModal() {
  const open = useImportWindowStore((s) => s.open);
  if (!open) return null;
  return <ImportBody />;
}

/** One line of what the file is. */
function Fact({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-subtle">{label}</dt>
      <dd className="text-soft min-w-0 truncate">{value}</dd>
    </>
  );
}

function ImportBody() {
  const { t } = useTranslation();
  const close = useImportWindowStore((s) => s.close);
  const dropped = useImportWindowStore((s) => s.dropped);
  const dashboards = useDashboardStore((s) => s.dashboards);
  const categories = useCategoryStore((s) => s.categories);
  const vaultId = useVaultStore((s) => s.activeVaultId);

  // Remembered under the vault the window opened in: an import as a new vault switches vaults beneath it.
  const [prefsVault] = useState(vaultId);
  const [prefs, setPrefs] = useState<ImportPrefs>(() => loadImportPrefs(prefsVault));
  useEffect(() => { saveImportPrefs(prefs, prefsVault); }, [prefs, prefsVault]);
  const update = (patch: Partial<ImportPrefs>) => setPrefs((p) => ({ ...p, ...patch }));
  const advanced = prefs.level === 'advanced';

  const [source, setSource] = useState<ImportSource | null>(null);
  const [opening, setOpening] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  // Unticked items, for this file only.
  const [excluded, setExcluded] = useState<Set<string>>(new Set());

  // The file open now, for letting go of it — when another comes, and when the window goes.
  const sourceRef = useRef<ImportSource | null>(null);
  const replaceSource = (next: ImportSource | null) => {
    if (sourceRef.current && sourceRef.current !== next) closeImportSource(sourceRef.current);
    sourceRef.current = next;
    setSource(next);
    setExcluded(new Set());
  };
  // Deferred: mounted again at once (React's development double run), the window keeps it.
  const closeTimer = useRef<number | undefined>(undefined);
  useEffect(() => {
    window.clearTimeout(closeTimer.current);
    return () => {
      closeTimer.current = window.setTimeout(() => {
        // An opening still under way counts as stale: its file is let go when it arrives.
        openSeq.current += 1;
        if (sourceRef.current) closeImportSource(sourceRef.current);
        sourceRef.current = null;
      }, 0);
    };
  }, []);

  // One opening at a time: a second one would take over the password question
  // of the first, and the first, ending, would close it under the second.
  const openSeq = useRef(0);
  const openingRef = useRef(false);
  // A drop that came while a file was opening (see below) — it ends that opening.
  const queuedDropRef = useRef<string[] | null>(null);
  /** Opens a file; whether it is now the window's. */
  async function openPath(path: string): Promise<boolean> {
    if (busy || openingRef.current) return false;
    openingRef.current = true;
    const seq = ++openSeq.current;
    setError('');
    setNote('');
    setOpening(true);
    try {
      const next = await openImportFile(path, () => queuedDropRef.current !== null);
      if (seq !== openSeq.current) {
        if (next) closeImportSource(next);
        return false;
      }
      // Cancelled at the password: the file there was stays.
      if (next) replaceSource(next);
      return !!next;
    } catch (err) {
      // Overtaken by a drop: Rust now lets only that file be read, so this one may fail — no error for it.
      if (seq !== openSeq.current || queuedDropRef.current) return false;
      setError(err instanceof EmeraldNotice ? err.message : `${t('emeraldImport.readFailed', { error: String(err) })}`);
      return false;
    } finally {
      openingRef.current = false;
      if (seq === openSeq.current) setOpening(false);
    }
  }

  async function choose() {
    if (busy || opening) return;
    const path = await pickImportFile(t('importWindow.fileFilter'));
    if (path) await openPath(path);
  }

  // Files dropped onto the app window: the first one the window takes; the window says when there is none.
  function openDropped(paths: string[]) {
    const files = paths.filter(isImportPath);
    if (files.length === 0) {
      setError(t('importWindow.notImportable'));
      return;
    }
    void openPath(files[0]).then((opened) => {
      if (opened && paths.length > 1) setNote(t('importWindow.oneAtATime', { name: fileNameOf(files[0]) }));
    });
  }
  // A drop while a file is still opening: the newest choice wins, as in Rust,
  // which from now on lets only the dropped file be read outside the user's
  // folders (`chosen_file.rs`). The opening's password question is cancelled
  // — and not asked again, should an answer be under check right now — and the
  // drop opens once the opening has ended. The ref is what the opening asks at
  // the moment; the state re-runs the effect below once `opening` turns false.
  const [queuedDrop, setQueuedDrop] = useState<string[] | null>(null);
  const handled = useRef(0);
  useEffect(() => {
    if (!dropped || dropped.seq === handled.current) return;
    handled.current = dropped.seq;
    if (busy) return;
    if (openingRef.current) {
      if (dropped.paths.some(isImportPath)) {
        queuedDropRef.current = dropped.paths;
        setQueuedDrop(dropped.paths);
        useBackupSecretStore.getState().cancel();
      }
      return;
    }
    openDropped(dropped.paths);
    // `openPath` reads the state of the moment; only a new drop counts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dropped]);
  useEffect(() => {
    if (!queuedDrop || opening) return;
    queuedDropRef.current = null;
    setQueuedDrop(null);
    openDropped(queuedDrop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queuedDrop, opening]);
  // Only for the look of the zone: the drop itself comes through the store.
  const { dragOver } = useFileDrop(!busy, () => {});

  // ── Targets for entries without a category ──
  const live = useMemo(() => ({
    dashboards: new Set(dashboards.map((d) => d.id)),
    categories: new Set(categories.map((c) => c.id)),
  }), [dashboards, categories]);
  const target = targetOf(prefs.target, live);
  // Normal offers Markdown dashboards only: any other destination is "All entries" there.
  const markdownTarget: ImportTarget = advanced || target.kind === 'dashboard' ? target : { kind: 'dashboard', id: 'all' };
  const dashboardOptions = dashboards.map((d) => ({ value: `dashboard:${d.id}`, label: t('importWindow.target.dashboard', { name: dashboardLabel(t, d) }) }));
  const categoryOptions = categories.map((c) => ({ value: `category:${c.id}`, label: categoryLabel(t, c), emoji: c.emoji }));
  const noneOption = { value: 'none', label: t('importWindow.target.none') };

  // ── The vault part, held for every kind (hooks), live only for a vault's content ──
  const vaultFile = source && (source.kind === 'vault' || source.kind === 'raw') ? source.file : null;
  const vault = useVaultImport({
    file: vaultFile,
    advanced,
    initialMode: prefs.vaultMode,
    onMode: (mode) => { if (mode !== 'replace') update({ vaultMode: mode }); },
  });

  // ── Entries and templates ──
  const items: readonly ManifestItem[] = source?.kind === 'items' ? source.manifest.items : [];
  const existing = source?.kind === 'items' ? source.existing : new Map<string, string>();
  const chosen = items.filter((item) => !advanced || !excluded.has(item.id));
  const skipExisting = advanced && prefs.existing === 'skip';
  const toImport = skipExisting ? chosen.filter((item) => !existing.has(item.id)) : chosen;
  const chosenExisting = chosen.filter((item) => existing.has(item.id)).length;
  const needsTarget = chosen.some((item) => item.kind === 'entry' && !item.category);
  const toggle = (id: string) => setExcluded((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  /** What the file is: its kind, how much is in it, whether it is protected. */
  function facts(src: ImportSource): { kind: string; contains: string; protectedText: string; date?: string } {
    const yesNo = (v: boolean) => t(v ? 'importWindow.yes' : 'importWindow.no');
    if (src.kind === 'markdown') {
      return { kind: t('importWindow.kind.markdown'), contains: t('importWindow.contains.entries', { count: 1 }), protectedText: yesNo(false) };
    }
    if (src.kind === 'items') {
      const entries = src.manifest.items.filter((i) => i.kind === 'entry').length;
      const templates = src.manifest.items.length - entries;
      const kind = templates === 0 ? (entries === 1 ? 'entry' : 'entries')
        : entries === 0 ? (templates === 1 ? 'template' : 'templates')
        : 'items';
      return {
        kind: t(`importWindow.kind.${kind}`),
        contains: [
          entries > 0 && t('importWindow.contains.entries', { count: entries }),
          templates > 0 && t('importWindow.contains.templates', { count: templates }),
        ].filter(Boolean).join(', '),
        protectedText: yesNo(src.opened.protected),
        date: src.manifest.exportedAt || undefined,
      };
    }
    const { preview } = src.file;
    return {
      kind: t(`importWindow.kind.${src.kind}`),
      contains: [
        preview.entriesCount > 0 && t('importWindow.contains.entries', { count: preview.entriesCount }),
        preview.templatesCount > 0 && t('importWindow.contains.templates', { count: preview.templatesCount }),
        preview.taskCount > 0 && `${preview.taskCount} ${t('settings.previewTasks')}`,
        preview.languagesCount > 0 && `${preview.languagesCount} ${t('settings.previewLanguages')}`,
      ].filter(Boolean).join(', ') || t('importWindow.contains.nothing'),
      protectedText: yesNo(src.protected),
      date: preview.exportedAt || undefined,
    };
  }

  const canImport = !busy && !opening && !!source && (
    source.kind === 'markdown' ? true
      : source.kind === 'items' ? toImport.length > 0
      : vault.ready
  );

  async function handleImport() {
    if (!canImport || !source) return;
    setBusy(true);
    setError('');
    try {
      if (source.kind === 'markdown') {
        const { importMarkdown } = await import('../../../lib/emeraldFormat');
        await importMarkdown(source.markdown, markdownTarget);
        close();
        await message(t('emeraldImport.markdownDone'), { title: t('emeraldImport.title'), kind: 'info' });
        return;
      }
      if (source.kind === 'items') {
        const { importItems, showImportedItems } = await import('../../../lib/emeraldFormat');
        const itemTarget: ImportTarget = advanced ? target : { kind: 'none' };
        const result = await importItems(source.opened, source.manifest, {
          only: advanced ? new Set(chosen.map((item) => item.id)) : undefined,
          target: itemTarget,
          skip: skipExisting ? existing : undefined,
        });
        close();
        await showImportedItems(result, itemTarget);
        return;
      }
      if (await vault.run()) close();
      else setBusy(false);
    } catch (err) {
      // A failed import may have stored some of the file's pictures already:
      // another attempt starts with opening the file again.
      replaceSource(null);
      setBusy(false);
      setError(err instanceof EmeraldNotice ? err.message : `${t('emeraldImport.failed')}\n${String(err)}`);
    }
  }

  // ── The parts ──
  const info = source && facts(source);
  const filePart = source && info ? (
    <div className="rounded-md border border-edge px-3 py-2.5 space-y-2">
      <div className="flex items-center gap-2">
        <FileUp size={14} className="shrink-0 text-subtle" />
        <span className="text-sm text-soft truncate flex-1 min-w-0" title={source.path}>{fileNameOf(source.path)}</span>
        <Button tone="neutral" small onClick={() => void choose()} disabled={busy || opening}>{t('importWindow.otherFile')}</Button>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
        <Fact label={t('importWindow.kind.label')} value={info.kind} />
        <Fact label={t('importWindow.contains.label')} value={info.contains} />
        {info.date && <Fact label={t('importWindow.date')} value={formatEntryDate(info.date)} />}
        {source.kind !== 'markdown' && <Fact label={t('importWindow.protected')} value={info.protectedText} />}
      </dl>
    </div>
  ) : (
    <button
      type="button"
      onClick={() => void choose()}
      disabled={opening}
      className={`file-drop-zone${dragOver ? ' file-drop-zone--over' : ''}`}
    >
      {opening ? <Loader2 size={22} className="animate-spin" /> : <Upload size={22} />}
      <span>{opening ? t('importWindow.opening') : t('importWindow.dropHere')}</span>
      {!opening && <span className="text-xs">{t('importWindow.dropHint')}</span>}
    </button>
  );

  const itemLabel = (item: ManifestItem): string => {
    const here = existing.has(item.id) ? ` · ${t('importWindow.exists')}` : '';
    if (item.kind === 'template') return `${item.name || t('templates.untitled')} · ${t('importWindow.kind.template')}${here}`;
    const meta = [item.createdAt ? formatEntryDate(item.createdAt) : null, item.category?.name ?? null].filter(Boolean).join(' · ');
    const icon = item.category ? plausibleEmoji(item.category.icon) : '';
    const emoji = icon ? `${icon} ` : '';
    return `${emoji}${displayTitle(t, 'entry', item.title)}${meta ? ` · ${meta}` : ''}${here}`;
  };

  const itemsPart = source?.kind === 'items' && (
    <>
      {advanced && items.length > 1 && (
        <Part title={t('importWindow.items', { count: items.length })}>
          <Checklist rows={items.map((item) => ({ id: item.id, label: itemLabel(item) }))} excluded={excluded} onToggle={toggle} />
        </Part>
      )}
      {advanced && needsTarget && (
        <Part title={t('importWindow.target.label')} hint={t('importWindow.target.hint')}>
          <FieldDropdown
            value={targetValue(target)}
            options={[noneOption, ...dashboardOptions, ...categoryOptions]}
            onChange={(value) => update({ target: value })}
            ariaLabel={t('importWindow.target.label')}
          />
        </Part>
      )}
      {chosenExisting > 0 && (advanced ? (
        <Part
          title={t('importWindow.existing.label')}
          hint={skipExisting && toImport.length === 0 && chosen.length > 0
            ? t('importWindow.existing.allSkipped')
            : t('importWindow.existing.count', { count: chosenExisting })}
        >
          <SegmentedControl className="w-fit"
            options={(['copy', 'skip'] as const).map((value) => ({ value, label: t(`importWindow.existing.${value}`) }))}
            value={prefs.existing}
            onChange={(value) => update({ existing: value })}
            ariaLabel={t('importWindow.existing.label')}
          />
        </Part>
      ) : (
        <p className="text-xs text-subtle leading-snug">
          {t('importWindow.existing.count', { count: chosenExisting })} {t('importWindow.existing.normalHint')}
        </p>
      ))}
    </>
  );

  const markdownPart = source?.kind === 'markdown' && (
    source.markdown.categoryName ? (
      <p className="text-xs text-subtle leading-snug">{t('importWindow.markdown.ownCategory', { name: source.markdown.categoryName })}</p>
    ) : advanced ? (
      <Part title={t('importWindow.markdown.target')} hint={t('importWindow.target.hint')}>
        <FieldDropdown
          value={targetValue(target)}
          options={[noneOption, ...dashboardOptions, ...categoryOptions]}
          onChange={(value) => update({ target: value })}
          ariaLabel={t('importWindow.markdown.target')}
        />
      </Part>
    ) : (
      <Part title={t('importWindow.markdown.dashboard')} hint={t('importWindow.markdown.hint')}>
        <FieldDropdown
          value={targetValue(markdownTarget)}
          options={dashboards.map((d) => ({ value: `dashboard:${d.id}`, label: dashboardLabel(t, d) }))}
          onChange={(value) => update({ target: value })}
          ariaLabel={t('importWindow.markdown.dashboard')}
        />
      </Part>
    )
  );

  const summary = !source ? ''
    : source.kind === 'items' ? t('importWindow.total', { count: toImport.length })
    : source.kind === 'markdown' ? t('importWindow.total', { count: 1 })
    : t('exportMenu.wholeVault');

  return (
    <Modal
      title={t('importWindow.title')}
      onClose={close}
      dismissible={!busy}
      widthClassName="w-[600px] max-w-full"
      maxHeightClassName="max-h-[88vh]"
      bodyClassName="modal-body flex-1 overflow-y-auto"
      footer={(
        <div className="flex items-center gap-2 w-full">
          <span className="text-xs text-subtle mr-auto">{summary}</span>
          <Button onClick={close} variant="secondary" disabled={busy}>{t('common.cancel')}</Button>
          {/* Red while replacing: the import then deletes what is there (design.md). */}
          <Button onClick={() => void handleImport()} variant={vaultFile && vault.mode === 'replace' ? 'primaryDanger' : 'primary'} disabled={!canImport}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
            {busy ? t('importWindow.importing') : t('importWindow.import')}
          </Button>
        </div>
      )}
    >
      <div className="space-y-5">
        <div className="flex items-center">
          <SegmentedControl
            className="ml-auto w-fit"
            options={(['normal', 'advanced'] as const).map((value) => ({ value, label: t(`exportMenu.level.${value}`) }))}
            value={prefs.level}
            onChange={(level) => update({ level })}
            ariaLabel={t('exportMenu.level.label')}
          />
        </div>
        {filePart}
        {note && <p className="text-xs text-subtle">{note}</p>}
        {itemsPart}
        {markdownPart}
        {vaultFile && vault.part}
        {(error || vault.error) && <SettingsStatus tone="error">{error || vault.error}</SettingsStatus>}
      </div>
    </Modal>
  );
}
