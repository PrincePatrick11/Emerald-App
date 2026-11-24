import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { format } from 'date-fns';
import { Download, Loader2 } from 'lucide-react';
import Modal from '../../ui/Modal';
import Button from '../../ui/Button';
import SegmentedControl from '../../ui/SegmentedControl';
import FieldDropdown from '../../ui/FieldDropdown';
import FilterList from '../../ui/FilterList';
import TagInput from '../../ui/TagInput';
import BlockCheckbox from '../../blocks/BlockCheckbox';
import ExportEntryChecklist from './ExportEntryChecklist';
import { Part } from '../menuParts';
import VaultExportOptions from './VaultExportOptions';
import { NewPasswordFields, newPasswordProblem } from '../vaultKeyParts';
import { useExportMenuStore, type ExportTarget } from '../../../store/exportMenuStore';
import { useEntryStore } from '../../../store/entryStore';
import { useDashboardStore, dashboardOrAll } from '../../../store/dashboardStore';
import { useCategoryStore } from '../../../store/categoryStore';
import { useTemplateStore } from '../../../store/templateStore';
import { useTagStore } from '../../../store/tagStore';
import { useVaultStore } from '../../../store/vaultStore';
import { useSettingsStore } from '../../../store/settingsStore';
import { categoryLabel } from '../../../lib/categories';
import { dashboardLabel } from '../../../lib/dashboards';
import { displayTitle } from '../../../lib/entryTitle';
import { exportFilename, safeFileBase } from '../../../lib/helpers';
import { IMAGE_MODES, type ImageMode } from '../../../lib/emerald/manifest';
import type { EmeraldProtection } from '../../../lib/emerald/file';
import { EXPORT_FONT_OPTIONS, EXPORT_FONT_SIZES, type ExportFontId } from '../../../lib/exportFonts';
import {
  EXPORT_FORMATS, PRESET_PERIODS, TYPESET_FORMATS, bulkEntries, byCreated, effectiveSettings, exportTypography, freeFilter,
  linkedImageMode, liveFilter, loadExportPrefs, periodRange,
  saveExportPrefs, type ExportFormat, type ExportPeriod, type ExportPrefs, type ExportScope,
} from '../../../lib/exportMenu';
import type { Entry } from '../../../types';

const SCOPES: readonly ExportScope[] = ['entry', 'bulk', 'vault'];
const DAY = 'yyyy-MM-dd';

/**
 * The export menu, from the title bar's Export: one entry (or the open
 * template), a collective export, or the whole database — under "Normal" with
 * a few choices, under "Advanced" with all of them. What it can write is the
 * business of the exports (`lib/export.ts`, `lib/emeraldFormat.ts`,
 * `lib/dbBackup.ts`); which entries, and how, is decided here and in
 * `lib/exportMenu.ts`.
 */
export default function ExportMenuModal() {
  const request = useExportMenuStore((s) => s.request);
  if (!request) return null;
  // Remount per opening, so the menu starts from the view on screen then.
  return <ExportMenuBody key={request.seq} target={request.target} />;
}

