import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Zap } from 'lucide-react';
import Button from '../ui/Button';
import Dropdown from '../ui/Dropdown';
import { linkFromSlot } from '../../lib/blocks/fields';
import {
  chargeConceals, chargeCovers, isSigilToolType, parseSigilCharge, serializeSigilCharge, sigilUnits, todayIso,
  type SigilCharge, type SigilLockScope,
} from '../../lib/blocks/sigil';
import { blockLabel, elementLabel } from '../../lib/blocks/blockAttrs';
import { resolveBlockType } from '../../lib/blocks/blockTypes';
import type { BlockInstance } from '../../lib/blocks/types';
import { formatIsoDateLong } from '../../lib/formatDate';
import { OP_PROP_SELECT_CLASSES } from '../../lib/styleClasses';
import UnknownBlock from './UnknownBlock';
import BlockCheckbox from './BlockCheckbox';
import { LinkEditor, LinkTarget } from './BlockLink';
import type { BlockViewProps } from './blockViews';

type ChargeData = Omit<SigilCharge, 'broken'>;

/** Ein Rechner oder eine Zeichnung im Eintrag, wie die Ladung sie zur Auswahl anbietet. */
interface ToolBlock {
  id: string;
  label: string;
}

/**
 * Die Rechner und Zeichnungen des Eintrags — Blöcke und Teile eigener Blöcke
 * (dann „Block · Teil"); gleich heißende bekommen ihre Nummer dazu.
 */
function toolBlocks(t: TFunction, blocks: readonly BlockInstance[]): ToolBlock[] {
  const tools = sigilUnits(blocks)
    .filter(({ block, part }) => isSigilToolType(block.type) && !part?.element.archived)
    .map(({ block, part }) => ({
      id: block.id,
      label: part
        ? `${blockLabel(t, part.parent, resolveBlockType(part.parent))} · ${elementLabel(t, part.element)}`
        : blockLabel(t, block, resolveBlockType(block)),
    }));
  const total = new Map<string, number>();
  for (const tool of tools) total.set(tool.label, (total.get(tool.label) ?? 0) + 1);
  const seen = new Map<string, number>();
  return tools.map((tool) => {
    if (total.get(tool.label)! < 2) return tool;
    const n = (seen.get(tool.label) ?? 0) + 1;
    seen.set(tool.label, n);
    return { ...tool, label: `${tool.label} ${n}` };
  });
}

/**
 * Die Ladung der Sigille: Zieldatum, Ladetechnik (ein Link-Chip), welche
 * Rechner und Zeichnungen sie verdeckt und was „geladen" sperrt. Laden und
 * Entladen gehen im Lesemodus, mit Bestätigung — geladen sperrt den Eintrag
 * (oder nur die verdeckten Blöcke) und verbirgt sie bis zum Datum, ohne Datum
 * bis zum Entladen.
 */
export default function SigilChargeBlock({ block, blocks, isEditing, onBlockChange, onPersist }: BlockViewProps) {
  const { t } = useTranslation();
  const charge = parseSigilCharge(block);
  if (charge.broken) return <UnknownBlock block={block} />;
  const { broken: _broken, ...data } = charge;
  const write = (next: ChargeData) => serializeSigilCharge(block, next);
  const tools = toolBlocks(t, blocks);
  if (isEditing) return <ChargeEditor charge={data} tools={tools} onChange={(next) => onBlockChange(write(next))} />;
  return (
    <ChargeReader
      charge={data}
      tools={tools}
      onPersist={onPersist ? (next) => onPersist(write(next)) : undefined}
    />
  );
}

function Technique({ html, onChange }: { html: string | null; onChange?: (html: string | null) => void }) {
  const { t } = useTranslation();
  const target = linkFromSlot(html ?? undefined);
  return (
    <div className="block-field">
      <div className="block-field-label">{t('creation.chargingTechnique')}</div>
      <div className="block-field-value">
        {onChange
          ? <LinkEditor slot={html ?? undefined} onChange={onChange} />
          : target ? <LinkTarget target={target} /> : <span className="block-field-hint">—</span>}
      </div>
    </div>
  );
}

