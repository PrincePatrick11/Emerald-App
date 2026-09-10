import {
  useCallback, useEffect, useMemo, useReducer, useRef, useState,
  type MouseEvent, type MutableRefObject, type PointerEvent, type ReactNode,
} from 'react';
import { Reorder, useDragControls } from 'framer-motion';
import type { Editor } from '@tiptap/react';
import { useTranslation } from 'react-i18next';
import { Eye, EyeOff, Plus, Puzzle, RefreshCw } from 'lucide-react';
import ContextMenu, { type ContextMenuAction } from '../ui/ContextMenu';
import EditorToolbar from '../editor/EditorToolbar';
import LinkPickerModal from '../editor/LinkPickerModal';
import DragGhost from '../editor/DragGhost';
import ImageFormatErrorModal from '../editor/ImageFormatErrorModal';
import { useEditorFileDrop } from '../editor/useEditorFileDrop';
import { useEditorPointerDrops } from '../editor/useEditorPointerDrops';
import { useInternalLinkNavigation } from '../editor/useInternalLinkNavigation';
import {
  appendEntryLink, findEntryLinkPos, insertImageFromDataUrl, insertInternalLinkChip,
  removeEntryLink, revealEntryLink,
} from '../editor/editorCommands';
import {
  APPEND_ENTRY_LINK_EVENT, REMOVE_ENTRY_LINK_EVENT, REVEAL_ENTRY_LINK_EVENT, subscribeEntryLinkRequest,
  type EntryLinkRequest,
} from '../../lib/links';
import { internalLinkBlockHtml, toInternalLinkChip } from '../../lib/internalLinkHtml';
import { generateId } from '../../lib/helpers';
import { editorSavesSuspended } from '../../lib/editorLock';
import { FIELDS_BLOCK_TYPE, linkFromSlot, parseFields, serializeFields } from '../../lib/blocks/fields';
import { useFieldFallbackText } from './useFieldFallbackText';
import { REORDER_SPRING } from '../../lib/motion';
import { flashReveal, scrollIntoViewCentered } from '../../lib/reveal';
import { createTextBlock, neutralizeSectionTags, parseBlocks, serializeBlocks } from '../../lib/blocks/blockHtml';
import { resolveBlockType, type BlockTypeMeta } from '../../lib/blocks/blockTypes';
import { blockIcon, createFromPreset } from '../../lib/blocks/presets';
import { blockOrigin, isOutdatedCopy, updateInstanceToDefinition, type BlockDefinition } from '../../lib/blocks/definitions';
import { useBlockDefinitionStore } from '../../store/blockDefinitionStore';
import { blockLabel, hiddenAttrValue, isBlockHidden, showsTitleInRead, withBlockAttr } from '../../lib/blocks/blockAttrs';
import { BLOCK_ATTR, TEXT_BLOCK_TYPE, type BlockAttrName, type BlockInstance } from '../../lib/blocks/types';
import { useBlockSessionStore, type BlockStackApi } from '../../store/blockSessionStore';
import { BLOCK_VIEWS } from './blockViews';
import { BlockStackContext, type BlockStackContextValue } from './blockStackContext';
import { addBlockActions, commonBlockActions } from './blockActions';
import { useTextEditorRegistry } from './useTextEditorRegistry';
import BlockFrame from './BlockFrame';
import UnknownBlock from './UnknownBlock';
import BlockErrorBoundary from './BlockErrorBoundary';

interface BlockStackProps {
  /** Der Eintrag, dem der Stapel gehört — die Seitenleiste bedient nur die passende Sitzung. */
  entryId: string;
  /**
   * Nur der INITIALWERT, wie bei RichEditor: der Stapel ist danach
   * unkontrolliert. Die Views mounten ihn per `key` neu, wenn ein anderer
   * Eintrag geladen oder Cancel gedrückt wird.
   */
  initialContent: string;
  isEditing: boolean;
  /** Platzhalter des ersten Textblocks — der modulspezifische Text. */
  placeholder: string;
  /** Der komplette serialisierte Inhalt nach jeder Änderung (→ `useEntryEditor.handleContentChange`). */
  onChange: (content: string) => void;
  /**
   * Lesemodus: eine erlaubte Änderung (Checkliste abhaken, Ja/Nein) sofort
   * speichern — der Autosave von `useEntryEditor` läuft nur beim Bearbeiten.
   * Fehlt die Prop, bleibt der Lesemodus schreibgeschützt.
   */
  onReadModeChange?: (content: string) => void | Promise<unknown>;
}