function ExportMenuBody({ target }: { target: ExportTarget }) {
  const { t } = useTranslation();
  const close = useExportMenuStore((s) => s.close);
  const entries = useEntryStore((s) => s.entries);
  const dashboards = useDashboardStore((s) => s.dashboards);
  const categories = useCategoryStore((s) => s.categories);
  const templates = useTemplateStore((s) => s.templates);

  const tags = useTagStore((s) => s.tags);
  const vaultId = useVaultStore((s) => s.activeVaultId);
  const appearance = useSettingsStore((s) => s.settings.appearance);

  const [prefs, setPrefs] = useState<ExportPrefs>(() => loadExportPrefs(vaultId));
  useEffect(() => { saveExportPrefs(prefs, vaultId); }, [prefs, vaultId]);
  const update = (patch: Partial<ExportPrefs>) => setPrefs((p) => ({ ...p, ...patch }));

  // Unticked entries, for this opening only.
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const toggleExcluded = (id: string) => setExcluded((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);

  const advanced = prefs.level === 'advanced';
  // "This entry" without one on screen is a collective export — the remembered choice stays.
  const scope: ExportScope = prefs.scope === 'entry' && !target ? 'bulk' : prefs.scope;
  const template = scope === 'entry' && target?.kind === 'template'
    ? templates.find((tpl) => tpl.id === target.id) ?? null
    : null;
  const openEntry = scope === 'entry' && target?.kind === 'entry'
    ? entries.find((e) => e.id === target.id) ?? null
    : null;
  // A template has none of the Advanced controls: Normal's settings apply to it.
  const s = effectiveSettings(template ? { ...prefs, level: 'normal' } : prefs);
  // A template only goes as `.emerald`.
  const fmt: ExportFormat | 'vault' = scope === 'vault' ? 'vault' : template ? 'emerald' : prefs.format;
  const sealed = fmt === 'emerald' || fmt === 'vault';
  const typeset = (TYPESET_FORMATS as readonly string[]).includes(fmt);
  const typography = exportTypography(prefs, { font: appearance.editorFont, size: appearance.editorFontSize });

  // ── A collective export's entries ──
  const dashboard = dashboardOrAll(dashboards, prefs.dashboardId);
  // Remembered categories and tags that are gone since drop out, here and in the controls.
  const liveCategories = useMemo(() => new Set(categories.map((c) => c.id)), [categories]);
  const liveTags = useMemo(() => new Set(tags.map((tag) => tag.id)), [tags]);
  const ownFilter = useMemo(
    () => liveFilter(prefs.filter, liveCategories, liveTags),
    [prefs.filter, liveCategories, liveTags],
  );
  const filter = s.source === 'filter' ? freeFilter(ownFilter) : dashboard?.filter ?? {};
  const range = useMemo(() => periodRange(prefs.period, prefs.from, prefs.to), [prefs.period, prefs.from, prefs.to]);
  const bulkList = useMemo(
    () => (scope === 'bulk' && !range.invalid ? bulkEntries(entries, filter, range, s.order, { categories: liveCategories, tags: liveTags }) : []),
    // `filter` is rebuilt every render; its parts are what counts.
    [scope, entries, range, s.order, liveCategories, liveTags, JSON.stringify(filter)],
  );
  const isOut = (id: string) => advanced && excluded.has(id);

  const roots: Entry[] = useMemo(
    () => (scope === 'bulk' ? bulkList.filter((e) => !isOut(e.id)) : openEntry ? [openEntry] : []),
    [scope, bulkList, openEntry, excluded, advanced],
  );

  // ── Linked entries: of the one entry, or of the collective export's ──
  const wantLinked = scope !== 'vault' && !template && prefs.includeLinked && roots.length > 0;
  const [linked, setLinked] = useState<{ key: string; direct: string[]; all: string[] }>({ key: '', direct: [], all: [] });
  // Ticked-off entries are not walked through: what only they link to stays out too.
  const blockedKey = advanced ? [...excluded].sort().join(',') : '';
  const rootKey = `${roots.map((e) => e.id).join(',')}|${blockedKey}`;
  useEffect(() => {
    if (!wantLinked) return;
    let live = true;
    void (async () => {
      const { linkedEntriesOf } = await import('../../../lib/emeraldFormat');
      const [rootPart, blockedPart] = rootKey.split('|');
      const ids = rootPart.split(',');
      const blocked = blockedPart ? blockedPart.split(',') : [];
      const [direct, all] = await Promise.all([
        linkedEntriesOf(ids, { blocked }),
        linkedEntriesOf(ids, { recursive: true, blocked }),
      ]);
      if (live) setLinked({ key: rootKey, direct, all });
    })().catch((err) => {
      console.error('[export] linked entries', err);
      // Without the list the export goes out without linked entries rather than never.
      if (live) setLinked({ key: rootKey, direct: [], all: [] });
    });
    return () => { live = false; };
  }, [wantLinked, rootKey]);
  const linkedReady = !wantLinked || linked.key === rootKey;
  const linkedEntries = useMemo(() => {
    // While a new list loads the last one stays (no jump on every tick); Export waits for it.
    if (!wantLinked || !linked.key) return [];
    // Entries of the collective export ticked off stay out, also as linked ones.
    const skipped = new Set(bulkList.filter((e) => isOut(e.id)).map((e) => e.id));
    const ids = new Set((s.recursive ? linked.all : linked.direct).filter((id) => !skipped.has(id)));
    return byCreated(entries.filter((e) => ids.has(e.id)), s.order);
  }, [wantLinked, linked, rootKey, s.recursive, s.order, entries, bulkList, excluded, advanced]);
  const linkedChosen = linkedEntries.filter((e) => !isOut(e.id));
  const hasIndirect = linked.all.length > linked.direct.length;

  const count = scope === 'vault' ? null : template ? 1 : roots.length + linkedChosen.length;

  // ── Protection ──
  const passwordProblem = sealed && prefs.protection === 'password' ? newPasswordProblem(t, password, repeat) : '';
  const protection: EmeraldProtection = prefs.protection === 'password' ? { type: 'password', password }
    : prefs.protection === 'vaultKey' ? { type: 'vaultKey' }
    : { type: 'none' };

  const canExport = !busy && !passwordProblem && linkedReady && (count === null || count > 0) && !(scope === 'bulk' && range.invalid);

  /** A collective export's name: the dashboard (or "Export") and its days. */
  function bundleName(): string {
    const label = s.source === 'filter' || !dashboard ? t('exportMenu.bundleFilter') : dashboardLabel(t, dashboard);
    const days = range.from || range.to ? [range.from, range.to ?? new Date()].filter((d): d is Date => !!d).map((d) => format(d, DAY)) : [];
    return ['Emerald', safeFileBase(label), ...days].join('_');
  }

  async function handleExport() {
    if (!canExport) return;
    setBusy(true);
    try {
      let saved: boolean;
      if (fmt === 'vault') {
        const { exportDatabase } = await import('../../../lib/dbBackup');
        saved = await exportDatabase(s.vault, protection);
      } else if (fmt === 'emerald') {
        const { exportItemsAsEmerald } = await import('../../../lib/emeraldFormat');
        const linkedImages: ImageMode = linkedImageMode(s);
        const items = template
          ? [{ kind: 'template' as const, id: template.id }]
          : [
            ...roots.map((e) => ({ kind: 'entry' as const, id: e.id })),
            ...linkedChosen.map((e) => ({ kind: 'entry' as const, id: e.id, images: linkedImages })),
          ];
        const name = template ? exportFilename(template.name || t('templates.untitled'), template.created_at, 'emerald')
          : scope === 'entry' && openEntry ? exportFilename(displayTitle(t, 'entry', openEntry.title), openEntry.created_at, 'emerald')
          : `${bundleName()}.emerald`;
        saved = await exportItemsAsEmerald({ items, images: s.images, protection, blockDefinitions: s.blockDefinitions }, name);
      } else {
        const { exportAsPDF, exportAsMarkdown } = await import('../../../lib/export');
        const { exportAsHTML } = await import('../../../lib/htmlExport');
        const { collectExportDataFor } = await import('../../../lib/exportData');
        const linkedIds = new Set(linkedChosen.map((e) => e.id));
        const items = [];
        for (const entry of [...roots, ...linkedChosen]) {
          const data = await collectExportDataFor(entry.id);
          if (data) items.push({ data, images: linkedIds.has(entry.id) ? linkedImageMode(s) : s.images });
        }
        const file = { bundle: scope === 'bulk' ? bundleName() : undefined, typography, order: s.order };
        saved = fmt === 'pdf' ? await exportAsPDF(items, file)
          : fmt === 'html' ? await exportAsHTML(items, file)
          : await exportAsMarkdown(items, file);
      }
      // Cancelling in the save dialog is no success, and no reason to close.
      if (saved) close();
      else setBusy(false);
    } catch (err) {
      setBusy(false);
      const { exportErrorMessage } = await import('../../../lib/export');
      void exportErrorMessage(err, fmt);
    }
  }

  // ── The parts ──
  // "This entry" only while one is on screen.
  const scopeOptions = SCOPES.filter((value) => value !== 'entry' || target).map((value) => ({
    value,
    label: value === 'entry' && target?.kind === 'template' ? t('exportMenu.scope.template') : t(`exportMenu.scope.${value}`),
  }));
  const imageOptions = IMAGE_MODES.map((value) => ({ value, label: t(`exportMenu.images.${value}`) }));
  const periodOptions = (advanced ? [...PRESET_PERIODS, 'custom' as const] : PRESET_PERIODS)
    .map((value) => ({ value, label: t(`exportMenu.period.${value}`) }));
  const dateField = (key: 'from' | 'to') => (
    <div className="flex-1">
      <label className="label-xs block mb-2">{t(key === 'from' ? 'settings.dateFrom' : 'settings.dateTo')}</label>
      <input
        type="date"
        value={prefs[key]}
        data-empty={prefs[key] === '' || undefined}
        onChange={(e) => update({ [key]: e.target.value })}
        className="input-field settings-field"
      />
    </div>
  );

  // Advanced: a dashboard or an own filter.
  const sourceToggle = advanced && (
    <SegmentedControl className="w-fit"
      options={(['dashboard', 'filter'] as const).map((value) => ({ value, label: t(`exportMenu.source.${value}`) }))}
      value={prefs.source}
      onChange={(source) => { update({ source }); setExcluded(new Set()); }}
      ariaLabel={t('exportMenu.source.label')}
    />
  );

  const bulkPart = scope === 'bulk' && (
    <>
      {s.source === 'dashboard' ? (
        <Part title={advanced ? t('exportMenu.source.label') : t('exportMenu.dashboard')}>
          {sourceToggle}
          <FieldDropdown
            value={dashboard?.id ?? 'all'}
            options={dashboards.map((d) => ({ value: d.id, label: dashboardLabel(t, d) }))}
            onChange={(dashboardId) => { update({ dashboardId }); setExcluded(new Set()); }}
            ariaLabel={t('exportMenu.dashboard')}
          />
        </Part>
      ) : (
        <>
          <Part title={t('exportMenu.source.label')}>{sourceToggle}</Part>
          <Part title={t('dashboards.filterCategories')} hint={t('dashboards.filterCategoriesHint')}>
            <div className="max-h-44 overflow-y-auto">
              <FilterList
                chips={categories.map((c) => ({ value: c.id, label: categoryLabel(t, c), emoji: c.emoji }))}
                selected={ownFilter.categories}
                onToggle={(id) => update({
                  filter: {
                    ...ownFilter,
                    categories: ownFilter.categories.includes(id)
                      ? ownFilter.categories.filter((c) => c !== id)
                      : [...ownFilter.categories, id],
                  },
                })}
                onAll={() => update({ filter: { ...ownFilter, categories: [] } })}
              />
            </div>
          </Part>
          <Part title={t('dashboards.filterTags')} hint={t('dashboards.filterTagsHint')}>
            <TagInput tags={ownFilter.tags} onChange={(next) => update({ filter: { ...ownFilter, tags: next } })} flush existingOnly />
          </Part>
        </>
      )}
      <Part
        title={t('exportMenu.period.label')}
        hint={!advanced && prefs.period === 'custom' ? t('exportMenu.period.customNote') : undefined}
      >
        <SegmentedControl<ExportPeriod> className="w-fit"
          options={periodOptions}
          value={!advanced && prefs.period === 'custom' ? null : prefs.period}
          onChange={(period) => update({ period })}
          ariaLabel={t('exportMenu.period.label')}
        />
        {advanced && prefs.period === 'custom' && (
          <div className="flex gap-3 items-center">{dateField('from')}{dateField('to')}</div>
        )}
      </Part>
      {range.invalid ? (
        <p className="text-xs text-subtle italic">{t('exportMenu.invalidDate')}</p>
      ) : bulkList.length === 0 ? (
        <p className="text-xs text-subtle italic">{t('exportMenu.noMatches')}</p>
      ) : advanced && (
        <Part title={t('exportMenu.count', { count: bulkList.length })}>
          <ExportEntryChecklist entries={bulkList} excluded={excluded} onToggle={toggleExcluded} />
        </Part>
      )}
    </>
  );

  const linkedPart = scope !== 'vault' && !template && roots.length > 0 && (
    <Part title={t('exportMenu.linked')}>
      <BlockCheckbox
        checked={prefs.includeLinked}
        onChange={(includeLinked) => update({ includeLinked })}
        label={t('exportMenu.includeLinked')}
        hint={!advanced ? t('exportMenu.includeLinkedHint') : undefined}
      />
      {wantLinked && linkedReady && linkedEntries.length === 0 && (
        <p className="text-xs text-subtle italic">{t('exportMenu.noLinked')}</p>
      )}
      {advanced && wantLinked && linked.all.length > 0 && (hasIndirect || prefs.recursive) && (
        <SegmentedControl className="w-fit"
          options={[
            { value: 'direct' as const, label: t('exportMenu.depth.direct', { count: linked.direct.length }) },
            { value: 'all' as const, label: t('exportMenu.depth.all', { count: linked.all.length }) },
          ]}
          value={prefs.recursive ? 'all' : 'direct'}
          onChange={(v) => update({ recursive: v === 'all' })}
          ariaLabel={t('exportMenu.depth.label')}
        />
      )}
      {advanced && linkedEntries.length > 0 && (
        <ExportEntryChecklist entries={linkedEntries} excluded={excluded} onToggle={toggleExcluded} />
      )}
    </Part>
  );

  const picturePart = advanced && (typeset || fmt === 'emerald') && !template && (
    <Part title={t('exportMenu.images.label')}>
      <SegmentedControl className="w-fit" options={imageOptions} value={prefs.images} onChange={(images) => update({ images })} ariaLabel={t('exportMenu.images.label')} />
      <p className="text-xs text-subtle leading-snug">{t(`exportMenu.images.${prefs.images}Desc`)}</p>
      {linkedChosen.length > 0 && (
        <div className="space-y-2 pt-1">
          <BlockCheckbox
            checked={prefs.linkedImagesOwn}
            onChange={(linkedImagesOwn) => update({ linkedImagesOwn })}
            label={t('exportMenu.images.linkedOwn')}
          />
          {prefs.linkedImagesOwn && (
            <SegmentedControl className="w-fit"
              options={imageOptions}
              value={prefs.linkedImages}
              onChange={(linkedImages) => update({ linkedImages })}
              ariaLabel={t('exportMenu.images.linkedOwn')}
            />
          )}
        </div>
      )}
    </Part>
  );

  // Advanced, PDF and HTML: the font and size the entries are set in; the app's to start with.
  const typePart = advanced && typeset && (
    <Part title={t('exportMenu.typography.label')} hint={t('exportMenu.typography.hint')}>
      <div className="w-64">
        <FieldDropdown<ExportFontId>
          value={typography.font}
          options={EXPORT_FONT_OPTIONS.map(({ id, label }) => ({
            value: id,
            label: id === appearance.editorFont ? t('exportMenu.typography.appFont', { font: label }) : label,
          }))}
          // The app's own is stored as none, so the export follows a later change in Settings.
          onChange={(font) => update({ font: font === appearance.editorFont ? null : font })}
          ariaLabel={t('exportMenu.typography.font')}
        />
      </div>
      <SegmentedControl className="w-fit"
        options={EXPORT_FONT_SIZES.map((size) => ({ value: size, label: t('common.pixelValue', { value: size }) }))}
        value={typography.size}
        onChange={(fontSize) => update({ fontSize: fontSize === appearance.editorFontSize ? null : fontSize })}
        ariaLabel={t('exportMenu.typography.size')}
      />
    </Part>
  );

  return (
    <Modal
      title={t('exportMenu.title')}
      onClose={close}
      dismissible={!busy}
      widthClassName="w-[600px] max-w-full"
      maxHeightClassName="max-h-[88vh]"
      bodyClassName="modal-body flex-1 overflow-y-auto"
      footer={(
        <div className="flex items-center gap-2 w-full">
          <span className="text-xs text-subtle mr-auto">
            {count === null ? t('exportMenu.wholeVault') : template ? t('exportMenu.oneTemplate') : t('exportMenu.total', { count })}
          </span>
          <Button onClick={close} variant="secondary" disabled={busy}>{t('common.cancel')}</Button>
          <Button onClick={() => void handleExport()} variant="primary" disabled={!canExport}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            {busy ? t('exportMenu.exporting') : t('exportMenu.export')}
          </Button>
        </div>
      )}
    >
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-3">
          <SegmentedControl className="w-fit"
            options={scopeOptions}
            value={scope}
            onChange={(next) => { update({ scope: next }); setExcluded(new Set()); }}
            ariaLabel={t('exportMenu.scope.label')}
          />
          <SegmentedControl
            className="ml-auto w-fit"
            options={(['normal', 'advanced'] as const).map((value) => ({ value, label: t(`exportMenu.level.${value}`) }))}
            value={prefs.level}
            onChange={(level) => update({ level })}
            ariaLabel={t('exportMenu.level.label')}
          />
        </div>
        {scope === 'entry' && (openEntry || template) && (
          <p className="text-sm text-soft truncate">
            {template ? (template.name || t('templates.untitled')) : displayTitle(t, 'entry', openEntry!.title)}
          </p>
        )}

        {bulkPart}
        {linkedPart}

        {advanced && count !== null && count > 1 && !template && (
          <Part title={t('exportMenu.order.label')}>
            <SegmentedControl className="w-fit"
              options={(['asc', 'desc'] as const).map((value) => ({ value, label: t(`exportMenu.order.${value}`) }))}
              value={prefs.order}
              onChange={(order) => update({ order })}
              ariaLabel={t('exportMenu.order.label')}
            />
          </Part>
        )}

        {scope === 'vault' ? (
          <Part title={t('exportMenu.format')} hint={t('exportMenu.vaultHint')}>
            <p className="text-sm text-soft">.vault.emerald</p>
          </Part>
        ) : (
          <Part
            title={t('exportMenu.format')}
            hint={template ? t('exportMenu.templateOnlyEmerald') : t(`exportMenu.formats.${fmt}`)}
          >
            <SegmentedControl className="w-fit"
              options={EXPORT_FORMATS.map((value) => ({ value, label: t(`exportMenu.formatNames.${value}`) }))}
              value={fmt as ExportFormat}
              onChange={(next) => update({ format: next })}
              disabled={!!template}
              ariaLabel={t('exportMenu.format')}
            />
          </Part>
        )}

        {scope === 'vault' && advanced && (
          <VaultExportOptions options={prefs.vault} onChange={(vault) => update({ vault })} />
        )}

        {typePart}
        {picturePart}

        {advanced && fmt === 'emerald' && !template && (
          <BlockCheckbox
            checked={prefs.blockDefinitions}
            onChange={(blockDefinitions) => update({ blockDefinitions })}
            label={t('exportMenu.blockDefinitions')}
            hint={t('exportMenu.blockDefinitionsHint')}
          />
        )}

        {sealed && (
          <Part title={t('exportMenu.protection.label')}>
            <SegmentedControl className="w-fit"
              options={(['vaultKey', 'password', 'none'] as const).map((value) => ({ value, label: t(`exportMenu.protection.${value}`) }))}
              value={prefs.protection}
              onChange={(protection) => update({ protection })}
              ariaLabel={t('exportMenu.protection.label')}
            />
            <p className="text-xs text-subtle leading-snug">{t(`exportMenu.protection.${prefs.protection}Desc`)}</p>
            {prefs.protection === 'password' && (
              <div className="space-y-3 pt-1">
                <NewPasswordFields
                  t={t}
                  password={password}
                  repeat={repeat}
                  onPassword={setPassword}
                  onRepeat={setRepeat}
                  disabled={busy}
                  autoFocus={false}
                  onSubmit={() => void handleExport()}
                />
                {/* Until the repeat is typed the reason Export waits, quietly; after that as an error. */}
                {passwordProblem && (
                  <p className={`text-xs ${repeat ? 'text-danger' : 'text-subtle'}`}>{passwordProblem}</p>
                )}
              </div>
            )}
          </Part>
        )}
      </div>
    </Modal>
  );
}