/**
 * Beim Bearbeiten: welche Rechner und Zeichnungen die Ladung verdeckt. Alle
 * angehakt heißt „alle" — auch einer, der später dazukommt.
 */
function Targets({ charge, tools, onChange }: {
  charge: ChargeData;
  tools: ToolBlock[];
  /** Fehlt, solange die Sigille geladen ist: dann steht die Auswahl fest. */
  onChange?: (targets: string[] | null) => void;
}) {
  const { t } = useTranslation();
  const toggle = (id: string, on: boolean) => {
    const next = tools.filter((tool) => (tool.id === id ? on : chargeCovers(charge, tool.id))).map((tool) => tool.id);
    onChange?.(next.length === tools.length ? null : next);
  };
  return (
    <div className="block-field">
      <div className="block-field-label">{t('blocks.sigil.covers')}</div>
      <div className="block-field-value space-y-1">
        {tools.length === 0
          ? <span className="block-field-hint">{t('blocks.sigil.noTools')}</span>
          : tools.map((tool) => (
              <BlockCheckbox
                key={tool.id}
                checked={chargeCovers(charge, tool.id)}
                disabled={!onChange}
                onChange={(on) => toggle(tool.id, on)}
                label={tool.label}
              />
            ))}
      </div>
    </div>
  );
}

/** Die Statuszeile: geladen oder nicht, und wie lange die Sigille verborgen bleibt. */
function chargeStatus(t: TFunction, charge: ChargeData, date: string | null): string {
  if (!charge.loaded) return t('blocks.sigil.notLoaded');
  const detail = !date
    ? t('blocks.sigil.hiddenUntilUnloaded')
    : chargeConceals(charge, todayIso())
      ? t('creation.hiddenUntilDate', { date })
      : t('blocks.sigil.revealedSince', { date });
  return `${t('blocks.sigil.loaded')} · ${detail}`;
}

function ChargeReader({ charge, tools, onPersist }: {
  charge: ChargeData;
  tools: ToolBlock[];
  onPersist?: (next: ChargeData) => void;
}) {
  const { t } = useTranslation();
  const date = charge.revealDate ? formatIsoDateLong(charge.revealDate) : null;
  // Die verdeckten Blöcke beim Namen — nur, wenn nicht einfach alle gemeint sind.
  const covered = charge.targets === null
    ? null
    : tools.filter((tool) => chargeCovers(charge, tool.id)).map((tool) => tool.label).join(', ');

  return (
    <div className="block-fields">
      <div className="block-field">
        <div className="block-field-label">{t('creation.targetDate')}</div>
        <div className="block-field-value">{date ?? <span className="block-field-hint">{t('blocks.sigil.noRevealDate')}</span>}</div>
      </div>
      <Technique html={charge.technique} />
      {covered !== null && (
        <div className="block-field">
          <div className="block-field-label">{t('blocks.sigil.covers')}</div>
          <div className="block-field-value">{covered || <span className="block-field-hint">—</span>}</div>
        </div>
      )}
      <p className={`block-sigil-status ${charge.loaded ? 'block-sigil-status--loaded' : ''}`}>
        <Zap size={12} className="flex-shrink-0" />
        <span>{chargeStatus(t, charge, date)}</span>
      </p>
      {onPersist && <ChargeActions charge={charge} date={date} onPersist={onPersist} />}
    </div>
  );
}