const REVEAL_CLASS = 'block-stack-item--revealed';
/** Muss zur Dauer von `block-reveal` in index.css passen. */
const REVEAL_MS = 1600;

/**
 * Der Inhalt eines Eintrags als Stapel von Blöcken — Lesen und Bearbeiten.
 *
 * Er ist auch der eine Ansprechpartner für alles, was von außen in den Eintrag
 * schreibt oder dokumentweit lauscht: Link-Bitten der Seitenleiste, Navigation
 * per Chip-Klick, Drops (Dateien, Einträge aus der linken Liste, Routinen),
 * Toolbar und Linkauswahl. Das hing früher am einzelnen RichEditor; mit
 * mehreren Textblöcken würde sonst jede Bitte in jedem Block ausgeführt. Welcher
 * Editor eine Bitte bekommt, entscheidet `useTextEditorRegistry`. Die
 * Block-Verwaltung der Seitenleiste bedient ihn über `blockSessionStore`.
 *
 * Text-Eingaben ändern keinen React-State: das neue HTML landet in `blocksRef`
 * und geht serialisiert an `onChange`. State wird es erst bei
 * Strukturänderungen (hinzufügen, entfernen, verschieben, Attribute), damit
 * nicht jeder Tastendruck den ganzen Stapel neu rendert. `blocks[i].html` im
 * State ist deshalb nur der Stand beim letzten Strukturwechsel — der lebende
 * Stand steht im Ref (und im Editor).
 */
