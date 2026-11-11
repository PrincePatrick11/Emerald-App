import { useState, type MouseEvent } from 'react';
import { Reorder, useDragControls } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { EyeOff, GripVertical, Heading, Lock, Plus, Smile, Trash2 } from 'lucide-react';
import ContextMenu, { type ContextMenuAction } from '../ui/ContextMenu';
import LibraryPageFrame from '../ui/LibraryPageFrame';
import SidebarSection from '../sidebar/fields/SidebarSection';
import { PropertiesSection } from '../sidebar/fields/EntryReadSections';
import { EditSidebarBody, MediaPropertyRow } from '../sidebar/fields/EditProperties';
import { SwitchRow } from '../ui/Switch';
import { useBlockDefinitionStore } from '../../store/blockDefinitionStore';
import { useBlockDraftStore, type DefinitionDraft } from '../../store/draftStore';
import { useDraftPage } from '../../hooks/useDraftPage';
import { useShrunkIcon } from '../../hooks/useShrunkIcon';
import {
  canBeEmpty, defaultFromSlot, OFFERED_ELEMENT_KINDS, elementKindLabelKey, isSigilKind, isSlotKind, slotFromDefault,
  type ElementDef, type ElementKind, type FieldValue,
} from '../../lib/blocks/fields';
import { ELEMENT_KIND_ICONS } from '../../lib/blocks/presets';
import { definitionLabel } from '../../lib/blocks/blockAttrs';
import { DEFAULT_DEFINITION_ICON, type BlockDefinition, type DefinitionDisplay } from '../../lib/blocks/definitions';
import { generateId } from '../../lib/helpers';
import { REORDER_SPRING } from '../../lib/motion';
import { OP_PROP_SELECT_CLASSES } from '../../lib/styleClasses';
import OptionsEditor from './OptionsEditor';
import BlockCheckbox from './BlockCheckbox';
import FieldValueEditor from './FieldValueEditor';
import FieldSlotEditor from './FieldSlotEditor';
import SigilPartSettings from './SigilPartSettings';

const draftOf = (d: DefinitionDraft): DefinitionDraft => ({
  name: d.name, icon: d.icon, elements: d.elements, display: d.display,
});

interface Props {
  definition: BlockDefinition;
  /** Back to the list. The back link above the title leaves the draft behind (the list
   *  shows it as unsaved); "Done" and "Cancel" settle it first. */
  onClose: () => void;
  onDelete: () => void;
  /** Just created with "New": "Cancel" moves it to the trash (`onDelete`). */
  isNew?: boolean;
}

/**
 * A custom block's page (`LibraryPageFrame`): name as title,
 * below it the fields (add, name, sort,
 * remove); in the sidebar icon and display rules.
 *
 * A draft is edited (`useDraftPage`); only "Done" writes it. Nothing here
 * reaches an entry: what is already inserted is a copy of its own.
 */
