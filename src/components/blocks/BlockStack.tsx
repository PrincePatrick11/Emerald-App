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
import { internalLinkBlockHtml, toInternalLinkChip } from '../../lib/internalLinkHtml';
import { generateId, localIsoDay } from '../../lib/helpers';
import { editorSavesSuspended } from '../../lib/editorLock';
import { REORDER_SPRING } from '../../lib/motion';
import { flashReveal, scrollIntoViewCentered } from '../../lib/reveal';
import { createTextBlock, neutralizeSectionTags, parseBlocks, serializeBlocks } from '../../lib/blocks/blockHtml';
import {
  blockCountsLinks, blockReadState, blockTextEditors, blockWithoutLink, entryEffects, resolveBlockType, upgradeBlock, withDuplicatedBlock, type BlockTypeDef,
} from '../../lib/blocks/blockTypes';
import { blockLinksTo } from '../../lib/blocks/blockRefs';
import { blockContext, textEditorKey } from '../../lib/blocks/toolkit';
import { findEntry, useEntryStore } from '../../store/entryStore';
import { createFromPreset } from '../../lib/blocks/presets';
import { useBlockDefinitionStore } from '../../store/blockDefinitionStore';
import { blockIcon, blockLabel, hiddenAttrValue, isBlockHidden, showsTitleInRead, withBlockAttr } from '../../lib/blocks/blockAttrs';
import { BLOCK_ATTR, type BlockAttrName, type BlockInstance } from '../../lib/blocks/types';
import { useBlockSessionStore, type BlockStackApi } from '../../store/blockSessionStore';
import { useTemplateNoticeStore } from '../../store/templateStore';
import { useUIStore } from '../../store/uiStore';
import { startTagsOf } from '../../lib/createItem';
import { applyTemplateFields, undoTemplateFields } from '../../store/templateApply';
import { areBlocksEmpty, instantiateTemplateBlocks, isTextBlockEmpty, type Template } from '../../lib/blocks/templates';
import TemplateInsertion, { type TemplateTarget } from '../templates/TemplateInsertion';
import { BLOCK_VIEWS } from './blockViews';
import { BlockStackContext, type BlockActionHandler, type BlockStackContextValue } from './blockStackContext';
import { addBlockActions, commonBlockActions, typeBlockActions } from './blockActions';
import BlockFrame from './BlockFrame';
import UnreadableBlock from './UnreadableBlock';
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
  /**
   * The complete serialised content after every change (→ `useEntryEditor.handleContentChange`).
   * Saving writes only the blocks that changed as rows (`planBlockWrite` in
   * `lib/blockStore.ts`); every section carries its block ID, so the store can tell.
   */
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
  /** New per mount: the sidebar's state (selection, menus) belongs to this mount only. */
  const [sessionId] = useState(generateId);
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

  // A selection belongs to one edit: the next one starts without.
  useEffect(() => {
    if (isEditing) return;
    const { selection, select } = useBlockSessionStore.getState();
    if (selection?.sessionId === sessionId) select(null);
  }, [isEditing, sessionId]);

  const resetEpoch = useExternalContentReset(initialContent, isEditing, blocksRef, setBlocks, onChangeRef);

  // What the blocks do to the entry (a loaded sigil: locked, concealed); all blocks see the same state.
  const effects = useMemo(() => entryEffects(blocks, { today: localIsoDay() }), [blocks]);

  const definitions = useBlockDefinitionStore((s) => s.definitions);

  const textHost = useTextEditorHost({
    isEditing,
    getOrder: () => textEditorKeys(blocksRef.current),
    getContainer: () => stackRef.current,
  });
  const { orderedEditors, targetEditor, focusOnMount } = textHost;

  // Where the blocks are: the entry and its date (none on a template's page).
  const createdAt = useEntryStore((s) => findEntry(s.entries, entryId)?.created_at);
  const blockCtx = useMemo(
    () => blockContext(createdAt ? { id: entryId, created_at: createdAt } : null),
    [entryId, createdAt],
  );

  // How the mounted views carry out their types' actions (`useBlockAction`), by block and action.
  const actionHandlers = useRef(new Map<string, BlockActionHandler>());
  const runAction = (blockId: string, actionId: string) => actionHandlers.current.get(actionKey(blockId, actionId))?.();

  const stackContext = useMemo<BlockStackContextValue>(() => ({
    // Only the first block that is an editor itself (a text block) carries the
    // page's placeholder ("Begin your record…"); further ones get a neutral one.
    placeholderFor: (blockId) =>
      blocksRef.current.find((b) => blockTextEditors(b).includes(''))?.id === blockId
        ? placeholder
        : t('blocks.types.text.placeholder'),
    registerAction: (blockId, actionId, handler) => {
      const key = actionKey(blockId, actionId);
      actionHandlers.current.set(key, handler);
      return () => {
        if (actionHandlers.current.get(key) === handler) actionHandlers.current.delete(key);
      };
    },
  }), [placeholder, t]);

  /* ---------------- Link requests from the sidebar ---------------- */

  // "Linked entries" lists only the links of blocks that count them (a hidden
  // block only where its type says so, `blockCountsLinks`); adding, removing
  // and jumping act on the same blocks, never on one the list passes over.
  const linkingEditor = useCallback((): ((key: string) => boolean) => {
    const keys = new Set(textEditorKeys(blocksRef.current.filter(blockCountsLinks)));
    return (key) => keys.has(key);
  }, []);
  const linkingEditors = useCallback(() => orderedEditors(linkingEditor()), [orderedEditors, linkingEditor]);

  /**
   * Append a link, unless it is already somewhere in the entry. The target is
   * the editor the registry picks; if there is no text block at all, one is
   * created with the link as its content.
   */
  const appendLinkOnce = useCallback((item: EntryLinkRequest) => {
    if (linkingEditors().some((ed) => findEntryLinkPos(ed.state.doc, item) !== null)) return;
    const target = targetEditor(linkingEditor());
    if (target && editorHas(target, 'internalLink')) {
      appendEntryLink(target, item);
      return;
    }
    commit([...blocksRef.current, createTextBlock(
      internalLinkBlockHtml(toInternalLinkChip(item), item.categoryLabel ?? '', { separator: false }),
    )]);
  }, [linkingEditors, linkingEditor, targetEditor, commit]);

  /**
   * Links outside a mounted text editor (a link field) — by the blocks'
   * references, as "Linked entries" lists them (`blockLinksTo`). Jumping goes
   * to the first block that links to `target`; removing takes the link out of
   * the first block whose type can (`withoutLink`) — a block linking without
   * one (a block this app cannot read) is passed over.
   */
  const findBlockLink = useCallback((target: { id: string }) =>
    blocksRef.current.find((b) => blockCountsLinks(b) && blockLinksTo(b, target.id)) ?? null, []);
  const removeBlockLink = useCallback((target: { id: string }) => {
    for (const block of blocksRef.current.filter(blockCountsLinks)) {
      const next = blockWithoutLink(block, target.id, t);
      if (next === block) continue;
      apiRef.current.update(block.id, next);
      return true;
    }
    return false;
  }, [t]);

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
        if (linkingEditors().some((ed) => removeEntryLink(ed, target))) return true;
        return removeBlockLink(target);
      }),
    ];
    return () => off.forEach((fn) => fn());
  }, [isEditing, linkingEditors, appendLinkOnce, removeBlockLink]);

  // Click on a chip in the links field → jump to the spot. Also in
  // read mode, where it is the normal case. The first text editor with the
  // link wins; else the first block that links to it.
  useEffect(() => subscribeEntryLinkRequest(
    REVEAL_ENTRY_LINK_EVENT,
    (target) => {
      if (linkingEditors().some((ed) => revealEntryLink(ed, target))) return true;
      const hit = findBlockLink(target);
      if (!hit) return false;
      apiRef.current.reveal(hit.id);
      return true;
    },
  ), [linkingEditors, findBlockLink]);

  /* ---------------- Structural changes ---------------- */

  const [menu, setMenu] = useState<{ x: number; y: number; actions: ContextMenuAction[] } | null>(null);

  /**
   * A block that arose by a gesture (add, duplicate) is selected in the
   * sidebar, its settings expanded, and is scrolled to and highlighted once it
   * has rendered.
   */
  const pendingRevealRef = useRef<string | null>(null);
  const selectNew = (id: string) => {
    // With the sidebar closed the block is still selected, but its section is
    // not forced open later: someone may have collapsed it on purpose.
    const revealInSidebar = useUIStore.getState().rightSidebarOpen;
    useBlockSessionStore.getState().select({ sessionId, blockId: id, revealInSidebar });
    pendingRevealRef.current = id;
  };
  useEffect(() => {
    const id = pendingRevealRef.current;
    if (id === null) return;
    pendingRevealRef.current = null;
    apiRef.current.reveal(id);
  }, [blocks]);

  const insertAt = (index: number, presetId: string) => {
    const block = createFromPreset(presetId, definitions, t);
    if (!block) return;
    if (blockTextEditors(block).includes('')) focusOnMount(block.id);
    const next = [...blocksRef.current];
    next.splice(index, 0, block);
    commit(next);
    selectNew(block.id);
  };

  const duplicate = (id: string) => {
    if (!blocksRef.current.some((b) => b.id === id)) return;
    const id2 = generateId();
    // Each type says how it copies (a charged sigil stays charged). The sidebar passes through here as well.
    commit(withDuplicatedBlock(blocksRef.current, id, id2));
    selectNew(id2);
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
    el.toggleAttribute('data-reveal-first', isFirstVisibleItem(el));
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
    const next = areBlocksEmpty(blocksRef.current) ? added : [...blocksRef.current, ...added];
    commit(next.length > 0 ? next : [createTextBlock()]);
    const { flush } = templateTarget;
    // Save the deferred input first: title and tags are checked against the store.
    void flush()
      .then(() => applyTemplateFields(entryId, template))
      .then(() => {
        // A block that locks the entry (a loaded sigil) ends the edit: the entry can only be read until it is lifted.
        if (!entryEffects(blocksRef.current, { today: localIsoDay() }).lockEntry) return;
        const { activeView, setActiveView } = useUIStore.getState();
        if (activeView.id === entryId) setActiveView({ ...activeView, mode: 'view', isNew: undefined });
      })
      .catch((e: unknown) => console.error('[BlockStack] applying template fields failed:', e));
  };

  /** Undo after the automatic insertion: empty stack, title and tags of the template reverted. */
  const undoTemplate = (template: Template) => {
    if (!templateTarget) return;
    commit([createTextBlock()]);
    // The dashboard's start tag was there before the template: Undo leaves it.
    const view = useUIStore.getState().activeView;
    const keep = view.type === 'entry' && view.id === entryId ? startTagsOf(view.dashboard ?? 'all') : [];
    const { flush } = templateTarget;
    void flush()
      .then(() => undoTemplateFields(entryId, template, keep))
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
    insert: insertAt, duplicate, remove, reorder, setAttr, update: updateBlock, reveal, runAction,
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
      runAction: (id, actionId) => live()?.runAction(id, actionId),
      liveBlocks: () => live()?.liveBlocks() ?? [],
      openTemplatePicker: () => live()?.openTemplatePicker(),
    };
  }, []);
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

  const openBlockMenu = (e: MouseEvent, block: BlockInstance, meta: BlockTypeDef | undefined) => {
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
        // The live block: a setting must not write back a text block's HTML from the last structural change.
        ...typeBlockActions(t, blocksRef.current.find((b) => b.id === block.id) ?? block, {
          run: (actionId) => runAction(block.id, actionId),
          update: (next) => updateBlock(block.id, next),
        }),
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

  const renderBody = (block: BlockInstance, meta: BlockTypeDef | undefined) => {
    // A block another one conceals as a whole is not shown (a block conceals its own parts in its view).
    if (effects.concealed.has(block.id)) return null;
    const state = blockReadState(block);
    const View = meta ? BLOCK_VIEWS.get(meta.id) : undefined;
    if (state !== 'readable' || !View) return <UnreadableBlock reason={state === 'broken' ? 'broken' : 'newer'} />;
    return (
      <BlockErrorBoundary block={block}>
        <View
          block={block}
          isEditing={isEditing}
          onHtmlChange={(html) => updateHtml(block.id, html)}
          onBlockChange={(next) => updateBlock(block.id, next)}
          // A locked entry: no change even from read mode — except by the block
          // that locks it, so the lock can be lifted where it was set (unloading).
          onPersist={!isEditing && onReadModeChange && (!effects.lockEntry || effects.lockedBy.has(block.id))
            ? (next) => persistRead(block.id, next)
            : undefined}
          effects={effects}
          context={blockCtx}
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
    <BlockStackContext.Provider value={stackContext}>
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
          const label = blockLabel(t, block);
          return (
            <StackItem key={`${block.id}:${resetEpoch}`} id={block.id}>
              {(startDrag) => (
                <>
                  <BlockFrame
                    isEditing={isEditing}
                    icon={blockIcon(block) ?? Puzzle}
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

/**
 * Is nothing visible above this slot of the stack? The first block one can see
 * starts at the scroll area's top edge, which would cut off the flash ring's
 * overhang (`data-reveal-first` in index.css). Hidden and empty blocks before
 * it keep their zero-height slot, so `:first-child` cannot tell. The attribute
 * may stay after the flash; the CSS only reads it together with the flash class.
 */
function isFirstVisibleItem(el: Element): boolean {
  for (let prev = el.previousElementSibling; prev; prev = prev.previousElementSibling) {
    if (prev.getBoundingClientRect().height > 0) return false;
  }
  return true;
}

/** The key of a view's action handler. */
function actionKey(blockId: string, actionId: string): string {
  return `${blockId}\u0000${actionId}`;
}

/**
 * The keys of the stack's text editors in block order — those each block
 * holds (`textEditors`): a text block under its ID, a custom block's text
 * fields under `<block ID>:<key>`.
 */
function textEditorKeys(blocks: BlockInstance[]): string[] {
  return blocks.flatMap((block) => blockTextEditors(block).map((key) => textEditorKey(block.id, key)));
}

/** The blocks of a content, each at its type's data version (`upgradeBlock`); an empty entry gets an empty text block. */
function blocksFromContent(content: string): BlockInstance[] {
  const parsed = parseBlocks(content).map(upgradeBlock);
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
  // Only for the look: a dragged block gets an opaque surface (index.css),
  // until it has sprung back into its slot after release. The ref keeps the
  // end of an earlier snap-back from clearing a drag that started again.
  const [dragging, setDragging] = useState(false);
  const draggingRef = useRef(false);
  return (
    <Reorder.Item
      as="div"
      value={id}
      dragListener={false}
      dragControls={controls}
      transition={REORDER_SPRING}
      onDragStart={() => { draggingRef.current = true; setDragging(true); }}
      onDragEnd={() => { draggingRef.current = false; }}
      onDragTransitionEnd={() => { if (!draggingRef.current) setDragging(false); }}
      style={{ position: 'relative' }}
      className={dragging ? 'block-stack-item block-stack-item--dragging' : 'block-stack-item'}
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