export default function BlockStack({ entryId, initialContent, isEditing, placeholder, onChange, onReadModeChange }: BlockStackProps) {
  const { t } = useTranslation();

  const [blocks, setBlocks] = useState<BlockInstance[]>(() => blocksFromContent(initialContent));
  const blocksRef = useRef(blocks);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const stackRef = useRef<HTMLDivElement>(null);

  const emit = useCallback(() => onChangeRef.current(serializeBlocks(blocksRef.current)), []);

  const commit = useCallback((next: BlockInstance[]) => {
    blocksRef.current = next;
    setBlocks(next);
    emit();
  }, [emit]);

  const updateHtml = useCallback((id: string, rawHtml: string) => {
    const html = neutralizeSectionTags(rawHtml);
    blocksRef.current = blocksRef.current.map((b) => (b.id === id ? { ...b, html } : b));
    emit();
  }, [emit]);

  // Absicherung, auf die sich nichts verlässt: beim Moduswechsel den State auf
  // den Ref-Stand ziehen. Der Baum bleibt derselbe (siehe BlockFrame) — falls
  // doch einmal etwas neu montiert, sieht es das zuletzt getippte HTML.
  useEffect(() => { setBlocks(blocksRef.current); }, [isEditing]);

  const resetEpoch = useExternalContentReset(initialContent, isEditing, blocksRef, setBlocks, onChangeRef);

  const definitions = useBlockDefinitionStore((s) => s.definitions);
  /** Die Definition, wenn der Block eine veraltete Kopie von ihr ist — dann gibt es „Block aktualisieren". */
  const outdatedDefinitionOf = (block: BlockInstance): BlockDefinition | undefined => {
    const origin = blockOrigin(block);
    const def = origin ? definitions.find((d) => d.id === origin.id) : undefined;
    return def && isOutdatedCopy(block, def) ? def : undefined;
  };

  const { registerTextEditor, orderedEditors, targetEditor, toolbarEditor, focusOnMount } =
    useTextEditorRegistry(() => blocksRef.current);

  const context = useMemo<BlockStackContextValue>(() => ({
    registerTextEditor,
    // Nur der erste Textblock trägt den Platzhalter des Moduls („Was ist heute
    // passiert?"); weitere Textblöcke einen neutralen.
    placeholderFor: (blockId) =>
      blocksRef.current.find((b) => b.type === TEXT_BLOCK_TYPE)?.id === blockId
        ? placeholder
        : t('blocks.types.text.placeholder'),
  }), [registerTextEditor, placeholder, t]);

  /**
   * Einen Link anhängen — außer er steht schon irgendwo im Eintrag. `preferred`
   * ist der Editor unter dem Zeiger bei einem Routine-Drop; ohne ihn gilt der
   * Ziel-Editor der Registry. Gibt es gar keinen Textblock, entsteht einer mit
   * dem Link als Inhalt.
   */
  const appendLinkOnce = useCallback((item: EntryLinkRequest, preferred?: Editor | null) => {
    if (orderedEditors().some((ed) => findEntryLinkPos(ed.state.doc, item) !== null)) return;
    const target = preferred ?? targetEditor();
    if (target) {
      appendEntryLink(target, item);
      return;
    }
    commit([...blocksRef.current, createTextBlock(
      internalLinkBlockHtml(toInternalLinkChip(item), item.categoryLabel ?? '', { separator: false }),
    )]);
  }, [orderedEditors, targetEditor, commit]);

  /* ---------------- Dokumentweite Zuhörer, einmal pro Eintrag ---------------- */

  useInternalLinkNavigation(!isEditing);
  const fileDrop = useEditorFileDrop(isEditing, targetEditor);
  const pointerDropActive = useEditorPointerDrops({
    enabled: isEditing,
    getEditors: orderedEditors,
    getContainer: () => stackRef.current,
    appendLink: appendLinkOnce,
  });

  /**
   * Das Verknüpfungs-Feld eines Feldblocks, das auf `target` zeigt — das
   * Verlinkungs-Feld der Seitenleiste listet auch diese Links (es liest den
   * ganzen Inhalt), also müssen Anspringen und Entfernen sie auch finden.
   */
  const fieldText = useFieldFallbackText();
  const fieldTextRef = useRef(fieldText);
  fieldTextRef.current = fieldText;
  const findFieldLink = useCallback((target: { id: string; entryType: string }) => {
    for (const block of blocksRef.current) {
      if (resolveBlockType(block)?.id !== FIELDS_BLOCK_TYPE) continue;
      const model = parseFields(block);
      if (model.broken) continue;
      const element = model.elements.find((el) => {
        const link = el.kind === 'link' ? linkFromSlot(model.slots[el.id]) : null;
        return link?.id === target.id && link.entryType === target.entryType;
      });
      if (element) return { block, model, elementId: element.id };
    }
    return null;
  }, []);

  // Anhängen und Entfernen aus dem Verlinkungs-Feld — nur im Edit-Modus. Bleibt
  // die Quittung aus, weiß das Feld, dass sein Klick ins Leere ging.
  useEffect(() => {
    if (!isEditing) return;
    const off = [
      subscribeEntryLinkRequest(APPEND_ENTRY_LINK_EVENT, (item) => {
        appendLinkOnce(item);
        return true;
      }),
      subscribeEntryLinkRequest(REMOVE_ENTRY_LINK_EVENT, (target) => {
        if (orderedEditors().some((ed) => removeEntryLink(ed, target))) return true;
        const hit = findFieldLink(target);
        if (!hit) return false;
        const slots = { ...hit.model.slots };
        delete slots[hit.elementId];
        apiRef.current.update(hit.block.id, serializeFields(hit.block, { ...hit.model, slots }, fieldTextRef.current));
        return true;
      }),
    ];
    return () => off.forEach((fn) => fn());
  }, [isEditing, orderedEditors, appendLinkOnce, findFieldLink]);

  // Klick auf einen Chip im Verlinkungs-Feld → zur Stelle springen. Auch im
  // Lesemodus, dort ist es der Normalfall. Der erste Textblock mit dem Link
  // gewinnt; steht er nur in einem Verknüpfungs-Feld, springt es dorthin.
  useEffect(() => subscribeEntryLinkRequest(
    REVEAL_ENTRY_LINK_EVENT,
    (target) => {
      if (orderedEditors().some((ed) => revealEntryLink(ed, target))) return true;
      const hit = findFieldLink(target);
      if (!hit) return false;
      apiRef.current.reveal(hit.block.id);
      return true;
    },
  ), [orderedEditors, findFieldLink]);

  /* ---------------- Strukturänderungen ---------------- */

  const [menu, setMenu] = useState<{ x: number; y: number; actions: ContextMenuAction[] } | null>(null);
  const [linkPickerOpen, setLinkPickerOpen] = useState(false);

  const insertAt = (index: number, presetId: string) => {
    const block = createFromPreset(presetId, definitions);
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
    const next = [...blocksRef.current];
    next.splice(index + 1, 0, { ...source, id: generateId(), attrs: { ...source.attrs } });
    commit(next);
  };

  const remove = (id: string) => commit(blocksRef.current.filter((b) => b.id !== id));

  const reorder = (ids: string[]) => {
    const current = blocksRef.current;
    const byId = new Map(current.map((b) => [b.id, b]));
    // Nur eine echte Umordnung übernehmen. Landet während eines Drags eine
    // Strukturänderung (ein Link aus der Seitenleiste legt einen Block an),
    // passt die ID-Liste des Drags nicht mehr — übernommen hieße das, einen
    // Block stillschweigend zu verlieren.
    if (ids.length !== current.length || ids.some((id) => !byId.has(id))) return;
    commit(ids.map((id) => byId.get(id)!));
  };

  const setAttr = (id: string, name: BlockAttrName, value: string | null) => {
    const block = blocksRef.current.find((b) => b.id === id);
    // Unveränderter Wert (Enter auf einem unveränderten Titel): kein Commit,
    // also auch kein Autosave und kein Neu-Rendern.
    if (!block || (block.attrs[name] ?? null) === value) return;
    commit(blocksRef.current.map((b) => (b.id === id ? withBlockAttr(b, name, value) : b)));
  };

  /** Den ganzen Block ersetzen (Feldblock, Seitenleisten-Abschnitt). */
  const updateBlock = (id: string, next: BlockInstance) => {
    if (next.id !== id) return;
    commit(blocksRef.current.map((b) => (b.id === id ? next : b)));
  };

  /**
   * Lesemodus: eine erlaubte Änderung sofort speichern. `updateBlock` meldet sie
   * AUCH an `onChange`, damit der Content-Mirror der View sie kennt — sonst
   * schriebe „Fertig" nach einem späteren Bearbeiten ohne Änderung den Stand von
   * vor dem Abhaken zurück.
   *
   * Wie der Autosave nicht, solange Speichern ausgesetzt ist (Backup-Import
   * ersetzt gerade den Vault). Die Store-Updates sind pro Eintrag serialisiert:
   * schnelle Klicks landen in Reihenfolge, der letzte Stand gewinnt.
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

  /* ---------------- Sitzung für die Seitenleiste ---------------- */

  // Die Handgriffe ändern sich pro Render (sie lesen die aktuelle Closure); die
  // Seitenleiste bekommt ein stabiles Objekt, das an die jeweils neuesten
  // weiterreicht. Stabil heißt: `clear` beim Unmount erkennt „seine" Sitzung.
  // Nach dem Abbau reicht es nichts mehr weiter — ein veralteter Aufruf käme
  // sonst über `onChange` im Eintrag an, der jetzt offen ist.
  const apiRef = useRef<BlockStackApi>(null!);
  apiRef.current = { insert: insertAt, duplicate, remove, reorder, setAttr, update: updateBlock, reveal };
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
    };
  }, []);
  const [sessionId] = useState(generateId);

  useEffect(() => {
    useBlockSessionStore.getState().publish({ sessionId, entryId, blocks, isEditing, api });
  }, [sessionId, entryId, blocks, isEditing, api]);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      useBlockSessionStore.getState().clear(api);
    };
  }, [api]);

  /* ---------------- Menüs und Darstellung ---------------- */

  const openAddMenu = (e: MouseEvent, index: number) => setMenu({
    x: e.clientX,
    y: e.clientY,
    actions: addBlockActions(t, (presetId) => insertAt(index, presetId), definitions),
  });

  const openBlockMenu = (e: MouseEvent, block: BlockInstance, meta: BlockTypeMeta | undefined) => {
    const hidden = isBlockHidden(block);
    const def = outdatedDefinitionOf(block);
    setMenu({
      x: e.clientX,
      y: e.clientY,
      actions: [
        // Wie jede Blockänderung über den Editor — Abbrechen dreht sie zurück.
        ...(def
          ? [{
              label: t('blocks.update'),
              icon: <RefreshCw size={12} />,
              onClick: () => updateBlock(block.id, updateInstanceToDefinition(block, def, fieldTextRef.current)),
            }]
          : []),
        {
          label: hidden ? t('blocks.show') : t('blocks.hide'),
          icon: hidden ? <Eye size={12} /> : <EyeOff size={12} />,
          onClick: () => setAttr(block.id, BLOCK_ATTR.hidden, hiddenAttrValue(!hidden)),
        },
        ...commonBlockActions(t, meta, { duplicate: () => duplicate(block.id), remove: () => remove(block.id) }),
      ],
    });
  };

  const renderBody = (block: BlockInstance, meta: BlockTypeMeta | undefined) => {
    const View = meta ? BLOCK_VIEWS.get(meta.id) : undefined;
    if (!View) return <UnknownBlock block={block} />;
    return (
      <BlockErrorBoundary block={block}>
        <View
          block={block}
          isEditing={isEditing}
          onHtmlChange={(html) => updateHtml(block.id, html)}
          onBlockChange={(next) => updateBlock(block.id, next)}
          onPersist={!isEditing && onReadModeChange ? (next) => persistRead(block.id, next) : undefined}
        />
      </BlockErrorBoundary>
    );
  };

  const stackClass = [
    'block-stack',
    blocks.length > 1 && 'block-stack--multi',
    (fileDrop.fileDragOver || pointerDropActive) && 'block-stack--drop-target',
  ].filter(Boolean).join(' ');

  return (
    <BlockStackContext.Provider value={context}>
      {isEditing && toolbarEditor && (
        <StackToolbar editor={toolbarEditor} onOpenLinkPicker={() => setLinkPickerOpen(true)} />
      )}

      {/* Lese- und Bearbeitungsmodus teilen denselben Baum: Reorder.Group ist
          im Lesemodus einfach träge, weil nur der Griff einen Drag startet. */}
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
                    hidden={isBlockHidden(block)}
                    showReadTitle={showsTitleInRead(block, meta)}
                    outdated={isEditing && !!outdatedDefinitionOf(block)}
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

      {menu && <ContextMenu x={menu.x} y={menu.y} actions={menu.actions} onClose={() => setMenu(null)} />}
      {isEditing && linkPickerOpen && toolbarEditor && (
        <LinkPickerModal
          onSelect={(item) => insertInternalLinkChip(toolbarEditor, item)}
          onClose={() => setLinkPickerOpen(false)}
        />
      )}
      {fileDrop.formatError && <ImageFormatErrorModal onClose={fileDrop.dismissFormatError} />}
      <DragGhost />
    </BlockStackContext.Provider>
  );
}

