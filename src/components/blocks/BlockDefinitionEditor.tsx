import { useState, type MouseEvent } from 'react';
import { Reorder, useDragControls } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { ArchiveRestore, GripVertical, Plus, RefreshCw, Trash2 } from 'lucide-react';
import ContextMenu, { type ContextMenuAction } from '../ui/ContextMenu';
import Button from '../ui/Button';
import Modal from '../ui/Modal';
import LibraryPageFrame from '../ui/LibraryPageFrame';
import InlineConfirm from '../ui/InlineConfirm';
import PropertiesEditView from '../sidebar/fields/PropertiesEditView';
import Favicon from '../sidebar/fields/Favicon';
import { useBlockDefinitionStore } from '../../store/blockDefinitionStore';
import { useBlockDraftStore, type DefinitionDraft } from '../../store/draftStore';
import { useDraftPage } from '../../hooks/useDraftPage';
import { useShrunkIcon } from '../../hooks/useShrunkIcon';
import { useUndoStore } from '../../store/undoStore';
import { removeAllCopies, updateAllCopies, type CopyRunResult, type CopyUsage } from '../../store/blockCopies';
import {
  canBeEmpty, defaultFromSlot, ELEMENT_KINDS, elementKindLabelKey, isSigilKind, isSlotKind, slotFromDefault,
  type ElementDef, type ElementKind, type FieldValue,
} from '../../lib/blocks/fields';
import { ELEMENT_KIND_ICONS } from '../../lib/blocks/presets';
import { definitionLabel, elementLabel } from '../../lib/blocks/blockAttrs';
import { DEFAULT_DEFINITION_ICON, type BlockDefinition, type DefinitionDisplay } from '../../lib/blocks/definitions';
import { generateId } from '../../lib/helpers';
import { REORDER_SPRING } from '../../lib/motion';
import { OP_PROP_SELECT_CLASSES } from '../../lib/styleClasses';
import { useFieldFallbackText } from './useFieldFallbackText';
import OptionsEditor from './OptionsEditor';
import BlockCheckbox from './BlockCheckbox';
import FieldValueEditor from './FieldValueEditor';
import FieldSlotEditor from './FieldSlotEditor';
import SigilPartSettings from './SigilPartSettings';

const draftOf = (d: DefinitionDraft): DefinitionDraft => ({
  name: d.name, icon: d.icon, description: d.description, elements: d.elements, display: d.display,
});

/** Die sichtbaren Elemente vorn, die archivierten dahinter — die Ordnung, die Definition und Kopie halten. */
const withArchivedLast = (elements: ElementDef[]): ElementDef[] => [
  ...elements.filter((e) => !e.archived),
  ...elements.filter((e) => e.archived),
];

interface Props {
  definition: BlockDefinition;
  usage: CopyUsage | undefined;
  /** Zurück zur Liste. Die Brotkrume lässt den Entwurf liegen (die Liste
   *  zeigt ihn als ungespeichert); „Fertig" und „Abbrechen" erledigen ihn vorher. */
  onClose: () => void;
  /** Öffnet den Löschdialog — den hält die Ansicht, damit seine Abschlussmeldung
   *  die Seite überlebt, die mit der Definition verschwindet. */
  onDelete: () => void;
}

/**
 * Die Seite eines eigenen Blocks (`LibraryPageFrame`): Name als Titel,
 * darunter Beschreibung und die Felder (hinzufügen, benennen, sortieren,
 * entfernen); in der Seitenleiste Icon, Anzeigeregeln und Verwendung.
 *
 * Bearbeitet wird ein Entwurf (`useDraftPage`); erst „Fertig" schreibt ihn und
 * hebt die Revision — sonst machte jeder Tastendruck im Namen alle Kopien zu
 * „älteren Versionen". Ein gespeichertes Feld wird beim Entfernen archiviert
 * statt gelöscht: Kopien können Werte dafür haben, und es lässt sich
 * zurückholen.
 */
