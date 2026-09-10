import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Zap } from 'lucide-react';
import Button from '../ui/Button';
import Dropdown from '../ui/Dropdown';
import { linkFromSlot } from '../../lib/blocks/fields';
import {
  localDate, parseSigilCharge, serializeSigilCharge, type SigilCharge, type SigilLockScope,
} from '../../lib/blocks/sigil';
import { formatEntryDateLong } from '../../lib/formatDate';
import { OP_PROP_SELECT_CLASSES } from '../../lib/styleClasses';
import UnknownBlock from './UnknownBlock';
import { LinkEditor, LinkTarget } from './BlockLink';
import type { BlockViewProps } from './blockViews';

type ChargeData = Omit<SigilCharge, 'broken'>;

/**
 * Die Ladung der Sigille: Zieldatum, Ladetechnik (ein Link-Chip) und was
 * „geladen" sperrt. Laden und Entladen gehen im Lesemodus, mit Bestätigung —
 * geladen sperrt den Eintrag (oder nur Rechner und Zeichnung) und verbirgt
 * die Sigille bis zum Datum.
 */
export default function SigilChargeBlock({ block, isEditing, onBlockChange, onPersist, sigil }: BlockViewProps) {
  const charge = parseSigilCharge(block);
  if (charge.broken) return <UnknownBlock block={block} />;
  const { broken: _broken, ...data } = charge;
  const write = (next: ChargeData) => serializeSigilCharge(block, next);
  if (isEditing) return <ChargeEditor charge={data} onChange={(next) => onBlockChange(write(next))} />;
  return (
    <ChargeReader
      charge={data}
      concealed={sigil.concealed}
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

function ChargeReader({ charge, concealed, onPersist }: {
  charge: ChargeData;
  concealed: boolean;
  onPersist?: (next: ChargeData) => void;
}) {
  const { t } = useTranslation();
  const date = charge.revealDate ? formatEntryDateLong(localDate(charge.revealDate)) : null;
  const status = charge.loaded
    ? `${t('blocks.sigil.loaded')} · ${concealed ? t('creation.hiddenUntilDate', { date: date ?? '—' }) : t('blocks.sigil.revealedSince', { date: date ?? '—' })}`
    : t('blocks.sigil.notLoaded');

  return (
    <div className="block-fields">
      <div className="block-field">
        <div className="block-field-label">{t('creation.targetDate')}</div>
        <div className="block-field-value">{date ?? <span className="block-field-hint">{t('blocks.sigil.noRevealDate')}</span>}</div>
      </div>
      <Technique html={charge.technique} />
      <p className={`block-sigil-status ${charge.loaded ? 'block-sigil-status--loaded' : ''}`}>
        <Zap size={12} className="flex-shrink-0" />
        <span>{status}</span>
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
          {charge.loaded ? t('blocks.sigil.unloadConfirm') : t('blocks.sigil.loadConfirm', { date: date ?? '—' })}
        </span>
        <Button tone={charge.loaded ? 'neutral' : 'jade'} small onClick={confirm}>
          {charge.loaded ? t('creation.unloadSigil') : t('creation.loadSigille')}
        </Button>
        <Button tone="neutral" small onClick={() => setConfirming(false)}>{t('common.cancel')}</Button>
      </div>
    );
  }
  if (charge.loaded) {
    return <Button tone="neutral" small onClick={() => setConfirming(true)}>{t('creation.unloadSigil')}</Button>;
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
      <Button
        tone="jade"
        small
        disabled={!charge.revealDate || countdown != null}
        title={charge.revealDate ? undefined : t('blocks.sigil.noRevealDate')}
        onClick={() => setConfirming(true)}
      >
        {countdown != null ? `${countdown}s` : t('creation.loadSigille')}
      </Button>
    </div>
  );
}

function ChargeEditor({ charge, onChange }: { charge: ChargeData; onChange: (next: ChargeData) => void }) {
  const { t } = useTranslation();
  // Geladen: Datum und Sperre stehen fest — ein Datum in der Vergangenheit höbe das Verbergen auf.
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
          <span className="text-xs text-stone-400">{t('blocks.sigil.loaded')}</span>
          <Button tone="neutral" small onClick={() => onChange({ ...charge, loaded: false })}>{t('creation.unloadSigil')}</Button>
        </div>
      )}
    </div>
  );
}
