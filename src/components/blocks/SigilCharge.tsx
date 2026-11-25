import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Zap } from 'lucide-react';
import Button from '../ui/Button';
import Dropdown from '../ui/Dropdown';
import { linkFromSlot } from '../../lib/blocks/fields';
import {
  chargeConceals, parseSigilCharge, serializeSigilCharge, type SigilChargeData, type SigilLockScope,
} from '../../lib/blocks/sigil';
import type { BlockInstance } from '../../lib/blocks/types';
import { formatIsoDateLong } from '../../lib/formatDate';
import { localIsoDay } from '../../lib/helpers';
import { OP_PROP_SELECT_CLASSES } from '../../lib/styleClasses';
import UnknownBlock from './UnknownBlock';
import { LinkEditor, LinkTarget } from './BlockLink';

/**
 * The sigil's charge: target date, charging technique (a link chip) and what
 * "loaded" locks. Charging and discharging work in read mode, with
 * confirmation; loaded, the sigil's calculator and drawing are locked and
 * concealed until the date (without a date until unloaded), and with the lock
 * "whole entry" the entry too (`sigilEffect`).
 */
export default function SigilCharge({ value, isEditing, onChange, onPersist }: {
  /** The charge's block-shaped value (`sigilPartBlock(block, 'charge')`). */
  value: BlockInstance;
  isEditing: boolean;
  onChange: (next: BlockInstance) => void;
  /** Read mode: write at once; absent if the entry allows no change. */
  onPersist?: (next: BlockInstance) => void;
}) {
  const charge = parseSigilCharge(value);
  if (charge.broken) return <UnknownBlock block={value} />;
  const { broken: _broken, ...data } = charge;
  const write = (next: SigilChargeData) => serializeSigilCharge(value, next);
  if (isEditing) return <ChargeEditor charge={data} onChange={(next) => onChange(write(next))} />;
  return <ChargeReader charge={data} onPersist={onPersist ? (next) => onPersist(write(next)) : undefined} />;
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

/** The status line: charged or not, and how long the sigil stays concealed. */
function chargeStatus(t: TFunction, charge: SigilChargeData, date: string | null): string {
  if (!charge.loaded) return t('blocks.sigil.notLoaded');
  const detail = !date
    ? t('blocks.sigil.hiddenUntilUnloaded')
    : chargeConceals(charge, localIsoDay())
      ? t('creation.hiddenUntilDate', { date })
      : t('blocks.sigil.revealedSince', { date });
  return `${t('blocks.sigil.loaded')} · ${detail}`;
}

function ChargeReader({ charge, onPersist }: {
  charge: SigilChargeData;
  onPersist?: (next: SigilChargeData) => void;
}) {
  const { t } = useTranslation();
  const date = charge.revealDate ? formatIsoDateLong(charge.revealDate) : null;

  return (
    <div className="block-fields">
      <div className="block-field">
        <div className="block-field-label">{t('creation.targetDate')}</div>
        <div className="block-field-value">{date ?? <span className="block-field-hint">{t('blocks.sigil.noRevealDate')}</span>}</div>
      </div>
      <Technique html={charge.technique} />
      <p className={`block-sigil-status ${charge.loaded ? 'block-sigil-status--loaded' : ''}`}>
        <Zap size={12} className="flex-shrink-0" />
        <span>{chargeStatus(t, charge, date)}</span>
      </p>
      {onPersist && <ChargeActions charge={charge} date={date} onPersist={onPersist} />}
    </div>
  );
}

/** Charging (optionally after a timer) and discharging, each with confirmation. */
function ChargeActions({ charge, date, onPersist }: { charge: SigilChargeData; date: string | null; onPersist: (next: SigilChargeData) => void }) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);
  const [delayInput, setDelayInput] = useState('0');
  const [countdown, setCountdown] = useState<number | null>(null);

  // Via refs: block and handle are new on every render, and the timer should not restart because of that.
  const latest = useRef({ charge, onPersist });
  latest.current = { charge, onPersist };
  const setLoaded = (loaded: boolean) => latest.current.onPersist({ ...latest.current.charge, loaded });

  useEffect(() => {
    if (countdown == null) return;
    if (countdown <= 0) {
      setCountdown(null);
      setLoaded(true);
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
        <span className="text-xs text-muted">
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
    // In a row of its own: alone in the column of `.block-fields` the button would stretch across the full width.
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

function ChargeEditor({ charge, onChange }: {
  charge: SigilChargeData;
  onChange: (next: SigilChargeData) => void;
}) {
  const { t } = useTranslation();
  // Charged: date and lock are fixed; a date in the past would end the concealing.
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
          <span className="text-xs text-muted">{t('blocks.sigil.loaded')}</span>
          <Button tone="neutral" small onClick={() => onChange({ ...charge, loaded: false })}>{t('creation.unloadSigil')}</Button>
        </div>
      )}
    </div>
  );
}
