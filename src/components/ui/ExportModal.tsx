import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { message } from '@tauri-apps/plugin-dialog';
import { format as formatDate, isValid, parseISO, subDays, startOfMonth } from 'date-fns';
import { Check, FileText, Gem, Globe, Hash, Loader2 } from 'lucide-react';
import { useExportStore, type ExportFormat } from '../../store/exportStore';
import {
  collectExportDataFor, collectLinkedTargets, collectTargetsInRange, describeTarget,
  type ExportData, type ExportEntryType, type ExportTarget,
} from '../../lib/exportData';
import { exportAsMarkdown, exportAsPDF, exportErrorMessage, type ExportOptions } from '../../lib/export';
import { exportAsHTML, type HtmlExportLabels } from '../../lib/htmlExport';
import { exportAsEmerald } from '../../lib/emeraldFormat';
import { OP_PROP_SELECT_CLASSES } from '../../lib/styleClasses';
import Modal from './Modal';
import Button from './Button';

const FORMATS: { id: ExportFormat; icon: React.ReactNode; ext: string }[] = [
  { id: 'pdf',      icon: <FileText size={16} />, ext: '.pdf' },
  { id: 'html',     icon: <Globe size={16} />,    ext: '.html' },
  { id: 'markdown', icon: <Hash size={16} />,     ext: '.md' },
  { id: 'emerald',  icon: <Gem size={16} />,      ext: '.emerald' },
];

const IMAGE_OPTIONS: ExportOptions['images'][] = ['none', 'balanced', 'strong', 'placeholder'];
const AUDIO_OPTIONS: ExportOptions['audio'][] = ['embed', 'placeholder'];

const MODULES: ExportEntryType[] = ['journal', 'operations', 'wiki'];
/** File-name words per module — fixed ASCII, whatever the UI language. */
const MODULE_FILE_NAMES: Record<ExportEntryType, string> = { journal: 'Journal', operations: 'Operations', wiki: 'Wiki' };
/** From this many entries on, a PDF gets a hint that HTML handles large bundles better. */
const LARGE_PDF = 25;

type Period = 'last7' | 'last30' | 'thisMonth' | 'all' | 'custom';
const PERIODS: Period[] = ['last7', 'last30', 'thisMonth', 'all', 'custom'];

const TYPE_LABEL_KEYS: Record<ExportTarget['type'], string> = {
  journal: 'linkPicker.tabJournal',
  wiki: 'linkPicker.tabWiki',
  operations: 'linkPicker.tabOperations',
};

const PREFS_KEY = 'export-modal-prefs';
const DAY = 'yyyy-MM-dd';

interface Prefs {
  format: ExportFormat;
  includeLinked: boolean;
  recursive: boolean;
  images: ExportOptions['images'];
  audio: ExportOptions['audio'];
  bulkModules: ExportEntryType[];
  bulkPeriod: Period;
  /** Custom period, as yyyy-MM-dd. */
  bulkFrom: string;
  bulkTo: string;
}

function loadPrefs(): Prefs {
  const today = new Date();
  const fallback: Prefs = {
    format: 'pdf', includeLinked: false, recursive: false, images: 'balanced', audio: 'embed',
    bulkModules: ['journal'], bulkPeriod: 'last7',
    bulkFrom: formatDate(subDays(today, 6), DAY), bulkTo: formatDate(today, DAY),
  };
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return fallback;
    const stored = JSON.parse(raw);
    // Saved before images could be replaced by placeholders, as `compression`.
    if (stored.compression && !stored.images) stored.images = stored.compression;
    delete stored.compression;
    return { ...fallback, ...stored };
  } catch {
    return fallback;
  }
}

function savePrefs(prefs: Prefs) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* ignore */ }
}

/**
 * The days a period covers; `null` ends are unbounded. `invalid` when a
 * custom date can't be read — half typed, or a text field where the webview
 * has no date picker (WebKitGTK). A custom range given backwards is swapped.
 */
