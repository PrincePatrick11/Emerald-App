import { useEffect, useState, type MouseEvent } from 'react';
import { Reorder, useDragControls } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { ArchiveRestore, GripVertical, Plus, RefreshCw, Trash2 } from 'lucide-react';
import ContextMenu, { type ContextMenuAction } from '../ui/ContextMenu';
import Button from '../ui/Button';
import Modal from '../ui/Modal';
import EmojiPicker from '../ui/EmojiPicker';
import { useBlockDefinitionStore, type BlockDefinitionPatch } from '../../store/blockDefinitionStore';
import { useUndoStore } from '../../store/undoStore';
import { removeAllCopies, updateAllCopies, type CopyRunResult, type CopyUsage } from '../../store/blockCopies';
import {
  canBeEmpty, defaultFromSlot, ELEMENT_KINDS, elementKindLabelKey, isSigilKind, isSlotKind, slotFromDefault,
  type ElementDef, type ElementKind, type FieldValue,
} from '../../lib/blocks/fields';
import { ELEMENT_KIND_ICONS } from '../../lib/blocks/presets';
import { definitionLabel, elementLabel } from '../../lib/blocks/blockAttrs';
import type { BlockDefinition, DefinitionDisplay } from '../../lib/blocks/definitions';
import { generateId } from '../../lib/helpers';
import { REORDER_SPRING } from '../../lib/motion';
import { OP_PROP_SELECT_CLASSES } from '../../lib/styleClasses';
import { useFieldFallbackText } from './useFieldFallbackText';
import OptionsEditor from './OptionsEditor';
import BlockCheckbox from './BlockCheckbox';
import FieldValueEditor from './FieldValueEditor';
import FieldSlotEditor from './FieldSlotEditor';
import SigilPartSettings from './SigilPartSettings';

/** Was der Baukasten bearbeitet — genau das, was `updateDefinition` annimmt. */
export type DefinitionDraft = Required<BlockDefinitionPatch>;

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
  /** Ein Entwurf, der beim letzten Wechsel ungespeichert liegen blieb. */
  savedDraft?: DefinitionDraft;
  /** Meldet den ungespeicherten Entwurf (`null` = keiner) — die Ansicht hebt ihn auf. */
  onDraftChange: (draft: DefinitionDraft | null) => void;
  onDeleted: () => void;
}

/**
 * Der Baukasten eines eigenen Blocks: Name, Icon, Beschreibung, die Felder
 * (hinzufügen, benennen, sortieren, entfernen) und die Anzeigeregeln.
 *
 * Bearbeitet wird ein Entwurf; erst „Speichern" schreibt ihn und hebt die
 * Revision — sonst machte jeder Tastendruck im Namen alle Kopien zu „älteren
 * Versionen". Ein gespeichertes Feld wird beim Entfernen archiviert statt
 * gelöscht: Kopien können Werte dafür haben, und es lässt sich zurückholen.
 *
 * Darunter die Verwendung: in wie vielen Einträgen der Block steckt, wie viele
 * davon eine ältere Version tragen, und „Alle aktualisieren".
 */
