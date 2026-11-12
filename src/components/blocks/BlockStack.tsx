import {
  useCallback, useEffect, useMemo, useRef, useState,
  type MouseEvent, type MutableRefObject, type PointerEvent, type ReactNode,
} from 'react';
import { Reorder, useDragControls } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { Eye, EyeOff, Plus, Puzzle } from 'lucide-react';
import ContextMenu, { type ContextMenuAction } from '../ui/ContextMenu';
import {
  appendEntryLink, editorHas, findEntryLinkPos, removeEntryLink, revealEntryLink, TextEditorHostContext, useTextEditorHost,
} from '../editors/text';
import {
  APPEND_ENTRY_LINK_EVENT, REMOVE_ENTRY_LINK_EVENT, REVEAL_ENTRY_LINK_EVENT, subscribeEntryLinkRequest,
  type EntryLinkRequest,
} from '../../lib/links';
import { extractInternalLinks, internalLinkBlockHtml, remapInternalLinks, toInternalLinkChip } from '../../lib/internalLinkHtml';
import { generateId } from '../../lib/helpers';
import { editorSavesSuspended } from '../../lib/editorLock';
import { activeElements, FIELDS_BLOCK_TYPE, linkFromSlot, parseFields, serializeFields } from '../../lib/blocks/fields';
import { useFieldFallbackText } from './useFieldFallbackText';
import { REORDER_SPRING } from '../../lib/motion';
import { flashReveal, scrollIntoViewCentered } from '../../lib/reveal';
import { createTextBlock, neutralizeSectionTags, parseBlocks, serializeBlocks } from '../../lib/blocks/blockHtml';
import { resolveBlockType, type BlockTypeMeta } from '../../lib/blocks/blockTypes';
import { blockIcon, createFromPreset } from '../../lib/blocks/presets';
import { useBlockDefinitionStore } from '../../store/blockDefinitionStore';
import {
  SIGIL_CHARGE_KIND, withChargesCoveringOnly, sigilState, sigilUnits, todayIso, withChargesCoveringCopy, withoutConcealedParts,
  withRenamedPartTargets,
} from '../../lib/blocks/sigil';
import { blockLabel, hiddenAttrValue, isBlockHidden, showsTitleInRead, withBlockAttr } from '../../lib/blocks/blockAttrs';
import { BLOCK_ATTR, TEXT_BLOCK_TYPE, type BlockAttrName, type BlockInstance } from '../../lib/blocks/types';
import { useBlockSessionStore, type BlockStackApi } from '../../store/blockSessionStore';
import { useTemplateNoticeStore } from '../../store/templateStore';
import { useUIStore } from '../../store/uiStore';
import { applyTemplateFields, undoTemplateFields } from '../../store/templateApply';
import { areBlocksEmpty, instantiateTemplateBlocks, isTextBlockEmpty, type Template } from '../../lib/blocks/templates';
import TemplateInsertion, { type TemplateTarget } from '../templates/TemplateInsertion';
import { BLOCK_VIEWS } from './blockViews';
import { BlockStackContext, type BlockStackContextValue } from './blockStackContext';
import { addBlockActions, commonBlockActions } from './blockActions';
import BlockFrame from './BlockFrame';
import UnknownBlock from './UnknownBlock';
import BlockErrorBoundary from './BlockErrorBoundary';

interface BlockStackProps {
  /** The entry the stack belongs to; the sidebar only serves the matching session. */
  entryId: string;
  /**
   * Only the INITIAL VALUE, as with TextEditor: the stack is uncontrolled
   * afterwards. The views remount it via `key` when another
   * entry is loaded or Cancel is pressed.
   */
  initialContent: string;
  isEditing: boolean;
  /** Placeholder of the first text block: the module-specific text. */
  placeholder: string;
  /** The complete serialised content after every change (→ `useEntryEditor.handleContentChange`). */
  onChange: (content: string) => void;
  /**
   * Read mode: save a permitted change (tick a checklist, yes/no) immediately;
   * the autosave of `useEntryEditor` only runs while editing.
   * If the prop is absent, read mode stays read-only.
   */
  onReadModeChange?: (content: string) => void | Promise<unknown>;
  /**
   * Entry type and category: with them the stack offers templates when
   * editing (picker, suggestions in an empty entry, notice after the
   * automatic default). A template's own page leaves it out.
   */
  templateTarget?: TemplateTarget;
}