/** Die Blöcke eines Inhalts — ein leerer Eintrag bekommt einen leeren Textblock. */
function blocksFromContent(content: string): BlockInstance[] {
  const parsed = parseBlocks(content);
  return parsed.length > 0 ? parsed : [createTextBlock()];
}

/**
 * Von außen geänderter Inhalt, während der Eintrag gelesen wird — „Alle
 * aktualisieren" oder „aus Einträgen entfernen" in der Blöcke-Ansicht. Der
 * Stapel ist unkontrolliert und sähe es sonst erst nach einem Neuladen;
 * schlimmer, der Content-Mirror der View behielte den alten Stand, und
 * „Fertig" nach einem späteren Bearbeiten schriebe ihn zurück.
 *
 * Nur eine echte Änderung der Prop zählt, nie der Moduswechsel: nach „Fertig"
 * hinkt der Store kurz hinterher. Beim Bearbeiten gehört der Inhalt dem
 * Editor, und was der Stapel selbst geschrieben hat (Lesemodus-Abhaken), ist
 * schon sein Stand. Liefert eine Epoche für die Keys: ein Textblock liest sein
 * HTML nur beim Start und muss neu montieren.
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

/** Ein Listenplatz im Stapel. Gezogen wird nur am Griff — sonst ließe sich im
 *  Textblock kein Text mehr markieren. */
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

/** Die eine Toolbar des Stapels, gebunden an den fokussierten Textblock. Sie
 *  steht außerhalb der Editor-Komponente und rendert deshalb nicht von selbst
 *  mit jeder Transaktion neu — das holt der Zuhörer hier nach. */
function StackToolbar({ editor, onOpenLinkPicker }: { editor: Editor; onOpenLinkPicker: () => void }) {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    editor.on('transaction', rerender);
    return () => { editor.off('transaction', rerender); };
  }, [editor]);
  if (editor.isDestroyed) return null;
  return (
    <div className="block-stack-toolbar">
      <EditorToolbar
        editor={editor}
        onInsertImage={(dataUrl) => { void insertImageFromDataUrl(editor, dataUrl); }}
        onOpenLinkPicker={onOpenLinkPicker}
      />
    </div>
  );
}

/** Die Einfügelinie zwischen Blöcken. Bewusst kein `Button`: sie ist Teil des
 *  Dokuments, kein Aktionsknopf in einer Leiste — zwischen zwei Blöcken nur ein
 *  „+", das beim Überfahren erscheint, am Ende eine leise Textzeile. */
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