export default function BlockDefinitionEditor({ definition, usage, savedDraft, onDraftChange, onDeleted }: Props) {
  const { t } = useTranslation();
  const text = useFieldFallbackText();
  const updateDefinition = useBlockDefinitionStore((s) => s.updateDefinition);
  const [draft, setDraft] = useState<DefinitionDraft>(() => savedDraft ?? draftOf(definition));
  const [menu, setMenu] = useState<{ x: number; y: number; actions: ContextMenuAction[] } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [confirmUpdate, setConfirmUpdate] = useState(false);
  // Steigt mit „Abbrechen": die Feldzeilen montieren neu und vergessen ihren eigenen Stand (Vorbefüllen angehakt).
  const [resetEpoch, setResetEpoch] = useState(0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const dirty = JSON.stringify(draft) !== JSON.stringify(draftOf(definition));
  useEffect(() => { onDraftChange(dirty ? draft : null); }, [draft, dirty, onDraftChange]);

  const savedIds = new Set(definition.elements.map((e) => e.id));
  const active = draft.elements.filter((e) => !e.archived);
  const archived = draft.elements.filter((e) => e.archived);

  const patch = (p: Partial<DefinitionDraft>) => setDraft((d) => ({ ...d, ...p }));
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

  const save = async () => {
    setNotice(null);
    await updateDefinition(definition.id, draft);
    // Der Store speichert den Namen getrimmt — sonst bliebe der Entwurf „geändert".
    setDraft((d) => ({ ...d, name: d.name.trim() }));
  };

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
  const outdated = usage?.outdated ?? 0;

  return (
    <div className="max-w-2xl space-y-6">
      {/* Kopf: Icon, Name, Löschen */}
      <div className="flex items-center gap-3">
        <EmojiPicker
          value={draft.icon}
          onChange={(icon) => patch({ icon })}
          size="lg"
          trigger={({ toggle }) => (
            <button type="button" className="block-def-icon-btn" onClick={toggle} title={t('blocks.library.icon')} aria-label={t('blocks.library.icon')}>
              {draft.icon}
            </button>
          )}
        />
        <input
          className="flex-1 min-w-0 bg-transparent text-lg font-semibold text-stone-200 outline-none selectable placeholder-stone-600"
          value={draft.name}
          placeholder={t('blocks.library.namePlaceholder')}
          aria-label={t('blocks.library.name')}
          onChange={(e) => patch({ name: e.target.value })}
        />
        <Button tone="danger" compact small onClick={() => setDeleting(true)} title={t('blocks.library.delete')} aria-label={t('blocks.library.delete')}>
          <Trash2 size={12} />
        </Button>
      </div>

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
              key={`${element.id}:${resetEpoch}`}
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

      {/* Anzeige */}
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

      <div className="flex items-center gap-2">
        <Button tone="jade" disabled={!dirty} onClick={() => void save()}>{t('common.save')}</Button>
        <Button
          tone="neutral"
          disabled={!dirty}
          onClick={() => {
            setDraft(draftOf(definition));
            setResetEpoch((n) => n + 1);
          }}
        >
          {t('common.cancel')}
        </Button>
        {dirty && <span className="text-xs text-stone-500">{t('blocks.library.unsaved')}</span>}
      </div>

      {/* Verwendung */}
      <section className="space-y-2 border-t border-stone-700/60 pt-4">
        <p className="label-xs">{t('blocks.library.usage')}</p>
        <p className="text-xs text-stone-400">
          {entries > 0 ? t('blocks.library.usedIn', { count: entries }) : t('blocks.library.unused')}
          {outdated > 0 && <> · {t('blocks.library.outdated', { count: outdated })}</>}
        </p>
        <p className="block-field-hint">{t('blocks.library.copiesNote')}</p>
        {outdated > 0 && (
          confirmUpdate ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-stone-400">{t('blocks.library.updateAllConfirm', { count: outdated })}</span>
              <Button tone="jade" small onClick={() => void runUpdateAll()}>{t('blocks.library.updateAll')}</Button>
              <Button tone="neutral" small onClick={() => setConfirmUpdate(false)}>{t('common.cancel')}</Button>
            </div>
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

      {menu && <ContextMenu x={menu.x} y={menu.y} actions={menu.actions} onClose={() => setMenu(null)} />}
      {deleting && (
        <DeleteDefinitionModal
          definition={definition}
          entryCount={entries}
          onClose={() => setDeleting(false)}
          onDeleted={onDeleted}
        />
      )}
    </div>
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
  return [
    t(`blocks.library.${key}`, { count: result.changed }),
    result.skippedEditing ? t('blocks.library.skippedEditing', { count: result.skippedEditing }) : '',
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
function DeleteDefinitionModal({ definition, entryCount, onClose, onDeleted }: {
  definition: BlockDefinition;
  entryCount: number;
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
        if (result.skippedEditing || result.skippedLocked || result.failed) {
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
          {entryCount > 0 && (
            <BlockCheckbox
              checked={alsoRemove}
              onChange={setAlsoRemove}
              label={t('blocks.library.deleteFromEntries', { count: entryCount })}
            />
          )}
        </>
      ) : (
        <p className="text-xs text-[var(--danger-text)]">{t('blocks.library.deleteFromEntriesWarning', { count: entryCount })}</p>
      )}
      <div className="flex justify-end gap-2 pt-1">
        <Button tone="neutral" disabled={busy} onClick={onClose}>{t('common.cancel')}</Button>
        <Button tone="danger" disabled={busy} onClick={() => void run()}>
          {!alsoRemove
            ? t('common.delete')
            : step === 'choose'
              ? t('blocks.library.continue')
              : t('blocks.library.removeAndDelete', { count: entryCount })}
        </Button>
      </div>
    </Modal>
  );
}