const REVEAL_CLASS = 'block-stack-item--revealed';
/** Must match the duration of `block-reveal` in index.css. */
const REVEAL_MS = 1600;

/**
 * The content of an entry as a stack of blocks, for reading and editing.
 *
 * It is the text editors' host (`useTextEditorHost`: toolbar, link picker,
 * chip navigation, drops) and the one point of contact for the sidebar's link
 * requests, which also reach link fields. The sidebar's block
 * management serves it via `blockSessionStore`.
 *
 * Text input changes no React state: the new HTML lands in `blocksRef`
 * and goes serialised to `onChange`. It only becomes state on
 * structural changes (add, remove, move, attributes), so that
 * not every keystroke re-renders the whole stack. `blocks[i].html` in
 * state is therefore only the state at the last structural change; the live
 * state is in the ref (and in the editor).
 */
export default function BlockStack({
  entryId, initialContent, isEditing, placeholder, onChange, onReadModeChange, templateTarget,
}: BlockStackProps) {
  const { t } = useTranslation();

  const [blocks, setBlocks] = useState<BlockInstance[]>(() => blocksFromContent(initialContent));
  const blocksRef = useRef(blocks);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const stackRef = useRef<HTMLDivElement>(null);
  // Every change dismisses the "Template applied" notice; Undo would otherwise
  // also empty whatever arose afterwards.
  const emit = useCallback(() => {
    useTemplateNoticeStore.getState().dismiss(entryId);
    onChangeRef.current(serializeBlocks(blocksRef.current));
  }, [entryId]);

  const commit = useCallback((next: BlockInstance[]) => {
    blocksRef.current = next;
    setBlocks(next);
    emit();
  }, [emit]);

  const updateHtml = useCallback((id: string, rawHtml: string) => {
    const html = neutralizeSectionTags(rawHtml);
    const current = blocksRef.current.find((b) => b.id === id);
    // The same state is not a change (for instance toggling between reading and
    // editing); it should neither save nor close the template notice.
    if (current?.html === html) return;
    blocksRef.current = blocksRef.current.map((b) => (b.id === id ? { ...b, html } : b));
    emit();
  }, [emit]);

  // A safeguard nothing relies on: on a mode switch pull the state to
  // the ref state. The tree stays the same (see BlockFrame); if
  // something does get remounted, it sees the most recently typed HTML.
  useEffect(() => {
    setBlocks(blocksRef.current);
    // In read mode the content may have changed from outside (useExternalContentReset).
  }, [isEditing]);

  const resetEpoch = useExternalContentReset(initialContent, isEditing, blocksRef, setBlocks, onChangeRef);

  // Locked and concealed come from the sigil's charges; all blocks see the same state.
  const sigil = useMemo(() => sigilState(blocks, todayIso()), [blocks]);

  const definitions = useBlockDefinitionStore((s) => s.definitions);

  const textHost = useTextEditorHost({
    isEditing,
    getOrder: () => textEditorKeys(blocksRef.current),
    getContainer: () => stackRef.current,
  });
  const { orderedEditors, targetEditor, focusOnMount } = textHost;

  const context = useMemo<BlockStackContextValue>(() => ({
    // Only the first text block carries the module's placeholder ("What happened
    // today?"); further text blocks get a neutral one.
    placeholderFor: (blockId) =>
      blocksRef.current.find((b) => b.type === TEXT_BLOCK_TYPE)?.id === blockId
        ? placeholder
        : t('blocks.types.text.placeholder'),
  }), [placeholder, t]);

  /* ---------------- Link requests from the sidebar ---------------- */

  /**
   * Append a link, unless it is already somewhere in the entry. The target is
   * the editor the registry picks; if there is no text block at all, one is
   * created with the link as its content.
   */
  const appendLinkOnce = useCallback((item: EntryLinkRequest) => {
    if (orderedEditors().some((ed) => findEntryLinkPos(ed.state.doc, item) !== null)) return;
    const target = targetEditor();
    if (target && editorHas(target, 'internalLink')) {
      appendEntryLink(target, item);
      return;
    }
    commit([...blocksRef.current, createTextBlock(
      internalLinkBlockHtml(toInternalLinkChip(item), item.categoryLabel ?? '', { separator: false }),
    )]);
  }, [orderedEditors, targetEditor, commit]);

  /**
   * The field block whose link field points to `target`,
   * along with the block without that reference. The sidebar's links field
   * also lists these links (it reads the whole content), so
   * jumping to and removing must find them too.
   */
  const fieldText = useFieldFallbackText();
  const fieldTextRef = useRef(fieldText);
  fieldTextRef.current = fieldText;
  const findBlockLink = useCallback((target: { id: string; entryType: string }) => {
    const matches = (link: { id: string; entryType: string } | null) =>
      link?.id === target.id && link.entryType === target.entryType;
    for (const block of blocksRef.current) {
      if (resolveBlockType(block)?.id !== FIELDS_BLOCK_TYPE) continue;
      const model = parseFields(block);
      if (model.broken) continue;
      // The raw chip: the sidebar lists every link in the content.
      const element = model.elements.find((el) =>
        el.kind === 'link' && matches(linkFromSlot(model.slots[el.id])));
      // A text element without a mounted editor (removed, but with content): there
      // only the chip goes away, not the whole text; its word stays.
      const text = element ? undefined : model.elements.find((el) =>
        el.kind === 'text' && extractInternalLinks(model.slots[el.id] ?? '').some(matches));
      if (!element && !text) continue;
      return {
        block,
        withoutLink: () => {
          const slots = { ...model.slots };
          if (element) delete slots[element.id];
          else slots[text!.id] = remapInternalLinks(slots[text!.id], (link) => (matches(link) ? null : { id: link.id }));
          return serializeFields(block, { ...model, slots }, fieldTextRef.current);
        },
      };
    }
    return null;
  }, []);

  // Appending and removing from the links field, edit mode only. If
  // the acknowledgement is missing, the field knows its click went nowhere.
  useEffect(() => {
    if (!isEditing) return;
    const off = [
      subscribeEntryLinkRequest(APPEND_ENTRY_LINK_EVENT, (item) => {
        appendLinkOnce(item);
        return true;
      }),
      subscribeEntryLinkRequest(REMOVE_ENTRY_LINK_EVENT, (target) => {
        if (orderedEditors().some((ed) => removeEntryLink(ed, target))) return true;
        const hit = findBlockLink(target);
        if (!hit) return false;
        apiRef.current.update(hit.block.id, hit.withoutLink());
        return true;
      }),
    ];
    return () => off.forEach((fn) => fn());
  }, [isEditing, orderedEditors, appendLinkOnce, findBlockLink]);

  // Click on a chip in the links field → jump to the spot. Also in
  // read mode, where it is the normal case. The first text block with the link
  // wins; if it only appears in a link field, it jumps there.
  useEffect(() => subscribeEntryLinkRequest(
    REVEAL_ENTRY_LINK_EVENT,
    (target) => {
      if (orderedEditors().some((ed) => revealEntryLink(ed, target))) return true;
      const hit = findBlockLink(target);
      if (!hit) return false;
      apiRef.current.reveal(hit.block.id);
      return true;
    },
  ), [orderedEditors, findBlockLink]);

  /* ---------------- Structural changes ---------------- */

  const [menu, setMenu] = useState<{ x: number; y: number; actions: ContextMenuAction[] } | null>(null);

  const insertAt = (index: number, presetId: string) => {
    const block = createFromPreset(presetId, definitions, fieldTextRef.current);
    if (!block) return;
    if (block.type === TEXT_BLOCK_TYPE) focusOnMount(block.id);
    const next = [...blocksRef.current];
    next.splice(index, 0, block);
    commit(next);
  };

  const duplicate = (id: string) => {
    const index = blocksRef.current.findIndex((b) => b.id === id);
    if (index < 0) return;
    const source = blocksRef.current[index];
    const id2 = generateId();
    // A charged sigil stays charged: charge parts of the copy target
    // the parts of the copy, and any charge elsewhere that conceals the original
    // also conceals the copy. The sidebar passes through here as well.
    const next = blocksRef.current.map((b) => (b.id === source.id ? b : withChargesCoveringCopy(b, source.id, id2)));
    next.splice(index + 1, 0, withRenamedPartTargets({ ...source, id: id2, attrs: { ...source.attrs } }, source.id, id2));
    commit(next);
  };

  const remove = (id: string) => commit(blocksRef.current.filter((b) => b.id !== id));

  const reorder = (ids: string[]) => {
    const current = blocksRef.current;
    const byId = new Map(current.map((b) => [b.id, b]));
    // Only accept a genuine reorder. If a structural change lands during a drag
    // (a link from the sidebar creates a block), the drag's ID list
    // no longer fits; accepting it would mean silently losing a
    // block.
    if (ids.length !== current.length || ids.some((id) => !byId.has(id))) return;
    commit(ids.map((id) => byId.get(id)!));
  };

  const setAttr = (id: string, name: BlockAttrName, value: string | null) => {
    const block = blocksRef.current.find((b) => b.id === id);
    // Unchanged value (Enter on an unchanged title): no commit,
    // hence no autosave and no re-render either.
    if (!block || (block.attrs[name] ?? null) === value) return;
    commit(blocksRef.current.map((b) => (b.id === id ? withBlockAttr(b, name, value) : b)));
  };

  /** Replace the whole block (field block, sidebar section). */
  const updateBlock = (id: string, next: BlockInstance) => {
    if (next.id !== id) return;
    commit(blocksRef.current.map((b) => (b.id === id ? next : b)));
  };

  /**
   * Read mode: save a permitted change immediately. `updateBlock` reports it
   * ALSO to `onChange`, so that the view's content mirror knows it; otherwise
   * "Done" after a later edit without changes would write back the state from
   * before the tick.
   *
   * Like the autosave, not while saving is suspended (a backup import
   * is currently replacing the vault). The store updates are serialised per entry:
   * quick clicks land in order, the last state wins.
   */
  const onReadModeChangeRef = useRef(onReadModeChange);
  onReadModeChangeRef.current = onReadModeChange;
  const persistRead = (id: string, next: BlockInstance) => {
    const save = onReadModeChangeRef.current;
    if (!save || editorSavesSuspended()) return;
    updateBlock(id, next);
    void Promise.resolve(save(serializeBlocks(blocksRef.current)))
      .catch((e: unknown) => console.error('[BlockStack] read-mode save failed:', e));
  };

  const reveal = (id: string) => {
    const el = stackRef.current?.querySelector<HTMLElement>(`[data-block-item="${CSS.escape(id)}"]`);
    if (!el) return;
    scrollIntoViewCentered(el);
    flashReveal(el, REVEAL_CLASS, REVEAL_MS);
  };

  /* ---------------- Templates ---------------- */

  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);

  /**
   * Insert a template: its blocks go below the content (an empty stack is
   * replaced), like any block change through the editor. Title and tags go
   * through the entry's store, as from the properties sidebar; Cancel rolls
   * everything back.
   */
  const applyTemplate = (template: Template) => {
    if (!templateTarget || !isEditing) return;
    const added = instantiateTemplateBlocks(template);
    // Appended, its sigil conceals only its own calculators and drawings.
    const next = areBlocksEmpty(blocksRef.current) ? added : [...blocksRef.current, ...withChargesCoveringOnly(added)];
    commit(next.length > 0 ? next : [createTextBlock()]);
    const { entryType, flush } = templateTarget;
    // Save the deferred input first: title and tags are checked against the store.
    void flush()
      .then(() => applyTemplateFields(entryType, entryId, template))
      .then(() => {
        // A loaded sigil that locks the entry ends the edit: the entry can only be read until it is unloaded.
        if (!sigilState(blocksRef.current, todayIso()).lockEntry) return;
        const { activeView, setActiveView } = useUIStore.getState();
        if (activeView.id === entryId) setActiveView({ type: activeView.type, id: entryId, mode: 'view' });
      })
      .catch((e: unknown) => console.error('[BlockStack] applying template fields failed:', e));
  };

  /** Undo after the automatic insertion: empty stack, title and tags of the template reverted. */
  const undoTemplate = (template: Template) => {
    if (!templateTarget) return;
    commit([createTextBlock()]);
    const { entryType, flush } = templateTarget;
    void flush()
      .then(() => undoTemplateFields(entryType, entryId, template))
      .catch((e: unknown) => console.error('[BlockStack] undoing template fields failed:', e));
  };

  // The notice belongs to the editing session in which the template arrived; "Done" or
  // Cancel settle it. One that belongs to another entry was
  // left behind there (switched away while editing) and expires as soon as another
  // entry is edited; clearing it on teardown would not work, since the
  // StrictMode double mount would take it away from a freshly created entry again.
  useEffect(() => {
    const notices = useTemplateNoticeStore.getState();
    if (!isEditing) notices.dismiss(entryId);
    else if (templateTarget && notices.notice && notices.notice.entryId !== entryId) notices.dismiss(notices.notice.entryId);
  }, [isEditing, entryId, templateTarget]);

  /* ---------------- Session for the sidebar ---------------- */

  // The handles change on every render (they read the current closure); the
  // sidebar gets a stable object that forwards to the latest ones.
  // Stable means: `clear` on unmount recognises "its" session.
  // After teardown it forwards nothing any more; a stale call would otherwise
  // arrive via `onChange` in the entry that is now open.
  const apiRef = useRef<BlockStackApi>(null!);
  apiRef.current = {
    insert: insertAt, duplicate, remove, reorder, setAttr, update: updateBlock, reveal,
    liveBlocks: () => blocksRef.current,
    openTemplatePicker: () => setTemplatePickerOpen(true),
  };
  const mountedRef = useRef(false);
  const api = useMemo<BlockStackApi>(() => {
    const live = () => (mountedRef.current ? apiRef.current : null);
    return {
      insert: (index, type) => live()?.insert(index, type),
      duplicate: (id) => live()?.duplicate(id),
      remove: (id) => live()?.remove(id),
      reorder: (ids) => live()?.reorder(ids),
      setAttr: (id, name, value) => live()?.setAttr(id, name, value),
      update: (id, next) => live()?.update(id, next),
      reveal: (id) => live()?.reveal(id),
      liveBlocks: () => live()?.liveBlocks() ?? [],
      openTemplatePicker: () => live()?.openTemplatePicker(),
    };
  }, []);
  const [sessionId] = useState(generateId);
  // The views pass `templateTarget` as a new object on every render; the session only needs "yes/no".
  const offersTemplates = !!templateTarget;

  useEffect(() => {
    useBlockSessionStore.getState().publish({ sessionId, entryId, blocks, isEditing, templates: offersTemplates, api });
  }, [sessionId, entryId, blocks, isEditing, offersTemplates, api]);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      useBlockSessionStore.getState().clear(api);
    };
  }, [api]);

  /* ---------------- Menus and presentation ---------------- */

  const openAddMenu = (e: MouseEvent, index: number) => setMenu({
    x: e.clientX,
    y: e.clientY,
    actions: addBlockActions(t, (presetId) => insertAt(index, presetId), definitions),
  });

  const openBlockMenu = (e: MouseEvent, block: BlockInstance, meta: BlockTypeMeta | undefined) => {
    const hidden = isBlockHidden(block);
    setMenu({
      x: e.clientX,
      y: e.clientY,
      actions: [
        {
          label: hidden ? t('blocks.show') : t('blocks.hide'),
          icon: hidden ? <Eye size={12} /> : <EyeOff size={12} />,
          onClick: () => setAttr(block.id, BLOCK_ATTR.hidden, hiddenAttrValue(!hidden)),
        },
        ...commonBlockActions(t, meta, {
          duplicate: () => duplicate(block.id),
          remove: () => remove(block.id),
        }),
      ],
    });
  };

  /** An empty text block disappears in read mode instead of showing blank lines.
   *  From the ref: when switching after "Done" the state lags one render behind. */
  const isEmptyInRead = (blockId: string) => {
    const live = blocksRef.current.find((b) => b.id === blockId);
    return !!live && isTextBlockEmpty(live);
  };

  const renderBody = (block: BlockInstance, meta: BlockTypeMeta | undefined) => {
    const View = meta ? BLOCK_VIEWS.get(meta.id) : undefined;
    // The fallback shows stored HTML, without what a sigil conceals.
    if (!View) return <UnknownBlock block={withoutConcealedParts(block, sigil.concealed)} />;
    return (
      <BlockErrorBoundary block={block}>
        <View
          block={block}
          blocks={blocks}
          isEditing={isEditing}
          onHtmlChange={(html) => updateHtml(block.id, html)}
          onBlockChange={(next) => updateBlock(block.id, next)}
          // Locked "whole entry": no change even from read mode;
          // discharging only works via the charge itself (which never locks itself out).
          // A custom block with a charge part may write; it then itself
          // allows only the charge (FieldsBlock).
          onPersist={!isEditing && onReadModeChange && (!sigil.lockEntry || holdsCharge(block))
            ? (next) => persistRead(block.id, next)
            : undefined}
          sigil={sigil}
        />
      </BlockErrorBoundary>
    );
  };

  const stackClass = [
    'block-stack',
    blocks.length > 1 && 'block-stack--multi',
    textHost.dropActive && 'block-stack--drop-target',
  ].filter(Boolean).join(' ');

  return (
    <BlockStackContext.Provider value={context}>
    <TextEditorHostContext.Provider value={textHost.context}>
      {textHost.toolbar}

      {isEditing && templateTarget && (
        <TemplateInsertion
          entryId={entryId}
          pickerOpen={templatePickerOpen}
          onPickerOpenChange={setTemplatePickerOpen}
          apply={applyTemplate}
          undo={undoTemplate}
        />
      )}

      {/* Read and edit mode share the same tree: Reorder.Group is simply
          inert in read mode, because only the handle starts a drag. */}
      <Reorder.Group
        ref={stackRef}
        as="div"
        axis="y"
        values={blocks.map((b) => b.id)}
        onReorder={reorder}
        className={stackClass}
      >
        {blocks.map((block, index) => {
          const meta = resolveBlockType(block);
          const label = blockLabel(t, block, meta);
          return (
            <StackItem key={`${block.id}:${resetEpoch}`} id={block.id}>
              {(startDrag) => (
                <>
                  <BlockFrame
                    isEditing={isEditing}
                    icon={blockIcon(block, meta) ?? Puzzle}
                    label={label}
                    hidden={isBlockHidden(block) || (!isEditing && isEmptyInRead(block.id))}
                    showReadTitle={showsTitleInRead(block, meta)}
                    onGripPointerDown={startDrag}
                    onOpenMenu={(e) => openBlockMenu(e, block, meta)}
                  >
                    {renderBody(block, meta)}
                  </BlockFrame>
                  {isEditing && (
                    <InsertLine always={index === blocks.length - 1} onAdd={(e) => openAddMenu(e, index + 1)} />
                  )}
                </>
              )}
            </StackItem>
          );
        })}
      </Reorder.Group>
      {isEditing && blocks.length === 0 && <InsertLine always onAdd={(e) => openAddMenu(e, 0)} />}
      {textHost.wordCount}

      {menu && <ContextMenu x={menu.x} y={menu.y} actions={menu.actions} onClose={() => setMenu(null)} />}
      {textHost.overlays}
    </TextEditorHostContext.Provider>
    </BlockStackContext.Provider>
  );
}

