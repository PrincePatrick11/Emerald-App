import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckSquare, ImagePlus, Plus, Square, ToggleLeft, ToggleRight, X } from 'lucide-react';
import Dropdown from '../ui/Dropdown';
import { elementLabel } from '../../lib/blocks/blockAttrs';
import {
  activeElements, imageFromSlot, isElementEmpty, isHiddenInRead, linkFromSlot, parseFields, serializeFields,
  type ChecklistItem, type ElementDef, type FieldValue, type FieldsModel,
} from '../../lib/blocks/fields';
import { formatIsoDateLong } from '../../lib/formatDate';
import UnknownBlock from './UnknownBlock';
import { escapeHtml } from '../../lib/internalLinkHtml';
import { LinkEditor, LinkTarget } from './BlockLink';
import { imageSrc, saveImage } from '../../lib/images';
import { ACCEPTED_IMAGE_MIME, generateId, isAcceptedImageFile, readFileAsDataUrl } from '../../lib/helpers';
import { MOON_PHASE_ORDER, MOON_PHASE_SYMBOLS } from '../../lib/moonPhase';
import { OP_PROP_SELECT_CLASSES } from '../../lib/styleClasses';
import type { MoonPhase } from '../../types';
import { useFieldFallbackText } from './useFieldFallbackText';
import type { BlockViewProps } from './blockViews';

type Setter = (value: FieldValue | undefined) => void;

/**
 * Der Feldblock: beschriftete Werte. Im Bearbeitungsmodus Eingaben je
 * Elementart, im Lesemodus eine ruhige Liste „Beschriftung — Wert", leere
 * Elemente nach den Anzeigeregeln ausgeblendet.
 *
 * Kontrolliert: das Modell wird bei jedem Render aus dem Block gelesen, jede
 * Änderung schreibt einen neuen Block (JSON + Fallback) über `onBlockChange`
 * zurück. Im Lesemodus dürfen Checkliste und Ja/Nein geschaltet werden — das
 * geht über `onPersist` direkt in den Eintrag, außer der Block ist komplett
 * schreibgeschützt.
 */