export default function BlockDefinitionEditor({ definition, onClose, onDelete, isNew }: Props) {
  const { t } = useTranslation();
  const updateDefinition = useBlockDefinitionStore((s) => s.updateDefinition);
  const { draft, setDraft, patch, dirty, busy, finish, cancel } = useDraftPage({
    store: useBlockDraftStore,
    viewType: 'blocks',
    id: definition.id,
    label: (current) => definitionLabel(t, current),
    saved: draftOf(definition),
    save: updateDefinition,
    onClose,
    onCancelNew: isNew ? onDelete : undefined,
    logTag: 'BlockDefinitionEditor',
  });
  const [menu, setMenu] = useState<{ x: number; y: number; actions: ContextMenuAction[] } | null>(null);

  const patchDisplay = (p: Partial<DefinitionDisplay>) => setDraft((d) => ({ ...d, display: { ...d.display, ...p } }));
  const setElements = (fn: (elements: ElementDef[]) => ElementDef[]) =>
    setDraft((d) => ({ ...d, elements: fn(d.elements) }));
  const patchElement = (id: string, p: Partial<ElementDef>) =>
    setElements((els) => els.map((e) => (e.id === id ? { ...e, ...p } : e)));

  const addElement = (kind: ElementKind) => {
    const element: ElementDef = { id: generateId(), kind, label: '' };
    if (kind === 'select') element.options = [];
    setElements((els) => [...els, element]);
  };
  const removeElement = (id: string) => setElements((els) => els.filter((e) => e.id !== id));
  const reorderElements = (ids: string[]) => setElements((els) => {
    const byId = new Map(els.map((e) => [e.id, e]));
    return ids.some((id) => !byId.has(id)) ? els : ids.map((id) => byId.get(id)!);
  });

  const openAddMenu = (e: MouseEvent) => setMenu({
    x: e.clientX,
    y: e.clientY,
    actions: OFFERED_ELEMENT_KINDS.map((kind) => {
      const Icon = ELEMENT_KIND_ICONS[kind];
      return { label: t(elementKindLabelKey(kind)), icon: <Icon size={12} />, onClick: () => addElement(kind) };
    }),
  });

  const setIcon = useShrunkIcon((icon) => patch({ icon }), 'BlockDefinitionEditor');

  const sidebar = (
    <EditSidebarBody>
      <PropertiesSection>
        {/* The fallback is the default icon: without one the block would appear in menus without a glyph. */}
        <MediaPropertyRow
          rowIcon={<Smile size={14} />}
          label={t('properties.icon')}
          kind="icon"
          value={draft.icon}
          onChange={(icon) => void setIcon(icon)}
          fallback={DEFAULT_DEFINITION_ICON}
        />
      </PropertiesSection>

      <SidebarSection storageKey="block-display-open" label={t('blocks.library.display')}>
        <SwitchRow
          variant="sidebar"
          icon={EyeOff}
          label={t('blocks.fields.hideEmpty')}
          checked={draft.display.readHideEmpty}
          onChange={(v) => patchDisplay({ readHideEmpty: v })}
        />
        <SwitchRow
          variant="sidebar"
          icon={Heading}
          label={t('blocks.showTitle')}
          checked={draft.display.showTitle}
          onChange={(v) => patchDisplay({ showTitle: v })}
        />
        <SwitchRow
          variant="sidebar"
          icon={Lock}
          label={t('blocks.fields.readOnly')}
          hint={t('blocks.fields.readOnlyHint')}
          checked={draft.display.readOnly}
          onChange={(v) => patchDisplay({ readOnly: v })}
        />
      </SidebarSection>
    </EditSidebarBody>
  );

  return (
    <LibraryPageFrame
      backLabel={t('nav.blocks')}
      onBack={onClose}
      draft={{ dirty, busy, onDone: () => void finish(), onCancel: cancel, onDelete }}
      name={draft.name}
      nameLabel={t('blocks.library.name')}
      namePlaceholder={t('blocks.library.namePlaceholder')}
      onNameChange={(name) => patch({ name })}
      sidebar={sidebar}
    >
      <div className="max-w-3xl space-y-6">
        {/* Fields */}
        <section className="space-y-2">
          <p className="label-xs">{t('blocks.library.fields')}</p>
          <Reorder.Group as="div" axis="y" values={draft.elements.map((e) => e.id)} onReorder={reorderElements} className="space-y-2">
            {draft.elements.map((element) => (
              <ElementRow
                key={element.id}
                element={element}
                siblings={draft.elements}
                blockHidesEmpty={draft.display.readHideEmpty}
                onPatch={(p) => patchElement(element.id, p)}
                onRemove={() => removeElement(element.id)}
              />
            ))}
          </Reorder.Group>
          <button type="button" className="block-insert-btn" onClick={openAddMenu}>
            <Plus size={12} />
            <span>{t('blocks.library.addField')}</span>
          </button>
        </section>
      </div>

      {menu && <ContextMenu x={menu.x} y={menu.y} actions={menu.actions} onClose={() => setMenu(null)} />}
    </LibraryPageFrame>
  );
}