/** Does the block hold a charge (a charge on its own or the part of a custom block)? */
function holdsCharge(block: BlockInstance): boolean {
  return sigilUnits([block]).some((u) => u.block.type === SIGIL_CHARGE_KIND);
}

/**
 * The keys of the stack's text editors in block order: a text block under its
 * ID, a custom block's text element under `<block ID>:<element ID>`, at the
 * position of its block.
 */
function textEditorKeys(blocks: BlockInstance[]): string[] {
  return blocks.flatMap((block) => [
    block.id,
    ...(block.type === FIELDS_BLOCK_TYPE
      ? activeElements(parseFields(block)).filter((el) => el.kind === 'text').map((el) => `${block.id}:${el.id}`)
      : []),
  ]);
}

/** The blocks of a content; an empty entry gets an empty text block. */
function blocksFromContent(content: string): BlockInstance[] {
  const parsed = parseBlocks(content);
  return parsed.length > 0 ? parsed : [createTextBlock()];
}

/**
 * Content changed from outside while the entry is being read: "Update
 * all" or "remove from entries" in the blocks view. The
 * stack is uncontrolled and would otherwise only see it after a reload;
 * worse, the view's content mirror would keep the old state, and
 * "Done" after a later edit would write it back.
 *
 * Only a genuine change of the prop counts, never the mode switch: after "Done"
 * the store lags behind briefly. While editing the content belongs to the
 * editor, and what the stack itself wrote (ticking in read mode) is
 * already its state. Supplies an epoch for the keys: a text block reads its
 * HTML only at startup and has to remount.
 */