function periodRange(period: Period, fromText: string, toText: string): { from: Date | null; to: Date | null; invalid: boolean } {
  const today = new Date();
  switch (period) {
    case 'last7': return { from: subDays(today, 6), to: today, invalid: false };
    case 'last30': return { from: subDays(today, 29), to: today, invalid: false };
    case 'thisMonth': return { from: startOfMonth(today), to: today, invalid: false };
    case 'all': return { from: null, to: null, invalid: false };
    case 'custom': {
      const parse = (s: string): Date | null | undefined => {
        if (!s) return null;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return undefined;
        const d = parseISO(s);
        return isValid(d) && d.getFullYear() >= 1000 ? d : undefined;
      };
      const from = parse(fromText), to = parse(toText);
      if (from === undefined || to === undefined) return { from: null, to: null, invalid: true };
      if (from && to && from > to) return { from: to, to: from, invalid: false };
      return { from, to, invalid: false };
    }
  }
}

const targetKey = (t: ExportTarget) => `${t.type}:${t.id}`;

function TargetIcon({ icon }: { icon: string }) {
  return icon.startsWith('data:')
    ? <img src={icon} alt="" className="w-4 h-4 rounded object-cover shrink-0" />
    : <span className="w-4 text-center shrink-0 leading-none">{icon}</span>;
}