export default function BlockDefinitionEditor({ definition, usage, onClose, onDelete }: Props) {
  const { t } = useTranslation();
  const text = useFieldFallbackText();
  const updateDefinition = useBlockDefinitionStore((s) => s.updateDefinition);
  const { draft, setDraft, patch, dirty, busy, setBusy, finish, leave } = useDraftPage({
    store: useBlockDraftStore,
    id: definition.id,
    saved: draftOf(definition),
    save: updateDefinition,
    onClose,
    logTag: 'BlockDefinitionEditor',
  });
  const [menu, setMenu] = useState<{ x: number; y: number; actions: ContextMenuAction[] } | null>(null);
  const [confirmUpdate, setConfirmUpdate] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const savedIds = new Set(definition.elements.map((e) => e.id));
  const active = draft.elements.filter((e) => !e.archived);
  const archived = draft.elements.filter((e) => e.archived);

  const patchDisplay = (p: Partial<DefinitionDisplay>) => setDraft((d) => ({ ...d, display: { ...d.display, ...p } }));
  const setElements = (fn: (elements: ElementDef[]) => ElementDef[]) =>
    setDraft((d) => ({ ...d, elements: withArchivedLast(fn(d.elements)) }));
  const patchElement = (id: string, p: Partial<ElementDef>) =>
    setElements((els) => els.map((e) => (e.id === id ? { ...e, ...p } : e)));

  const addElement = (kind: ElementKind) => {
    const element: ElementDef = { id: generateId(), kind, label: '' };
    if (kind === 'select') element.options = [];
    setElements((els) => [...els, element]);
  };
  // Nur im Entwurf: ganz weg. Gespeichert: archiviert — Kopien können Werte dafür haben.
  const removeElement = (id: string) => setElements((els) => (savedIds.has(id)
    ? els.map((e) => (e.id === id ? { ...e, archived: true } : e))
    : els.filter((e) => e.id !== id)));
  // Ans Ende der sichtbaren: dorthin, wo ein neues Feld auch landete.
  const restoreElement = (id: string) => setElements((els) => {
    const element = els.find((e) => e.id === id);
    if (!element) return els;
    const { archived: _archived, ...restored } = element;
    return [...els.filter((e) => e.id !== id && !e.archived), restored, ...els.filter((e) => e.id !== id && e.archived)];
  });
  const reorderActive = (ids: string[]) => setElements((els) => {
    const byId = new Map(els.map((e) => [e.id, e]));
    if (ids.some((id) => !byId.has(id))) return els;
    return [...ids.map((id) => byId.get(id)!), ...els.filter((e) => e.archived)];
  });

  const openAddMenu = (e: MouseEvent) => setMenu({
    x: e.clientX,
    y: e.clientY,
    actions: ELEMENT_KINDS.map((kind) => {
      const Icon = ELEMENT_KIND_ICONS[kind];
      return { label: t(elementKindLabelKey(kind)), icon: <Icon size={12} />, onClick: () => addElement(kind) };
    }),
  });

  const setIcon = useShrunkIcon((icon) => patch({ icon }), 'BlockDefinitionEditor');

  const runUpdateAll = async () => {
    setConfirmUpdate(false);
    setBusy(true);
    try {
      setNotice(resultNotice(t, 'updated', await updateAllCopies(definition, text)));
    } finally {
      setBusy(false);
    }
  };

  const entries = usage?.entries ?? 0;
  const templates = usage?.templates ?? 0;
  const outdated = (usage?.outdated ?? 0) + (usage?.outdatedTemplates ?? 0);

  const sidebar = (
    <PropertiesEditView>
      <div>
        <p className="label-xs mb-2">{t('properties.icon')}</p>
        <Favicon
          value={draft.icon}
          onChange={(icon) => void setIcon(icon)}
          // Zurück zum Standard — ohne Icon stünde der Block in Menüs ohne Zeichen da.
          onRemove={() => void setIcon(DEFAULT_DEFINITION_ICON)}
        />
      </div>

      <section className="space-y-2">
        <p className="label-xs">{t('blocks.library.display')}</p>
        <BlockCheckbox checked={draft.display.readHideEmpty} onChange={(v) => patchDisplay({ readHideEmpty: v })} label={t('blocks.fields.hideEmpty')} />
        <BlockCheckbox checked={draft.display.showTitle} onChange={(v) => patchDisplay({ showTitle: v })} label={t('blocks.showTitle')} />
        <BlockCheckbox
          checked={draft.display.readOnly}
          onChange={(v) => patchDisplay({ readOnly: v })}
          label={t('blocks.fields.readOnly')}
          hint={t('blocks.fields.readOnlyHint')}
        />
      </section>

      <section className="space-y-2">
        <p className="label-xs">{t('blocks.library.usage')}</p>
        <p className="text-xs text-stone-400">
          {entries > 0 ? t('blocks.library.usedIn', { count: entries }) : t('blocks.library.unused')}
          {templates > 0 && <> · {t('blocks.library.inTemplates', { count: templates })}</>}
          {(usage?.outdated ?? 0) > 0 && <> · {t('blocks.library.outdated', { count: usage!.outdated })}</>}
          {(usage?.outdatedTemplates ?? 0) > 0 && <> · {t('blocks.library.outdatedTemplates', { count: usage!.outdatedTemplates })}</>}
        </p>
        <p className="block-field-hint">{t('blocks.library.copiesNote')}</p>
        {outdated > 0 && (
          confirmUpdate ? (
            <InlineConfirm
              tone="jade"
              small
              wrap
              message={(usage?.outdatedTemplates ?? 0) > 0
                ? t('blocks.library.updateAllConfirmCopies', { count: outdated })
                : t('blocks.library.updateAllConfirm', { count: outdated })}
              confirmLabel={t('blocks.library.updateAll')}
              onConfirm={() => void runUpdateAll()}
              onCancel={() => setConfirmUpdate(false)}
            />
          ) : (
            <Button
              tone="jade"
              small
              disabled={dirty || busy}
              title={dirty ? t('blocks.library.saveFirst') : undefined}
              onClick={() => setConfirmUpdate(true)}
            >
              <RefreshCw size={12} />
              <span>{t('blocks.library.updateAll')}</span>
            </Button>
          )
        )}
        {notice && <p className="text-xs text-stone-500">{notice}</p>}
      </section>
    </PropertiesEditView>
  );

  return (
    <LibraryPageFrame
      backLabel={t('nav.blocks')}
      onBack={onClose}
      icon={draft.icon}
      dirty={dirty}
      busy={busy}
      onDone={() => void finish()}
      onCancel={leave}
      onDelete={onDelete}
      name={draft.name}
      nameLabel={t('blocks.library.name')}
      namePlaceholder={t('blocks.library.namePlaceholder')}
      onNameChange={(name) => patch({ name })}
      sidebar={sidebar}
    >
      <div className="max-w-3xl space-y-6">
        <textarea
          className={`${OP_PROP_SELECT_CLASSES} resize-none selectable`}
          rows={2}
          value={draft.description}
          placeholder={t('blocks.library.descriptionPlaceholder')}
          aria-label={t('blocks.library.description')}
          onChange={(e) => patch({ description: e.target.value })}
        />

        {/* Felder */}
        <section className="space-y-2">
          <p className="label-xs">{t('blocks.library.fields')}</p>
          {active.length === 0 && <p className="text-xs text-stone-600">{t('blocks.library.noFields')}</p>}
          <Reorder.Group as="div" axis="y" values={active.map((e) => e.id)} onReorder={reorderActive} className="space-y-2">
            {active.map((element) => (
              <ElementRow
                key={element.id}
                element={element}
                siblings={active}
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

          {archived.length > 0 && (
            <div className="pt-2 space-y-1">
              <p className="label-xs">{t('blocks.library.removedFields')}</p>
              <p className="block-field-hint">{t('blocks.library.removedHint')}</p>
              {archived.map((element) => {
                const Icon = ELEMENT_KIND_ICONS[element.kind];
                return (
                  <div key={element.id} className="flex items-center gap-2 text-xs text-stone-500">
                    <Icon size={12} className="flex-shrink-0" />
                    <span className="flex-1 truncate">{elementLabel(t, element)}</span>
                    <button
                      type="button"
                      className="block-row-action"
                      onClick={() => restoreElement(element.id)}
                      title={t('blocks.library.restoreField')}
                      aria-label={t('blocks.library.restoreField')}
                    >
                      <ArchiveRestore size={12} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {menu && <ContextMenu x={menu.x} y={menu.y} actions={menu.actions} onClose={() => setMenu(null)} />}
    </LibraryPageFrame>
  );
}

function ElementRow({ element, siblings, blockHidesEmpty, onPatch, onRemove }: {
  element: ElementDef;
  /** Die sichtbaren Elemente des Blocks — die Ladung wählt daraus, was sie verdeckt. */
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
            // Gleich der Blockregel: kein eigener Wert — die Regel des Blocks gilt.
            onChange={(v) => onPatch({ hideWhenEmpty: v === blockHidesEmpty ? undefined : v })}
            label={t('blocks.fields.hideEmpty')}
          />
        )}
        {isSigilKind(element.kind)
          ? <SigilPartSettings element={element} siblings={siblings} onPatch={onPatch} />
          : <PrefillEditor element={element} onPatch={onPatch} />}
      </div>
    </Reorder.Item>
  );
}

/**
 * Die Vorgabe eines Felds: angehakt, bekommt jede neue Kopie diesen Wert —
 * eine Checkliste mit ihren Punkten, Ja/Nein auf „Ja". Ob angehakt, hält der
 * Baukasten selbst: eine geleerte Eingabe (die Zahl beim Neutippen) soll das
 * Feld nicht gleich wieder zuklappen.
 */
function PrefillEditor({ element, onPatch }: { element: ElementDef; onPatch: (p: Partial<ElementDef>) => void }) {
  const { t } = useTranslation();
  // Eine Vorgabe da heißt angehakt; `armed` hält den Haken, solange die Eingabe noch leer ist.
  const [armed, setArmed] = useState(false);
  const on = armed || element.defaultValue !== undefined;
  const toggle = (next: boolean) => {
    setArmed(next);
    // Ja/Nein steht ohne Wert schon auf „Nein" — wer vorbelegt, will „Ja".
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

function resultNotice(t: ReturnType<typeof useTranslation>['t'], key: 'updated' | 'removed', result: CopyRunResult): string {
  const entries = result.changed - result.changedTemplates;
  return [
    entries || !result.changedTemplates ? t(`blocks.library.${key}`, { count: entries }) : '',
    result.changedTemplates ? t(`blocks.library.${key}Templates`, { count: result.changedTemplates }) : '',
    result.skippedEditing ? t('blocks.library.skippedEditing', { count: result.skippedEditing }) : '',
    result.skippedDrafts ? t('blocks.library.skippedDrafts', { count: result.skippedDrafts }) : '',
    result.skippedLocked ? t('blocks.library.skippedLocked', { count: result.skippedLocked }) : '',
    result.failed ? t('blocks.library.failed', { count: result.failed }) : '',
  ].filter(Boolean).join(' ');
}

/**
 * Löschen, in zwei Stufen: standardmäßig bleiben alle Kopien in den Einträgen
 * stehen, und die Definition geht in den Papierkorb (rückgängig machbar). Nur
 * wer „auch aus Einträgen entfernen" ankreuzt, bekommt eine zweite Bestätigung
 * — das Entfernen lässt sich nur über ein Backup zurückholen.
 */
/** Die Texte des Löschdialogs, wenn auch Vorlagen Kopien tragen. */
const WITH_TEMPLATES = {
  deleteFromEntries: 'deleteFromCopies',
  deleteFromEntriesWarning: 'deleteFromCopiesWarning',
  removeAndDelete: 'removeAndDeleteCopies',
} as const;

export function DeleteDefinitionModal({ definition, usage, onClose, onDeleted }: {
  definition: BlockDefinition;
  usage: CopyUsage | undefined;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const { t } = useTranslation();
  const deleteDefinition = useBlockDefinitionStore((s) => s.deleteDefinition);
  const restoreDefinition = useBlockDefinitionStore((s) => s.restoreDefinition);
  const pushUndo = useUndoStore((s) => s.push);
  const [alsoRemove, setAlsoRemove] = useState(false);
  const [step, setStep] = useState<'choose' | 'confirm' | 'done'>('choose');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const title = t('blocks.library.deleteTitle', { name: definitionLabel(t, definition) });
  const entryCount = usage?.entries ?? 0;
  const copyCount = entryCount + (usage?.templates ?? 0);
  // Stecken Kopien auch in Vorlagen, nennen die Texte „Einträge und Vorlagen".
  const copies = (key: keyof typeof WITH_TEMPLATES) => ((usage?.templates ?? 0) > 0
    ? t(`blocks.library.${WITH_TEMPLATES[key]}`, { count: copyCount })
    : t(`blocks.library.${key}`, { count: entryCount }));

  const run = async () => {
    if (alsoRemove && step === 'choose') {
      setStep('confirm');
      return;
    }
    setBusy(true);
    try {
      if (alsoRemove) {
        const result = await removeAllCopies(definition.id);
        await deleteDefinition(definition.id);
        // Wer gerade bearbeitet wird, behält den Block — das muss man erfahren.
        if (result.skippedEditing || result.skippedDrafts || result.skippedLocked || result.failed) {
          setNotice(resultNotice(t, 'removed', result));
          setStep('done');
          return;
        }
      } else {
        await deleteDefinition(definition.id);
        pushUndo({
          id: generateId(),
          description: t('undo.blockDefinitionDeleted'),
          undo: () => restoreDefinition(definition.id),
        });
      }
      onDeleted();
    } finally {
      setBusy(false);
    }
  };

  if (step === 'done') {
    return (
      <Modal title={title} onClose={onDeleted} bodyClassName="p-4 space-y-3">
        <p className="text-xs text-stone-400">{notice}</p>
        <div className="flex justify-end">
          <Button tone="neutral" onClick={onDeleted}>{t('common.ok')}</Button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={title} onClose={onClose} dismissible={!busy} bodyClassName="p-4 space-y-3">
      {step === 'choose' ? (
        <>
          <p className="text-xs text-stone-400">{t('blocks.library.deleteKeeps')}</p>
          {copyCount > 0 && (
            <BlockCheckbox
              checked={alsoRemove}
              onChange={setAlsoRemove}
              label={copies('deleteFromEntries')}
            />
          )}
        </>
      ) : (
        <p className="text-xs text-[var(--danger-text)]">{copies('deleteFromEntriesWarning')}</p>
      )}
      <div className="flex justify-end gap-2 pt-1">
        <Button tone="neutral" disabled={busy} onClick={onClose}>{t('common.cancel')}</Button>
        <Button tone="danger" disabled={busy} onClick={() => void run()}>
          {!alsoRemove
            ? t('common.delete')
            : step === 'choose'
              ? t('blocks.library.continue')
              : copies('removeAndDelete')}
        </Button>
      </div>
    </Modal>
  );
}
