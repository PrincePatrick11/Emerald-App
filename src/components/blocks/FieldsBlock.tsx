import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  elementKind, elementLabel, fieldStored, isElementEmpty, isHiddenInRead, parseFields, serializeFields, withFieldStored,
  type ElementDef, type FieldValue, type FieldsModel,
} from '../../lib/blocks/fields';
import { textEditorKey } from '../../lib/blocks/toolkit';
import { TextEditor } from '../editors/text';
import BlockFieldRow from './BlockFieldRow';
import { fieldKindView } from './fieldKindViews';
import { useFieldFallbackText } from './useFieldFallbackText';
import type { BlockViewProps } from './blockViews';

/**
 * The field block: labelled values. In edit mode each field's input, in read
 * mode a calm list "Label — Value", empty elements hidden according to the
 * display rules. What a field shows its kind's views say (`fieldKindViews.ts`);
 * this component knows no kind.
 *
 * Controlled: the model is read from the block on every render, every
 * change writes a new block (JSON + fallback) back via `onBlockChange`.
 * In read mode a kind may let its field be changed (a checklist ticked, a
 * yes/no switched); that goes via `onPersist` directly into the entry, unless
 * the block is completely read-only or another block locks the entry (a loaded sigil).
 *
 * A field whose kind is a text editor is the same editor as the text block
 * (`FieldText`); its HTML sits in the slot and is only written in edit mode.
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
  const setStored = (element: ElementDef) => (stored: FieldValue | undefined) => write(withFieldStored(model, element, stored));

  const elements = isEditing ? model.elements : model.elements.filter((el) => !isHiddenInRead(el, model));
  if (elements.length === 0) return null;

  return (
    <div className={isEditing ? 'block-fields block-fields--edit' : 'block-fields'}>
      {elements.map((element) => {
        const kind = elementKind(element);
        const isText = kind.textEditor === true;
        return (
          // Text needs the full width: label above instead of beside.
          <BlockFieldRow key={element.id} label={elementLabel(t, element)} wide={isText}>
            {isText ? (
              // One tree for reading and editing, as with the text block: the editor only switches.
              <FieldText
                editorKey={textEditorKey(block.id, element.id)}
                initialContent={(fieldStored(element, model) as string | undefined) ?? ''}
                isEditing={isEditing}
                // Via the block, not only into the ref like the text block: the
                // sidebar writes the whole model from the block it
                // holds; if that were stale, a label change would delete what was typed.
                onChange={(html) => {
                  // What its kind counts as empty (an empty heading, a lone bullet) is not kept.
                  if (isEditing) setStored(element)(kind.isEmpty({ element, stored: html }) ? undefined : html);
                }}
              />
            ) : isEditing ? (
              <FieldInput element={element} model={model} onChange={setStored(element)} />
            ) : (
              <FieldReader element={element} model={model} onChange={canActInRead ? setStored(element) : undefined} />
            )}
          </BlockFieldRow>
        );
      })}
    </div>
  );
}

/* ---------------- Text ---------------- */

/**
 * A text field: the text block's editor, reporting to the stack's host under
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

/* ---------------- Editing and reading ---------------- */

function FieldInput({ element, model, onChange }: {
  element: ElementDef;
  model: FieldsModel;
  onChange: (stored: FieldValue | undefined) => void;
}) {
  const Input = fieldKindView(element)?.Input;
  return Input ? <Input element={element} stored={fieldStored(element, model)} onChange={onChange} /> : null;
}

function FieldReader({ element, model, onChange }: {
  element: ElementDef;
  model: FieldsModel;
  onChange?: (stored: FieldValue | undefined) => void;
}) {
  const Read = fieldKindView(element)?.Read;
  // Invalid values (deleted option, only whitespace) show
  // nothing; the same rule by which the element counts as empty.
  if (!Read || isElementEmpty(element, model)) return null;
  return <Read element={element} stored={fieldStored(element, model)} onChange={onChange} />;
}