function Checkbox({ checked, disabled }: { checked: boolean; disabled?: boolean }) {
  return (
    <div
      className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${
        checked ? 'bg-jade-500/30 border-jade-500/60' : 'border-stone-600'
      } ${disabled ? 'opacity-40' : ''}`}
    >
      {checked && <Check size={10} className="text-jade-400" />}
    </div>
  );
}

function Segmented<T extends string>({ options, value, onChange, label }: {
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
  label: (value: T) => string;
}) {
  return (
    <div className="flex flex-wrap gap-1 p-0.5 rounded-lg border w-fit" style={{ borderColor: 'var(--border-soft)' }}>
      {options.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          className={`export-segment${value === option ? ' export-segment-active' : ''}`}
        >
          {label(option)}
        </button>
      ))}
    </div>
  );
}

/** A checkable list of entries, used for linked entries and for a bulk selection. */
function EntryList({ targets, excluded, onToggle, showDate }: {
  targets: ExportTarget[];
  excluded: Set<string>;
  onToggle: (key: string) => void;
  showDate?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="rounded-lg border max-h-48 overflow-y-auto py-1" style={{ borderColor: 'var(--border-soft)' }}>
      {targets.map((target) => {
        const key = targetKey(target);
        const info = describeTarget(target);
        const checked = !excluded.has(key);
        return (
          <button
            key={key}
            type="button"
            onClick={() => onToggle(key)}
            className="context-menu-item-default w-full flex items-center gap-2.5 px-3 py-1.5 text-left hover:bg-stone-700/30 transition-colors"
          >
            <Checkbox checked={checked} />
            <TargetIcon icon={info.icon} />
            <span className={`text-xs truncate ${checked ? 'text-stone-300' : 'text-stone-500'}`}>{info.title}</span>
            <span className="ml-auto text-[10px] text-stone-500 shrink-0">
              {showDate && info.createdAt ? `${formatDate(new Date(info.createdAt), 'dd.MM.yyyy')} · ` : ''}
              {t(TYPE_LABEL_KEYS[target.type])}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export default function ExportModal() {
  const request = useExportStore((s) => s.request);
  if (!request) return null;
  // Remount per request so the state below starts fresh for each export —
  // also when a menu item is picked while the modal is already open.
  return (
    <ExportModalBody
      key={request.seq}
      target={request.kind === 'entry' ? request.target : null}
      initialFormat={request.format}
    />
  );
}

/** `target` is the entry to export, or `null` for a bulk export. */
function ExportModalBody({ target, initialFormat }: { target: ExportTarget | null; initialFormat?: ExportFormat }) {
  const { t, i18n } = useTranslation();
  const close = useExportStore((s) => s.close);
  const busy = useExportStore((s) => s.busy);
  const setBusy = useExportStore((s) => s.setBusy);
  const bulk = target === null;

  const [prefs, setPrefs] = useState<Prefs>(() => {
    const p = loadPrefs();
    return initialFormat ? { ...p, format: initialFormat } : p;
  });
  const [excluded, setExcluded] = useState<Set<string>>(new Set());

  useEffect(() => { savePrefs(prefs); }, [prefs]);

  const update = (patch: Partial<Prefs>) => setPrefs((p) => ({ ...p, ...patch }));
  const toggleExcluded = (key: string) => {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  // An Emerald file holds exactly one entry, so a bulk export can't use it.
  const format: ExportFormat = bulk && prefs.format === 'emerald' ? 'pdf' : prefs.format;

  // ── Single entry: its linked entries ──
  const main = useMemo(() => (target ? describeTarget(target) : null), [target]);
  const directTargets = useMemo(() => (target ? collectLinkedTargets(target, false) : []), [target]);
  const allTargets = useMemo(() => (target ? collectLinkedTargets(target, true) : []), [target]);
  const linked = prefs.recursive ? allTargets : directTargets;
  const hasIndirect = allTargets.length > directTargets.length;
  const bundleSupported = format !== 'emerald';
  const bundling = !bulk && bundleSupported && prefs.includeLinked && linked.length > 0;

  // ── Bulk: entries of the chosen modules and period ──
  const range = useMemo(
    () => periodRange(prefs.bulkPeriod, prefs.bulkFrom, prefs.bulkTo),
    [prefs.bulkPeriod, prefs.bulkFrom, prefs.bulkTo],
  );
  const bulkTargets = useMemo(
    () => (bulk && !range.invalid ? collectTargetsInRange(prefs.bulkModules, range.from, range.to) : []),
    [bulk, prefs.bulkModules, range],
  );

  const selected: ExportTarget[] = target
    ? [target, ...(bundling ? linked.filter((l) => !excluded.has(targetKey(l))) : [])]
    : bulkTargets.filter((b) => !excluded.has(targetKey(b)));

  const toggleModule = (type: ExportEntryType) => {
    const has = prefs.bulkModules.includes(type);
    update({ bulkModules: MODULES.filter((m) => (m === type ? !has : prefs.bulkModules.includes(m))) });
  };

  function bundleTitle(): string {
    const modules = prefs.bulkModules.map((m) => t(TYPE_LABEL_KEYS[m])).join(', ');
    const day = (d: Date) => formatDate(d, 'dd.MM.yyyy');
    const span = range.from && range.to ? `${day(range.from)}–${day(range.to)}`
      : range.from ? t('exportModal.bulk.since', { date: day(range.from) })
      : range.to ? t('exportModal.bulk.until', { date: day(range.to) })
      : t('exportModal.bulk.allTime');
    return t('exportModal.bulk.fileTitle', { modules, range: span });
  }

  /** e.g. `Emerald_Journal-Operations_2026-09-01_2026-09-10` — sortable, no characters a file system dislikes. */
  function bundleFilename(): string {
    const modules = prefs.bulkModules.map((m) => MODULE_FILE_NAMES[m]).join('-');
    const days = [range.from, range.to].filter((d): d is Date => !!d).map((d) => formatDate(d, DAY));
    return ['Emerald', modules, ...days].join('_');
  }

  function htmlLabels(count: number): HtmlExportLabels {
    return {
      search: t('exportModal.html.search'),
      noResults: t('search.noResultsShort'),
      linkedFrom: t('exportModal.html.linkedFrom'),
      linksTo: t('exportModal.html.linksTo'),
      outline: t('exportModal.html.outline'),
      print: t('exportModal.html.print'),
      toggleTheme: t('exportModal.html.toggleTheme'),
      toggleSidebar: t('exportModal.html.toggleSidebar'),
      entryCount: t('exportModal.entryCount', { count }),
      // `{{app}}` stays in so the export can turn it into a link.
      exportedOn: t('exportModal.html.exportedOn', { date: formatDate(new Date(), 'dd.MM.yyyy'), app: '{{app}}' }),
      groups: {
        journal: t(TYPE_LABEL_KEYS.journal),
        wiki: t(TYPE_LABEL_KEYS.wiki),
        operations: t(TYPE_LABEL_KEYS.operations),
      },
    };
  }

  async function handleExport() {
    if (!selected.length) return;
    setBusy(true);
    const options: ExportOptions = {
      images: prefs.images,
      audio: prefs.audio,
      bundleTitle: bulk ? bundleTitle() : undefined,
      bundleFilename: bulk ? bundleFilename() : undefined,
    };
    try {
      let saved: boolean;
      if (format === 'emerald' && target) {
        saved = await exportAsEmerald(target, options);
      } else {
        const collected = await Promise.all(selected.map(collectExportDataFor));
        const entries = collected.filter((d): d is ExportData => !!d);
        if (format === 'pdf') saved = await exportAsPDF(entries, options);
        else if (format === 'html') saved = await exportAsHTML(entries, htmlLabels(entries.length), i18n.language, options);
        else saved = await exportAsMarkdown(entries, options);
      }
      if (!saved) { setBusy(false); return; } // save dialog cancelled — keep the modal open
      close();
      await message(t('exportModal.saved'), { title: t('exportModal.title'), kind: 'info' });
    } catch (err) {
      setBusy(false);
      exportErrorMessage(err, 'export');
    }
  }

  const bundleHint = format === 'html'
    ? t('exportModal.bundleHintHtml')
    : format === 'pdf'
      ? t('exportModal.bundleHintPdf')
      : t('exportModal.bundleHintMarkdown');

  // The app's themed input (both themes, including the date picker icon), at its natural width.
  const dateInputClass = OP_PROP_SELECT_CLASSES.replace('w-full', 'w-auto');
  const emptyHint = prefs.bulkModules.length === 0 ? t('exportModal.bulk.noModules')
    : range.invalid ? t('exportModal.bulk.invalidDate')
    : t('exportModal.bulk.noMatches');

  return (
    <Modal
      title={bulk ? t('exportModal.bulk.title') : t('exportModal.title')}
      onClose={busy ? () => {} : close}
      widthClassName="w-[540px]"
      maxHeightClassName="max-h-[85vh]"
      className="overflow-hidden"
    >
      <div className="px-4 py-4 space-y-5">
        {/* Entry being exported */}
        {main && target && (
          <div className="flex items-center gap-2.5 text-sm">
            <TargetIcon icon={main.icon} />
            <span className="truncate font-medium" style={{ color: 'var(--text-primary)' }}>{main.title}</span>
            <span className="text-xs shrink-0" style={{ color: 'var(--text-subtle)' }}>{t(TYPE_LABEL_KEYS[target.type])}</span>
          </div>
        )}

        {/* Bulk: which entries */}
        {bulk && (
          <div className="space-y-3">
            <div>
              <p className="text-xs text-stone-500 mb-2">{t('exportModal.bulk.modules')}</p>
              <div className="flex gap-3">
                {MODULES.map((m) => (
                  <button key={m} type="button" onClick={() => toggleModule(m)} className="flex items-center gap-2 text-left">
                    <Checkbox checked={prefs.bulkModules.includes(m)} />
                    <span className="text-xs text-stone-300">{t(TYPE_LABEL_KEYS[m])}</span>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs text-stone-500 mb-2">{t('exportModal.bulk.period')}</p>
              <Segmented
                options={PERIODS}
                value={prefs.bulkPeriod}
                onChange={(p) => update({ bulkPeriod: p })}
                label={(p) => t(`exportModal.bulk.periods.${p}`)}
              />
              {prefs.bulkPeriod === 'custom' && (
                <div className="flex items-center gap-3 mt-2 text-xs text-stone-500">
                  <label className="flex items-center gap-1.5">
                    {t('exportModal.bulk.from')}
                    <input type="date" value={prefs.bulkFrom} max={prefs.bulkTo || undefined} placeholder="yyyy-mm-dd"
                      onChange={(e) => update({ bulkFrom: e.target.value })}
                      className={dateInputClass} />
                  </label>
                  <label className="flex items-center gap-1.5">
                    {t('exportModal.bulk.to')}
                    <input type="date" value={prefs.bulkTo} min={prefs.bulkFrom || undefined} placeholder="yyyy-mm-dd"
                      onChange={(e) => update({ bulkTo: e.target.value })}
                      className={dateInputClass} />
                  </label>
                </div>
              )}
            </div>
            {bulkTargets.length === 0 ? (
              <p className="text-xs text-stone-500 italic">{emptyHint}</p>
            ) : (
              <>
                <EntryList targets={bulkTargets} excluded={excluded} onToggle={toggleExcluded} showDate />
                <p className="text-xs text-stone-500 leading-snug">{bundleHint}</p>
              </>
            )}
          </div>
        )}

        {/* Format */}
        <div>
          <p className="text-xs text-stone-500 mb-2">{t('exportModal.format')}</p>
          <div className="grid grid-cols-2 gap-2">
            {FORMATS.map((f) => {
              const active = format === f.id;
              const unavailable = bulk && f.id === 'emerald';
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => update({ format: f.id })}
                  disabled={unavailable}
                  className={`export-option text-left px-3 py-2.5${active ? ' export-option-active' : ''}`}
                >
                  <div className="flex items-center gap-2">
                    <span className={active ? 'text-jade-400' : 'text-stone-400'}>{f.icon}</span>
                    <span className="text-sm text-stone-200">{t(`exportModal.formats.${f.id}.name`)}</span>
                    <span className="ml-auto text-[10px] font-mono text-stone-500">{f.ext}</span>
                  </div>
                  <p className="text-xs text-stone-500 mt-1 leading-snug">
                    {unavailable ? t('exportModal.bulk.emeraldUnavailable') : t(`exportModal.formats.${f.id}.desc`)}
                  </p>
                </button>
              );
            })}
          </div>
        </div>

        {format === 'pdf' && selected.length >= LARGE_PDF && (
          <p className="text-xs text-stone-500 leading-snug">{t('exportModal.largePdfHint', { count: selected.length })}</p>
        )}

        {/* Attachments */}
        <div className="space-y-3">
          <p className="text-xs text-stone-500">{t('exportModal.attachments')}</p>
          {format === 'markdown' ? (
            <p className="text-xs text-stone-500 leading-snug">{t('exportModal.audio.markdownNote')}</p>
          ) : (
            <>
              <div>
                <p className="text-xs text-stone-500 mb-1.5">{t('exportModal.images')}</p>
                <Segmented
                  options={IMAGE_OPTIONS}
                  value={prefs.images}
                  onChange={(v) => update({ images: v })}
                  label={(v) => t(`exportModal.compression.${v}.name`)}
                />
                <p className="text-xs text-stone-500 mt-1.5 leading-snug">{t(`exportModal.compression.${prefs.images}.desc`)}</p>
              </div>
              <div>
                <p className="text-xs text-stone-500 mb-1.5">{t('exportModal.audio.label')}</p>
                {format === 'pdf' ? (
                  <p className="text-xs text-stone-500 leading-snug">{t('exportModal.audio.alwaysPlaceholder')}</p>
                ) : (
                  <>
                    <Segmented
                      options={AUDIO_OPTIONS}
                      value={prefs.audio}
                      onChange={(v) => update({ audio: v })}
                      label={(v) => t(`exportModal.audio.${v}`)}
                    />
                    <p className="text-xs text-stone-500 mt-1.5 leading-snug">{t(`exportModal.audio.${prefs.audio}Desc`)}</p>
                  </>
                )}
              </div>
            </>
          )}
        </div>

        {/* Single entry: linked entries */}
        {!bulk && (
          <div>
            <p className="text-xs text-stone-500 mb-2">{t('exportModal.linkedEntries')}</p>
            {directTargets.length === 0 ? (
              <p className="text-xs text-stone-500 italic">{t('exportModal.noLinked')}</p>
            ) : !bundleSupported ? (
              <p className="text-xs text-stone-500">{t('exportModal.emeraldSingle')}</p>
            ) : (
              <div className="space-y-3">
                <button
                  type="button"
                  onClick={() => update({ includeLinked: !prefs.includeLinked })}
                  className="flex items-center gap-2 text-left"
                >
                  <Checkbox checked={prefs.includeLinked} />
                  <span className="text-xs text-stone-300">{t('exportModal.includeLinked')}</span>
                </button>

                {prefs.includeLinked && (
                  <>
                    {hasIndirect && (
                      <Segmented
                        options={['direct', 'all'] as const}
                        value={prefs.recursive ? 'all' : 'direct'}
                        onChange={(v) => update({ recursive: v === 'all' })}
                        label={(v) => v === 'all'
                          ? t('exportModal.depthAll', { count: allTargets.length })
                          : t('exportModal.depthDirect', { count: directTargets.length })}
                      />
                    )}
                    <EntryList targets={linked} excluded={excluded} onToggle={toggleExcluded} />
                    <p className="text-xs text-stone-500 leading-snug">{bundleHint}</p>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 px-4 py-3 border-t" style={{ borderColor: 'var(--border-soft)' }}>
        <span className="text-xs text-stone-500 mr-auto">
          {t('exportModal.entryCount', { count: selected.length })} · {t(`exportModal.formats.${format}.name`)}
        </span>
        <Button onClick={close} variant="secondary" disabled={busy}>
          {t('exportModal.cancel')}
        </Button>
        <Button onClick={handleExport} variant="primary" disabled={busy || selected.length === 0}>
          {busy && <Loader2 size={13} className="animate-spin" />}
          {busy ? t('exportModal.exporting') : t('exportModal.export')}
        </Button>
      </div>
    </Modal>
  );
}