function useExternalContentReset(
  initialContent: string,
  isEditing: boolean,
  blocksRef: MutableRefObject<BlockInstance[]>,
  setBlocks: (blocks: BlockInstance[]) => void,
  onChangeRef: MutableRefObject<(content: string) => void>,
): number {
  const [epoch, setEpoch] = useState(0);
  const seenRef = useRef(initialContent);
  const isEditingRef = useRef(isEditing);
  isEditingRef.current = isEditing;
  useEffect(() => {
    if (seenRef.current === initialContent) return;
    seenRef.current = initialContent;
    if (isEditingRef.current || initialContent === serializeBlocks(blocksRef.current)) return;
    const next = blocksFromContent(initialContent);
    blocksRef.current = next;
    setBlocks(next);
    setEpoch((n) => n + 1);
    onChangeRef.current(initialContent);
  }, [initialContent, blocksRef, setBlocks, onChangeRef]);
  return epoch;
}

/** A list slot in the stack. Dragging happens only at the handle; otherwise no text
 *  could be selected in the text block any more. */
function StackItem({ id, children }: { id: string; children: (startDrag: (e: PointerEvent) => void) => ReactNode }) {
  const controls = useDragControls();
  return (
    <Reorder.Item
      as="div"
      value={id}
      dragListener={false}
      dragControls={controls}
      transition={REORDER_SPRING}
      style={{ position: 'relative' }}
      className="block-stack-item"
      data-block-item={id}
    >
      {children((e) => controls.start(e))}
    </Reorder.Item>
  );
}

/** The insertion line between blocks. Deliberately not a `Button`: it is part of the
 *  document, not an action button in a bar; between two blocks only a
 *  "+" that appears on hover, at the end a quiet line of text. */
function InsertLine({ always = false, onAdd }: { always?: boolean; onAdd: (e: MouseEvent) => void }) {
  const { t } = useTranslation();
  return (
    <div className={always ? 'block-insert block-insert--always' : 'block-insert'}>
      <button type="button" className="block-insert-btn" onClick={onAdd} title={t('blocks.add')} aria-label={t('blocks.add')}>
        <Plus size={12} />
        {always && <span>{t('blocks.add')}</span>}
      </button>
    </div>
  );
}
