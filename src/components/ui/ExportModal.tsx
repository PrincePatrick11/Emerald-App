import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { message } from '@tauri-apps/plugin-dialog';
import { format as formatDate } from 'date-fns';
import { Check, FileText, Gem, Globe, Hash, Loader2 } from 'lucide-react';
import { useExportStore, type ExportFormat } from '../../store/exportStore';
import {
  collectExportDataFor, collectLinkedTargets, describeTarget,
  type ExportData, type ExportTarget,
} from '../../lib/exportData';
import { exportAsMarkdown, exportAsPDF, exportErrorMessage } from '../../lib/export';
import { exportAsHTML, type HtmlExportLabels } from '../../lib/htmlExport';
import { exportAsEmerald } from '../../lib/emeraldFormat';
import type { ImageCompression } from '../../lib/imageCompression';
import Modal from './Modal';
import Button from './Button';

const FORMATS: { id: ExportFormat; icon: React.ReactNode; ext: string }[] = [
  { id: 'pdf',      icon: <FileText size={16} />, ext: '.pdf' },
  { id: 'html',     icon: <Globe size={16} />,    ext: '.html' },
  { id: 'markdown', icon: <Hash size={16} />,     ext: '.md' },
  { id: 'emerald',  icon: <Gem size={16} />,      ext: '.emerald' },
];

const COMPRESSION_LEVELS: ImageCompression[] = ['none', 'balanced', 'strong'];

const TYPE_LABEL_KEYS: Record<ExportTarget['type'], string> = {
  journal: 'linkPicker.tabJournal',
  wiki: 'linkPicker.tabWiki',
  operations: 'linkPicker.tabOperations',
};

const PREFS_KEY = 'export-modal-prefs';

interface Prefs {
  format: ExportFormat;
  includeLinked: boolean;
  recursive: boolean;
  compression: ImageCompression;
}

function loadPrefs(): Prefs {
  const fallback: Prefs = { format: 'pdf', includeLinked: false, recursive: false, compression: 'balanced' };
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

function savePrefs(prefs: Prefs) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* ignore */ }
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

export default function ExportModal() {
  const request = useExportStore((s) => s.request);
  if (!request) return null;
  // Remount per request so the state below starts fresh for each export —
  // also when a menu item is picked while the modal is already open.
  return <ExportModalBody key={request.seq} target={request.target} initialFormat={request.format} />;
}

