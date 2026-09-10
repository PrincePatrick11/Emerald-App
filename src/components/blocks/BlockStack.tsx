import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type MouseEvent, type PointerEvent, type ReactNode } from 'react';
import { Reorder, useDragControls } from 'framer-motion';
import type { Editor } from '@tiptap/react';
import { useTranslation } from 'react-i18next';
import { Copy, Plus, Puzzle, Trash2 } from 'lucide-react';
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
import { createTextBlock, neutralizeSectionTags, parseBlocks, serializeBlocks } from '../../lib/blocks/blockHtml';
import { BLOCK_TYPE_LIST, resolveBlockType, type BlockTypeMeta } from '../../lib/blocks/blockTypes';
import { TEXT_BLOCK_TYPE, type BlockInstance } from '../../lib/blocks/types';
import { BLOCK_VIEWS } from './blockViews';
import { BlockStackContext, type BlockStackContextValue } from './blockStackContext';
import { useTextEditorRegistry } from './useTextEditorRegistry';
import BlockFrame from './BlockFrame';
import UnknownBlock from './UnknownBlock';

interface BlockStackProps {
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
}

/** Ein neuer, leerer Block dieses Typs. Bisher gibt es nur Text; weitere
 *  Typen bringen hier ihre Standarddaten mit. */
function newBlock(type: string): BlockInstance | null {
  return type === TEXT_BLOCK_TYPE ? createTextBlock() : null;
}

/**
 * Der Inhalt eines Eintrags als Stapel von Blöcken — Lesen und Bearbeiten.
 *
 * Er ist auch der eine Ansprechpartner für alles, was von außen in den Eintrag
 * schreibt oder dokumentweit lauscht: Link-Bitten der Seitenleiste, Navigation
 * per Chip-Klick, Drops (Dateien, Einträge aus der linken Liste, Routinen),
 * Toolbar und Linkauswahl. Das hing früher am einzelnen RichEditor; mit
 * mehreren Textblöcken würde sonst jede Bitte in jedem Block ausgeführt. Welcher
 * Editor eine Bitte bekommt, entscheidet `useTextEditorRegistry`.
 *
 * Text-Eingaben ändern keinen React-State: das neue HTML landet in `blocksRef`
 * und geht serialisiert an `onChange`. State wird es erst bei
 * Strukturänderungen (hinzufügen, entfernen, verschieben), damit nicht jeder
 * Tastendruck den ganzen Stapel neu rendert. `blocks[i].html` im State ist
 * deshalb nur der Stand beim letzten Strukturwechsel — der lebende Stand steht
 * im Ref (und im Editor).
 */
export default function BlockStack({ initialContent, isEditing, placeholder, onChange }: BlockStackProps) {
  const { t } = useTranslation();

  const [blocks, setBlocks] = useState<BlockInstance[]>(() => {
    const parsed = parseBlocks(initialContent);
    return parsed.length > 0 ? parsed : [createTextBlock()];
  });
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

  // Anhängen und Entfernen aus dem Verlinkungs-Feld — nur im Edit-Modus. Bleibt
  // die Quittung aus, weiß das Feld, dass sein Klick ins Leere ging.
  useEffect(() => {
    if (!isEditing) return;
    const off = [
      subscribeEntryLinkRequest(APPEND_ENTRY_LINK_EVENT, (item) => {
        appendLinkOnce(item);
        return true;
      }),
      subscribeEntryLinkRequest(REMOVE_ENTRY_LINK_EVENT, (target) =>
        orderedEditors().some((ed) => removeEntryLink(ed, target))),
    ];
    return () => off.forEach((fn) => fn());
  }, [isEditing, orderedEditors, appendLinkOnce]);

  // Klick auf einen Chip im Verlinkungs-Feld → zur Stelle springen. Auch im
  // Lesemodus, dort ist es der Normalfall. Der erste Textblock mit dem Link gewinnt.
  useEffect(() => subscribeEntryLinkRequest(
    REVEAL_ENTRY_LINK_EVENT,
    (target) => orderedEditors().some((ed) => revealEntryLink(ed, target)),
  ), [orderedEditors]);

  /* ---------------- Strukturänderungen ---------------- */

  const [menu, setMenu] = useState<{ x: number; y: number; actions: ContextMenuAction[] } | null>(null);
  const [linkPickerOpen, setLinkPickerOpen] = useState(false);

  const insertAt = (index: number, type: string) => {
    const block = newBlock(type);
    if (!block) return;
    if (type === TEXT_BLOCK_TYPE) focusOnMount(block.id);
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

  const openAddMenu = (e: MouseEvent, index: number) => setMenu({
    x: e.clientX,
    y: e.clientY,
    actions: BLOCK_TYPE_LIST.map((meta) => {
      const Icon = meta.icon;
      return { label: t(meta.labelKey), icon: <Icon size={12} />, onClick: () => insertAt(index, meta.id) };
    }),
  });

  const openBlockMenu = (e: MouseEvent, block: BlockInstance, known: boolean) => setMenu({
    x: e.clientX,
    y: e.clientY,
    actions: [
      // Ein unbekannter Block lässt sich nur verschieben und entfernen — eine
      // Kopie seiner Daten wäre ohne den Typ, der sie versteht, nichts wert.
      ...(known ? [{ label: t('contextMenu.duplicate'), icon: <Copy size={12} />, onClick: () => duplicate(block.id) }] : []),
      { label: t('blocks.remove'), icon: <Trash2 size={12} />, onClick: () => remove(block.id), danger: true },
    ],
  });

  const renderBody = (block: BlockInstance, meta: BlockTypeMeta | undefined) => {
    const View = meta ? BLOCK_VIEWS.get(meta.id) : undefined;
    if (!View) return <UnknownBlock block={block} />;
    return <View block={block} isEditing={isEditing} onHtmlChange={(html) => updateHtml(block.id, html)} />;
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
          return (
            <StackItem key={block.id} id={block.id}>
              {(startDrag) => (
                <>
                  <BlockFrame
                    isEditing={isEditing}
                    icon={meta?.icon ?? Puzzle}
                    label={meta ? t(meta.labelKey) : t('blocks.unknown', { type: block.type })}
                    onGripPointerDown={startDrag}
                    onOpenMenu={(e) => openBlockMenu(e, block, !!meta)}
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
      transition={{ type: 'spring', stiffness: 520, damping: 38, mass: 0.65 }}
      style={{ position: 'relative' }}
      className="block-stack-item"
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