function ElementRow({ element, siblings, blockHidesEmpty, onPatch, onRemove }: {
  element: ElementDef;
  /** The visible elements of the block; the charge picks from them what it conceals. */
  siblings: readonly ElementDef[];
  blockHidesEmpty: boolean;
  onPatch: (p: Partial<ElementDef>) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const controls = useDragControls();
  const Icon = ELEMENT_KIND_ICONS[element.kind];
  const hides = element.hideWhenEmpty ?? blockHidesEmpty;
  return (
    <Reorder.Item
      as="div"
      value={element.id}
      dragListener={false}
      dragControls={controls}
      transition={REORDER_SPRING}
      style={{ position: 'relative' }}
      className="block-def-element"
    >
      <div className="flex items-center gap-2">
        <span
          onPointerDown={(e) => controls.start(e)}
          className="block-row-action cursor-grab active:cursor-grabbing touch-none"
          title={t('blocks.dragToMove')}
        >
          <GripVertical size={12} />
        </span>
        <span className="block-def-kind" title={t(elementKindLabelKey(element.kind))}>
          <Icon size={12} />
        </span>
        <input
          className={OP_PROP_SELECT_CLASSES}
          value={element.label}
          placeholder={t(elementKindLabelKey(element.kind))}
          aria-label={t('blocks.fields.label')}
          onChange={(e) => onPatch({ label: e.target.value })}
        />
        <button
          type="button"
          className="block-row-action"
          onClick={onRemove}
          title={t('blocks.library.removeField')}
          aria-label={t('blocks.library.removeField')}
        >
          <Trash2 size={12} />
        </button>
      </div>
      <div className="block-def-element-body">
        {element.kind === 'select' && (
          <OptionsEditor options={element.options ?? []} onChange={(options) => onPatch({ options })} />
        )}
        {canBeEmpty(element.kind) && (
          <BlockCheckbox
            checked={hides}
            // Same as the block rule: no value of its own; the block's rule applies.
            onChange={(v) => onPatch({ hideWhenEmpty: v === blockHidesEmpty ? undefined : v })}
            label={t('blocks.fields.hideEmpty')}
          />
        )}
        {/* Text has no default: it would be markup in the definition. */}
        {isSigilKind(element.kind)
          ? <SigilPartSettings element={element} siblings={siblings} onPatch={onPatch} />
          : element.kind !== 'text' && <PrefillEditor element={element} onPatch={onPatch} />}
      </div>
    </Reorder.Item>
  );
}

/**
 * The default of a field: when checked, every new copy gets this value,
 * a checklist with its items, yes/no set to "Yes". Whether it is checked is held by
 * the builder itself: an emptied input (the number while retyping) should not
 * immediately collapse the field again.
 */
function PrefillEditor({ element, onPatch }: { element: ElementDef; onPatch: (p: Partial<ElementDef>) => void }) {
  const { t } = useTranslation();
  // A default being present means checked; `armed` keeps the check while the input is still empty.
  const [armed, setArmed] = useState(false);
  const on = armed || element.defaultValue !== undefined;
  const toggle = (next: boolean) => {
    setArmed(next);
    // Yes/no is already "No" without a value; whoever prefills wants "Yes".
    onPatch({ defaultValue: next && element.kind === 'toggle' ? true : undefined });
  };
  return (
    <>
      <BlockCheckbox checked={on} onChange={toggle} label={t('blocks.library.prefill')} hint={t('blocks.library.prefillHint')} />
      {on && (isSlotKind(element.kind) ? (
        <FieldSlotEditor
          element={element}
          slot={slotFromDefault(element) ?? undefined}
          onChange={(html) => onPatch({ defaultValue: defaultFromSlot(element, html) })}
        />
      ) : (
        <FieldValueEditor
          element={element}
          value={element.defaultValue as FieldValue | undefined}
          onChange={(defaultValue) => onPatch({ defaultValue })}
        />
      ))}
    </>
  );
}