function ExportModalBody({ target, initialFormat }: { target: ExportTarget; initialFormat?: ExportFormat }) {
  const { t, i18n } = useTranslation();
  const close = useExportStore((s) => s.close);

  const [prefs, setPrefs] = useState<Prefs>(() => {
    const p = loadPrefs();
    return initialFormat ? { ...p, format: initialFormat } : p;
  });
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const busy = useExportStore((s) => s.busy);
  const setBusy = useExportStore((s) => s.setBusy);

  useEffect(() => { savePrefs(prefs); }, [prefs]);

  const main = useMemo(() => describeTarget(target), [target]);
  const directTargets = useMemo(() => collectLinkedTargets(target, false), [target]);
  const allTargets = useMemo(() => collectLinkedTargets(target, true), [target]);
  const linked = prefs.recursive ? allTargets : directTargets;
  const hasIndirect = allTargets.length > directTargets.length;

  const bundleSupported = prefs.format !== 'emerald';
  const bundling = bundleSupported && prefs.includeLinked && linked.length > 0;
  const selectedLinked = bundling ? linked.filter((l) => !excluded.has(targetKey(l))) : [];
  const totalCount = 1 + selectedLinked.length;

  const update = (patch: Partial<Prefs>) => setPrefs((p) => ({ ...p, ...patch }));

  const toggleExcluded = (key: string) => {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

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
    setBusy(true);
    try {
      let saved: boolean;
      if (prefs.format === 'emerald') {
        saved = await exportAsEmerald(target, prefs.compression);
      } else {
        const collected = await Promise.all([target, ...selectedLinked].map(collectExportDataFor));
        const entries = collected.filter((d): d is ExportData => !!d);
        if (prefs.format === 'pdf') saved = await exportAsPDF(entries, prefs.compression);
        else if (prefs.format === 'html') saved = await exportAsHTML(entries, htmlLabels(entries.length), i18n.language, prefs.compression);
        else saved = await exportAsMarkdown(entries);
      }
      if (!saved) { setBusy(false); return; } // save dialog cancelled — keep the modal open
      close();
      await message(t('exportModal.saved'), { title: t('exportModal.title'), kind: 'info' });
    } catch (err) {
      setBusy(false);
      exportErrorMessage(err, 'export');
    }
  }

  const bundleHint = prefs.format === 'html'
    ? t('exportModal.bundleHintHtml')
    : prefs.format === 'pdf'
      ? t('exportModal.bundleHintPdf')
      : t('exportModal.bundleHintMarkdown');

  return (
    <Modal
      title={t('exportModal.title')}
      onClose={busy ? () => {} : close}
      widthClassName="w-[520px]"
      maxHeightClassName="max-h-[85vh]"
      className="overflow-hidden"
    >
      <div className="px-4 py-4 space-y-5">
        {/* Entry being exported */}
        <div className="flex items-center gap-2.5 text-sm">
          <TargetIcon icon={main.icon} />
          <span className="truncate font-medium" style={{ color: 'var(--text-primary)' }}>{main.title}</span>
          <span className="text-xs shrink-0" style={{ color: 'var(--text-subtle)' }}>{t(TYPE_LABEL_KEYS[target.type])}</span>
        </div>

        {/* Format */}
        <div>
          <p className="text-xs text-stone-500 mb-2">{t('exportModal.format')}</p>
          <div className="grid grid-cols-2 gap-2">
            {FORMATS.map((f) => {
              const active = prefs.format === f.id;
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => update({ format: f.id })}
                  className={`export-option text-left px-3 py-2.5${active ? ' export-option-active' : ''}`}
                >
                  <div className="flex items-center gap-2">
                    <span className={active ? 'text-jade-400' : 'text-stone-400'}>{f.icon}</span>
                    <span className="text-sm text-stone-200">{t(`exportModal.formats.${f.id}.name`)}</span>
                    <span className="ml-auto text-[10px] font-mono text-stone-500">{f.ext}</span>
                  </div>
                  <p className="text-xs text-stone-500 mt-1 leading-snug">{t(`exportModal.formats.${f.id}.desc`)}</p>
                </button>
              );
            })}
          </div>
        </div>

        {/* Images — Markdown exports drop images, so there's nothing to compress */}
        {prefs.format !== 'markdown' && (
          <div>
            <p className="text-xs text-stone-500 mb-2">{t('exportModal.images')}</p>
            <div className="flex gap-1 p-0.5 rounded-lg border w-fit" style={{ borderColor: 'var(--border-soft)' }}>
              {COMPRESSION_LEVELS.map((level) => (
                <button
                  key={level}
                  type="button"
                  onClick={() => update({ compression: level })}
                  className={`export-segment${prefs.compression === level ? ' export-segment-active' : ''}`}
                >
                  {t(`exportModal.compression.${level}.name`)}
                </button>
              ))}
            </div>
            <p className="text-xs text-stone-500 mt-1.5 leading-snug">{t(`exportModal.compression.${prefs.compression}.desc`)}</p>
          </div>
        )}

        {/* Linked entries */}
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
                    <div className="flex gap-1 p-0.5 rounded-lg border w-fit" style={{ borderColor: 'var(--border-soft)' }}>
                      {([false, true] as const).map((rec) => (
                        <button
                          key={String(rec)}
                          type="button"
                          onClick={() => update({ recursive: rec })}
                          className={`export-segment${prefs.recursive === rec ? ' export-segment-active' : ''}`}
                        >
                          {rec
                            ? t('exportModal.depthAll', { count: allTargets.length })
                            : t('exportModal.depthDirect', { count: directTargets.length })}
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="rounded-lg border max-h-48 overflow-y-auto py-1" style={{ borderColor: 'var(--border-soft)' }}>
                    {linked.map((l) => {
                      const key = targetKey(l);
                      const info = describeTarget(l);
                      const checked = !excluded.has(key);
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => toggleExcluded(key)}
                          className="context-menu-item-default w-full flex items-center gap-2.5 px-3 py-1.5 text-left hover:bg-stone-700/30 transition-colors"
                        >
                          <Checkbox checked={checked} />
                          <TargetIcon icon={info.icon} />
                          <span className={`text-xs truncate ${checked ? 'text-stone-300' : 'text-stone-500'}`}>{info.title}</span>
                          <span className="ml-auto text-[10px] text-stone-500 shrink-0">{t(TYPE_LABEL_KEYS[l.type])}</span>
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-xs text-stone-500 leading-snug">{bundleHint}</p>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 px-4 py-3 border-t" style={{ borderColor: 'var(--border-soft)' }}>
        <span className="text-xs text-stone-500 mr-auto">
          {t('exportModal.entryCount', { count: totalCount })} · {t(`exportModal.formats.${prefs.format}.name`)}
        </span>
        <Button onClick={close} variant="secondary" disabled={busy}>
          {t('exportModal.cancel')}
        </Button>
        <Button onClick={handleExport} variant="primary" disabled={busy}>
          {busy && <Loader2 size={13} className="animate-spin" />}
          {busy ? t('exportModal.exporting') : t('exportModal.export')}
        </Button>
      </div>
    </Modal>
  );
}