/** Laden (optional nach einem Timer) und Entladen, je mit Bestätigung. */
function ChargeActions({ charge, date, onPersist }: { charge: ChargeData; date: string | null; onPersist: (next: ChargeData) => void }) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);
  const [delayInput, setDelayInput] = useState('0');
  const [countdown, setCountdown] = useState<number | null>(null);

  // Über Refs: Block und Handgriff sind pro Render neu, der Timer soll dabei nicht neu anlaufen.
  const latest = useRef({ charge, onPersist });
  latest.current = { charge, onPersist };
  const setLoaded = (loaded: boolean) => latest.current.onPersist({ ...latest.current.charge, loaded });

  useEffect(() => {
    if (countdown == null) return;
    if (countdown <= 0) {
      setCountdown(null);
      latest.current.onPersist({ ...latest.current.charge, loaded: true });
      return;
    }
    const timer = window.setTimeout(() => setCountdown((n) => (n == null ? null : n - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [countdown]);

  const confirm = () => {
    setConfirming(false);
    if (charge.loaded) {
      setLoaded(false);
      return;
    }
    const seconds = Math.max(0, Number.parseInt(delayInput || '0', 10) || 0);
    if (seconds > 0) setCountdown(seconds);
    else setLoaded(true);
  };

  if (confirming) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-stone-400">
          {charge.loaded
            ? t('blocks.sigil.unloadConfirm')
            : date ? t('blocks.sigil.loadConfirm', { date }) : t('blocks.sigil.loadConfirmNoDate')}
        </span>
        <Button tone={charge.loaded ? 'neutral' : 'jade'} small onClick={confirm}>
          {charge.loaded ? t('creation.unloadSigil') : t('creation.loadSigille')}
        </Button>
        <Button tone="neutral" small onClick={() => setConfirming(false)}>{t('common.cancel')}</Button>
      </div>
    );
  }
  if (charge.loaded) {
    // In einer Zeile wie Laden — allein in der Spalte von `.block-fields` zöge der Knopf sich sonst über die ganze Breite.
    return (
      <div className="flex items-center gap-2">
        <Button tone="neutral" small onClick={() => setConfirming(true)}>{t('creation.unloadSigil')}</Button>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="block-sigil-timer">
        <span>{t('creation.timerLabel')}</span>
        <input
          type="number"
          min="0"
          value={delayInput}
          onChange={(e) => setDelayInput(e.target.value)}
          placeholder={t('creation.timerSeconds')}
          aria-label={t('creation.timerSeconds')}
        />
      </label>
      <Button tone="jade" small disabled={countdown != null} onClick={() => setConfirming(true)}>
        {countdown != null ? `${countdown}s` : t('creation.loadSigille')}
      </Button>
    </div>
  );
}

function ChargeEditor({ charge, tools, onChange }: {
  charge: ChargeData;
  tools: ToolBlock[];
  onChange: (next: ChargeData) => void;
}) {
  const { t } = useTranslation();
  // Geladen: Datum, Auswahl und Sperre stehen fest — ein Datum in der
  // Vergangenheit oder ein abgewählter Block höbe das Verbergen auf.
  const fixed = charge.loaded;
  return (
    <div className="block-fields block-fields--edit">
      <div className="block-field">
        <div className="block-field-label">{t('creation.targetDate')}</div>
        <div className="block-field-value">
          <input
            type="date"
            className={OP_PROP_SELECT_CLASSES}
            value={charge.revealDate ?? ''}
            disabled={fixed}
            onChange={(e) => onChange({ ...charge, revealDate: e.target.value || null })}
          />
        </div>
      </div>
      <Technique html={charge.technique} onChange={(technique) => onChange({ ...charge, technique })} />
      <Targets charge={charge} tools={tools} onChange={fixed ? undefined : (targets) => onChange({ ...charge, targets })} />
      <div className="block-field">
        <div className="block-field-label">{t('blocks.sigil.lockScope')}</div>
        <div className="block-field-value">
          {fixed ? (
            <span>{charge.lock === 'sigil' ? t('blocks.sigil.lockSigil') : t('blocks.sigil.lockEntry')}</span>
          ) : (
            <Dropdown<SigilLockScope>
              portal
              value={charge.lock}
              onChange={(lock) => onChange({ ...charge, lock })}
              options={[
                { value: 'entry', label: t('blocks.sigil.lockEntry') },
                { value: 'sigil', label: t('blocks.sigil.lockSigil') },
              ]}
            />
          )}
        </div>
      </div>
      {fixed && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-stone-400">{t('blocks.sigil.loaded')}</span>
          <Button tone="neutral" small onClick={() => onChange({ ...charge, loaded: false })}>{t('creation.unloadSigil')}</Button>
        </div>
      )}
    </div>
  );
}
