import { useTranslation } from 'react-i18next';
import { elementLabel } from '../../lib/blocks/blockAttrs';
import {
  activeElements, imageFromSlot, isElementEmpty, isHiddenInRead, isSigilKind, isSlotKind, linkFromSlot, parseFields,
  serializeFields,
  type ElementDef, type FieldValue, type FieldsModel,
} from '../../lib/blocks/fields';
import { formatIsoDateLong } from '../../lib/formatDate';
import UnknownBlock from './UnknownBlock';
import { LinkTarget } from './BlockLink';
import { AltarFieldReader } from './AltarField';
import FieldSlotEditor from './FieldSlotEditor';
import { imageSrc } from '../../lib/images';
import { MOON_PHASE_SYMBOLS } from '../../lib/moonPhase';
import type { MoonPhase } from '../../types';
import { useFieldFallbackText } from './useFieldFallbackText';
import FieldValueEditor, { CheckButton, ToggleSwitch } from './FieldValueEditor';
import SigilPart from './SigilPart';
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
 * schreibgeschützt oder eine geladene Sigille sperrt den Eintrag.
 *
 * Sigillen-Teile (Rechner, Zeichnung, Ladung) rendert `SigilPart` mit den
 * Komponenten der gleichnamigen Blöcke. Laden und Entladen gehen im
 * Lesemodus immer — auch bei „komplett schreibgeschützt" oder gesperrtem
 * Eintrag, sonst ließe sich eine Sigille nie mehr entladen.
 */
export default function FieldsBlock({ block, blocks, isEditing, onBlockChange, onPersist, sigil }: BlockViewProps) {
  const { t } = useTranslation();
  const text = useFieldFallbackText();
  const model = parseFields(block);

  // Unlesbares JSON: anzeigen wie einen unbekannten Block und nie schreiben —
  // die erste Änderung überschriebe sonst die Originaldaten mit „leer".
  if (model.broken) return <UnknownBlock block={block} />;

  const canActInRead = !isEditing && !model.display.readOnly && !sigil.lockEntry && !!onPersist;
  const write = (next: FieldsModel) => {
    const nextBlock = serializeFields(block, next, text);
    if (isEditing) onBlockChange(nextBlock);
    else onPersist?.(nextBlock);
  };
  const persist = onPersist ? (next: FieldsModel) => onPersist(serializeFields(block, next, text)) : undefined;
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
        // Altar und Sigille brauchen die volle Breite: Beschriftung darüber statt daneben.
        <div
          key={element.id}
          className={element.kind === 'altar' || isSigilKind(element.kind) ? 'block-field block-field--wide' : 'block-field'}
        >
          <div className="block-field-label">{elementLabel(t, element)}</div>
          <div className="block-field-value">
            {isSigilKind(element.kind) ? (
              <SigilPart
                element={{ ...element, kind: element.kind }}
                block={block}
                blocks={blocks}
                model={model}
                isEditing={isEditing}
                sigil={sigil}
                write={write}
                // Nur die Ladung darf trotz Sperre und „schreibgeschützt" — und
                // die Zeichnung, deren Speichern „Fertig" überdauert hat.
                persist={element.kind === 'sigilCharge' || element.kind === 'sigilCanvas' ? persist : undefined}
              />
            ) : isEditing ? (
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
  if (isSlotKind(element.kind)) return <FieldSlotEditor element={element} slot={model.slots[element.id]} onChange={setSlot} />;
  return <FieldValueEditor element={element} value={model.values[element.id]} onChange={set} />;
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
    case 'altar':
      return <AltarFieldReader slot={model.slots[element.id]} />;
  }
}

