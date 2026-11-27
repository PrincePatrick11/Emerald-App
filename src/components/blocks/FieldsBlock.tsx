import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  elementLabel, isElementEmpty, isHiddenInRead, isSlotKind, parseFields, serializeFields,
  type ElementDef, type FieldValue, type FieldsModel,
} from '../../lib/blocks/fields';
import { imageFromSlot, linkFromSlot, textEditorKey } from '../../lib/blocks/toolkit';
import { isBlankContent } from '../../lib/internalLinkHtml';
import { formatIsoDateLong } from '../../lib/formatDate';
import { TextEditor } from '../editors/text';
import { LinkTarget } from './BlockLink';
import FieldSlotEditor from './FieldSlotEditor';
import BlockFieldRow from './BlockFieldRow';
import { imageSrc } from '../../lib/images';
import { useFieldFallbackText } from './useFieldFallbackText';
import FieldValueEditor, { CheckButton, ToggleSwitch } from './FieldValueEditor';
import type { BlockViewProps } from './blockViews';

type Setter = (value: FieldValue | undefined) => void;

/**
 * The field block: labelled values. In edit mode inputs per
 * element kind, in read mode a calm list "Label — Value", empty
 * elements hidden according to the display rules.
 *
 * Controlled: the model is read from the block on every render, every
 * change writes a new block (JSON + fallback) back via `onBlockChange`.
 * In read mode checklist and yes/no may be toggled; that
 * goes via `onPersist` directly into the entry, unless the block is completely
 * read-only or another block locks the entry (a loaded sigil).
 *
 * A text element is the same editor as the text block (`FieldText`); its
 * HTML sits in the slot and is only written in edit mode.
 */
export default function FieldsBlock({ block, isEditing, onBlockChange, onPersist, effects }: BlockViewProps) {
  const { t } = useTranslation();
  const text = useFieldFallbackText();
  const model = parseFields(block);

  const canActInRead = !isEditing && !model.display.readOnly && !effects.lockEntry && !!onPersist;
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

  const elements = isEditing ? model.elements : model.elements.filter((el) => !isHiddenInRead(el, model));
  if (elements.length === 0) return null;

  return (
    <div className={isEditing ? 'block-fields block-fields--edit' : 'block-fields'}>
      {elements.map((element) => (
        // Text needs the full width: label above instead of beside.
        <BlockFieldRow key={element.id} label={elementLabel(t, element)} wide={element.kind === 'text'}>
          {element.kind === 'text' ? (
            // One tree for reading and editing, as with the text block: the editor only switches.
            <FieldText
              editorKey={textEditorKey(block.id, element.id)}
              initialContent={model.slots[element.id] ?? ''}
              isEditing={isEditing}
              // Via the block, not only into the ref like the text block: the
              // sidebar writes the whole model from the block it
              // holds; if that were stale, a label change would delete what was typed.
              onChange={(html) => {
                if (isEditing) setSlot(element)(isBlankContent(html) ? null : html);
              }}
            />
          ) : isEditing ? (
            <FieldEditor element={element} model={model} set={setValue(element)} setSlot={setSlot(element)} />
          ) : (
            <FieldReader element={element} model={model} set={canActInRead ? setValue(element) : undefined} />
          )}
        </BlockFieldRow>
      ))}
    </div>
  );
}

/* ---------------- Text ---------------- */

/**
 * The text element: the text block's editor, reporting to the stack's host under
 * `<block ID>:<element ID>`, so it gets toolbar, link requests
 * and drops like a text block. Uncontrolled as there: `initialContent` is read
 * once; `onChange` goes via a ref because the editor keeps the
 * callback of its first mount.
 */
function FieldText({ editorKey, initialContent, isEditing, onChange }: {
  editorKey: string;
  initialContent: string;
  isEditing: boolean;
  onChange: (html: string) => void;
}) {
  const { t } = useTranslation();
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  return (
    <TextEditor
      initialContent={initialContent}
      placeholder={t('blocks.types.text.placeholder')}
      onChange={(html) => onChangeRef.current(html)}
      editable={isEditing}
      hostKey={editorKey}
    />
  );
}

/* ---------------- Editing ---------------- */

function FieldEditor({ element, model, set, setSlot }: {
  element: ElementDef;
  model: FieldsModel;
  set: Setter;
  setSlot: (html: string | null) => void;
}) {
  if (isSlotKind(element.kind)) return <FieldSlotEditor element={element} slot={model.slots[element.id]} onChange={setSlot} />;
  return <FieldValueEditor element={element} value={model.values[element.id]} onChange={set} />;
}

/* ---------------- Reading ---------------- */

function FieldReader({ element, model, set }: { element: ElementDef; model: FieldsModel; set?: Setter }) {
  const { i18n } = useTranslation();
  const value = model.values[element.id];
  // Invalid values (deleted option, only whitespace) show
  // nothing; the same rule by which the element counts as empty.
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
    case 'link': {
      const target = linkFromSlot(model.slots[element.id]);
      return target ? <LinkTarget target={target} /> : null;
    }
    case 'image': {
      const filename = imageFromSlot(model.slots[element.id]);
      return filename ? <img src={imageSrc(filename)} alt="" className="block-field-image" /> : null;
    }
    case 'text': // FieldText
      return null;
  }
}