export default function FieldsBlock({ block, isEditing, onBlockChange, onPersist }: BlockViewProps) {
  const { t } = useTranslation();
  const text = useFieldFallbackText();
  const model = parseFields(block);

  // Unlesbares JSON: anzeigen wie einen unbekannten Block und nie schreiben —
  // die erste Änderung überschriebe sonst die Originaldaten mit „leer".
  if (model.broken) return <UnknownBlock block={block} />;

  const canActInRead = !isEditing && !model.display.readOnly && !!onPersist;
  const write = (next: FieldsModel) => {
    const nextBlock = serializeFields(block, next, text);
    if (isEditing) onBlockChange(nextBlock);
    else onPersist?.(nextBlock);
  };
  const setValue = (element: ElementDef): Setter => (value) => {
    const values = { ...model.values };
    if (value === undefined) delete values[element.id];
    else values[element.id] = value;
    write({ ...model, values });
  };
  const setSlot = (element: ElementDef) => (html: string | null) => {
    const slots = { ...model.slots };
    if (html === null) delete slots[element.id];
    else slots[element.id] = html;
    write({ ...model, slots });
  };

  const elements = isEditing ? activeElements(model) : model.elements.filter((el) => !isHiddenInRead(el, model));
  if (elements.length === 0) return null;

  return (
    <div className={isEditing ? 'block-fields block-fields--edit' : 'block-fields'}>
      {elements.map((element) => (
        <div key={element.id} className="block-field">
          <div className="block-field-label">{elementLabel(t, element)}</div>
          <div className="block-field-value">
            {isEditing ? (
              <FieldEditor element={element} model={model} set={setValue(element)} setSlot={setSlot(element)} />
            ) : (
              <FieldReader element={element} model={model} set={canActInRead ? setValue(element) : undefined} />
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ---------------- Bearbeiten ---------------- */

function FieldEditor({ element, model, set, setSlot }: {
  element: ElementDef;
  model: FieldsModel;
  set: Setter;
  setSlot: (html: string | null) => void;
}) {
  const { t } = useTranslation();
  const value = model.values[element.id];

  switch (element.kind) {
    case 'shorttext':
      return (
        <input
          className={OP_PROP_SELECT_CLASSES}
          value={typeof value === 'string' ? value : ''}
          placeholder={elementLabel(t, element)}
          onChange={(e) => set(e.target.value || undefined)}
        />
      );
    case 'number':
      return (
        <input
          type="number"
          className={OP_PROP_SELECT_CLASSES}
          value={typeof value === 'number' ? value : ''}
          onChange={(e) => set(Number.isFinite(e.target.valueAsNumber) ? e.target.valueAsNumber : undefined)}
        />
      );
    case 'date':
      return (
        <input
          type="date"
          className={OP_PROP_SELECT_CLASSES}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => set(e.target.value || undefined)}
        />
      );
    case 'select': {
      const options = element.options ?? [];
      if (options.length === 0) return <p className="block-field-hint">{t('blocks.fields.noOptions')}</p>;
      return (
        <Dropdown<string>
          portal
          // Eine gelöschte Option zeigt „Auswählen …" statt ihrer rohen ID.
          value={isElementEmpty(element, model) ? '' : (value as string)}
          onChange={(v) => set(v || undefined)}
          options={[
            { value: '', label: t('blocks.fields.choose') },
            ...options.map((o) => ({ value: o.id, label: o.label || t('blocks.fields.optionPlaceholder') })),
          ]}
        />
      );
    }
    case 'toggle':
      return <ToggleSwitch value={value === true} onChange={(v) => set(v)} />;
    case 'checklist':
      return <ChecklistEditor items={Array.isArray(value) ? value : []} onChange={(items) => set(items.length ? items : undefined)} />;
    case 'moon':
      return (
        <Dropdown<string>
          portal
          value={isElementEmpty(element, model) ? '' : (value as string)}
          onChange={(v) => set(v || undefined)}
          options={[
            { value: '', label: t('blocks.fields.choose') },
            ...MOON_PHASE_ORDER.map((p) => ({ value: p, label: t(`moonPhase.${p}`), emoji: MOON_PHASE_SYMBOLS[p] })),
          ]}
        />
      );
    case 'link':
      return <LinkEditor slot={model.slots[element.id]} onChange={setSlot} />;
    case 'image':
      return <ImageEditor slot={model.slots[element.id]} onChange={setSlot} />;
  }
}

function ToggleSwitch({ value, onChange, disabled = false }: { value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  const { t } = useTranslation();
  const Icon = value ? ToggleRight : ToggleLeft;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      disabled={disabled}
      onClick={() => onChange(!value)}
      className={`block-toggle ${value ? 'block-toggle--on' : ''}`}
    >
      <Icon size={14} />
      <span>{value ? t('blocks.fields.yes') : t('blocks.fields.no')}</span>
    </button>
  );
}

function ChecklistEditor({ items, onChange }: { items: ChecklistItem[]; onChange: (items: ChecklistItem[]) => void }) {
  const { t } = useTranslation();
  const update = (id: string, patch: Partial<ChecklistItem>) =>
    onChange(items.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  return (
    <div className="block-checklist">
      {items.map((item) => (
        <div key={item.id} className="block-checklist-item">
          <CheckButton checked={item.checked} onToggle={() => update(item.id, { checked: !item.checked })} />
          <input
            className="block-checklist-input selectable"
            value={item.text}
            placeholder={t('blocks.fields.itemPlaceholder')}
            onChange={(e) => update(item.id, { text: e.target.value })}
          />
          <button
            type="button"
            className="block-row-action"
            onClick={() => onChange(items.filter((i) => i.id !== item.id))}
            title={t('blocks.fields.removeItem')}
            aria-label={t('blocks.fields.removeItem')}
          >
            <X size={12} />
          </button>
        </div>
      ))}
      <button
        type="button"
        className="block-insert-btn"
        onClick={() => onChange([...items, { id: generateId(), text: '', checked: false }])}
      >
        <Plus size={12} />
        <span>{t('blocks.fields.addItem')}</span>
      </button>
    </div>
  );
}

function CheckButton({ checked, onToggle }: { checked: boolean; onToggle?: () => void }) {
  const Icon = checked ? CheckSquare : Square;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      disabled={!onToggle}
      onClick={onToggle}
      className={`block-check ${checked ? 'block-check--on' : ''}`}
    >
      <Icon size={14} />
    </button>
  );
}

function ImageEditor({ slot, onChange }: { slot: string | undefined; onChange: (html: string | null) => void }) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const filename = imageFromSlot(slot);

  const showError = (key: string) => {
    setError(key);
    window.setTimeout(() => setError(null), 2500);
  };

  const pick = async (file: File | undefined) => {
    if (!file) return;
    if (!isAcceptedImageFile(file)) {
      showError('common.unsupportedImageFormat');
      return;
    }
    try {
      const name = await saveImage(await readFileAsDataUrl(file));
      // Als echtes `<img src>` im Slot — so findet das Bild-Aufräumen die Datei.
      onChange(`<img src="${escapeHtml(name)}">`);
    } catch (e) {
      console.error('Failed to save image:', e);
      showError('blocks.fields.imageFailed');
    }
  };

  return (
    <div className="block-image-field">
      {filename && <img src={imageSrc(filename)} alt="" className="block-field-image" />}
      <div className="flex items-center gap-2">
        {/* „Ändern"/„Entfernen" wie die übrigen Bild-Picker (Favicon, Banner);
            nur der leere Zustand sagt „Bild wählen" — „Titelbild hinzufügen"
            wäre hier falsch. */}
        <button type="button" className="block-insert-btn" onClick={() => inputRef.current?.click()}>
          <ImagePlus size={12} />
          <span>{filename ? t('properties.change') : t('blocks.fields.chooseImage')}</span>
        </button>
        {filename && (
          <button type="button" className="block-insert-btn" onClick={() => onChange(null)}>
            <X size={12} />
            <span>{t('properties.remove')}</span>
          </button>
        )}
        {error && <span className="block-field-error">{t(error)}</span>}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_IMAGE_MIME}
        className="hidden"
        onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ''; }}
      />
    </div>
  );
}

/* ---------------- Lesen ---------------- */

function FieldReader({ element, model, set }: { element: ElementDef; model: FieldsModel; set?: Setter }) {
  const { t, i18n } = useTranslation();
  const value = model.values[element.id];
  // Ungültiges (gelöschte Option, unbekannte Mondphase, nur Leerzeichen) zeigt
  // nichts — dieselbe Regel, nach der das Element als leer gilt.
  if (isElementEmpty(element, model)) return null;

  switch (element.kind) {
    case 'shorttext':
      return <span>{value as string}</span>;
    case 'number':
      return <span>{(value as number).toLocaleString(i18n.language)}</span>;
    case 'date':
      return <span>{formatIsoDateLong(value as string)}</span>;
    case 'select':
      return <span>{element.options?.find((o) => o.id === value)?.label ?? ''}</span>;
    case 'toggle':
      return <ToggleSwitch value={value === true} onChange={(v) => set?.(v)} disabled={!set} />;
    case 'checklist': {
      const items = Array.isArray(value) ? value : [];
      return (
        <div className="block-checklist">
          {items.map((item) => (
            <div key={item.id} className={`block-checklist-item ${item.checked ? 'block-checklist-item--done' : ''}`}>
              <CheckButton
                checked={item.checked}
                onToggle={set ? () => set(items.map((i) => (i.id === item.id ? { ...i, checked: !i.checked } : i))) : undefined}
              />
              <span>{item.text}</span>
            </div>
          ))}
        </div>
      );
    }
    case 'moon':
      return <span>{MOON_PHASE_SYMBOLS[value as MoonPhase]} {t(`moonPhase.${value}`)}</span>;
    case 'link': {
      const target = linkFromSlot(model.slots[element.id]);
      return target ? <LinkTarget target={target} /> : null;
    }
    case 'image': {
      const filename = imageFromSlot(model.slots[element.id]);
      return filename ? <img src={imageSrc(filename)} alt="" className="block-field-image" /> : null;
    }
  }
}

