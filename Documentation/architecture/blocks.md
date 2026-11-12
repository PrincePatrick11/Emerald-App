# Content Blocks

## Content Blocks

Journal, Wiki and Operations entries render their body as a vertical stack of blocks — `BlockStack` (`src/components/blocks/BlockStack.tsx`) inside `EntryDetailFrame`'s `body="scroll"`. The types are text (`core.text`, one `TextEditor` per block), fields (`core.fields`, which also carries user-built blocks, an operation's Status and a sigil's calculator and charge), canvas and altar (`core.canvas`, `core.altar`) and paint (`core.paint`, also a sigil's drawing).

### Stored format

Since v65 every block of an entry or a template is a row of its own in [`blocks`](../database.md#blocks), with what it points at in [`block_refs`](../database.md#block_refs). The stores load a stack from the rows in `position` order and save only the blocks that changed (`planBlockWrite` in `src/lib/blockStore.ts`): a keystroke writes its own block, a move writes one position (`lib/blocks/position.ts`), and each written block's references are rewritten (`lib/blocks/blockRefs.ts`). A row holds the block losslessly (`lib/blocks/blockRows.ts`): the instance attributes in columns of their own, every other attribute in `attrs`, the inner HTML in `html`, plain text for the search in `text`.

Since v66 the rows are the only record. "Images", the image cleanup and a type change ask `block_refs`; filtering by field values goes through SQLite's JSON functions on `blocks.data` (`lib/blocks/blockQuery.ts`). In memory the stores still hold an owner's stack as one string (`content`, what `contentOf` makes of the rows): search, "Linked entries", export, templates and sigil concealment read that, since it is what is being typed. The format below is that string's, the one `BlockStack` hands to `useEntryEditor`, the one `.emerald`, backup files and sync carry, and the one older files are read in — see [`database.md`](../database.md#blocks). Each block is a top-level `<section data-block="<type>" data-block-id="<id>" …>inner HTML</section>` (`src/lib/blocks/blockHtml.ts`); the instance attributes are written in a fixed order (`orderedBlockAttrs`), then any others in theirs. Three rules carry the format:

1. Content *outside* a section is text: content with no wrapper is one text block, and raw HTML an import or migration appends becomes another.
2. A single text block with no further attributes is written **without** a wrapper. Its ID is not in `content` then; its row keeps the one it was saved under (`blocksOfContent`).
3. Sections only appear at the top level; TipTap has no section node, so none can end up inside a text block.

`parseBlocks`/`serializeBlocks` are deliberately `DOMParser`-free, so migrations and `scripts/check-blocks.mjs` (`npm run check:blocks`, in CI) can run them under Node. `parseBlocks` finds tags with a linear scanner (`htmlTags`), not a regular expression: markup arrives from imports and other devices, and a backtracking pattern over crafted markup (thousands of `<a` without a `>`) takes minutes. Only `data-*` attributes are carried through. A block of an unknown type, or with a `data-block-v` newer than its registry entry, renders its inner HTML through DOMPurify (`UnknownBlock`), can only be moved or removed, and is written back untouched.

### Registry

Two halves, mirroring `modules.ts`/`moduleViews.ts`: `src/lib/blocks/` is pure (no React, stores or TipTap) because migrations and export use it; `src/components/blocks/blockViews.ts` maps a type to its component and is imported only by `BlockStack`, since the text block pulls in TipTap.

### The block stack

**One owner for document-wide listeners.** With several text blocks, a `document`-level listener per editor would let every request hit every block, so `BlockStack` is the host of the entry's text editors ([`editors.md`](editors.md#text-editor)): toolbar, link picker, chip-click navigation, OS file drops, pointer drops from the left list and `DragGhost` exist once per entry. The stack itself handles the three `lib/links.ts` link requests: append goes to the last-focused text block, else the last; reveal/remove try each block in order, then link fields.

**Keystrokes don't re-render the stack.** A text block's HTML goes into `blocksRef` and, serialised, to `useEntryEditor.handleContentChange`; React state only changes on structural edits (add, duplicate, remove, reorder). Read and edit mode share one tree — `Reorder.Group` stays mounted and inert in read mode — because remounting a text block on a mode switch would rebuild it from the last structural snapshot instead of the latest keystrokes. Only the grip starts a drag (`dragListener={false}`), so text selection still works.

Every block sits in a `BlockErrorBoundary`, so one that throws shows its sanitized fallback instead of taking the app down. In read mode, `BlockStack` resets when `initialContent` changes to something other than its own serialisation and reports it to the view's content mirror, so a later Done can't restore the old content.

### Instance attributes

Any block can carry `data-block-hidden="1"` (gone in read mode via CSS, so the tree stays stable; greyed out while editing), `data-block-title` (its own title) and `data-block-show-title` (`"1"`/`"0"`, overriding the type's `defaultShowTitle`). Names are in `BLOCK_ATTR` (`lib/blocks/types.ts`), rules in `lib/blocks/blockAttrs.ts`. Being part of `content`, they revert with Cancel, and a text block back at its defaults is stored without a wrapper again (`showTitleAttrValue` drops a value equal to the default).

An empty text block is hidden in read mode too (`block-frame--hidden` when `!isEditing && isTextBlockEmpty(block)`), using the same `EMPTY_TEXT_RE` check as `areBlocksEmpty` (`lib/blocks/templates.ts`). It reads the live block off `blocksRef`, since leaving edit mode can otherwise render one frame behind the just-cleared text.

### Fields block

`core.fields` (`lib/blocks/fields.ts`) is a sequence of labelled elements: text, short text, number, date, choice, yes/no, checklist, link, image, moon phase and the sigil parts (`isSigilKind`, see [Sigils](#sigils)). A single field is a one-element fields block, named and iconed after it. "Add block" offers one preset per kind (`lib/blocks/presets.ts`) except `text` (the Text block covers it) and the sigil parts, which come as the three sigil presets instead (see [Sigils](#sigils)). A fields block that is a calculator or charge on its own (`soleSigilElement`: no copied name, the one element `calc` or `charge`) shows the part itself, without a label row and without sidebar settings (`FieldsBlock`, `BlockSidebarArea`, the export alike); a user-built block with a single sigil part keeps its label row.

- `data-block-config` (JSON): elements and display rules (`readHideEmpty`, `readOnly`).
- `data-block-data` (JSON): scalar values by element id (a sigil part's whole data JSON counts as its value). Values of unknown elements are kept and written back (`orphans`).
- **Text, links and images are markup, never JSON** (`isSlotKind`): editor HTML, a real link chip or `<img src>` in a `<dd data-block-slot="el:<id>">`, so link and image pipelines see them without a special case.
- The inner HTML is also the readable fallback (a `<dl>`) for search, export and apps that don't know the type; it is rewritten on every change, while the JSON stays the truth for scalars.

`canBeEmpty(kind)` is false for yes/no, drawing and charge, so the sidebar and builder skip "hide when empty" for them. A `text` element registers with the stack's editor registry as `<blockId>:<elementId>`, so toolbar, link requests and drops treat it like a text block; it is builder-only and has no prefill, since that would put markup into the definition.

`FieldsBlock` is controlled: each change is a new block through `onBlockChange`. In read mode, checklist items and yes/no switches can be toggled unless the block is `readOnly`, through `onPersist` → `BlockStack.persistRead`, which updates the stack (so the content mirror and the next Cancel baseline know it) and calls `onReadModeChange` — the views pass `update*(id, { content })`, since `useEntryEditor` only autosaves while editing. Nothing is written while editor saves are suspended (backup import).

Element ids may come from an import: they must match `[A-Za-z0-9_-]{1,64}` and not name an `Object.prototype` property, and `values`/`orphans`/`slots` are prototype-less — otherwise a crafted id would read a built-in property as slot HTML and crash the render.

### Sidebar block manager

The right sidebar and the main area are sibling trees, so `BlockStack` publishes its structure (on structural changes only) plus a stable API (`insert`, `duplicate`, `remove`, `reorder`, `setAttr`, `update`, `reveal`, …) to `useBlockSessionStore` (`src/store/blockSessionStore.ts`), like `uiStore.editActions`.

- The API object is created once and forwards to the latest closures through a ref, so `clear(api)` on unmount only removes that stack's own session — a remount (Cancel, entry switch) may already have replaced it. After unmount it forwards nothing, or a stale call would reach the now-open entry.
- Each mount gets a fresh `sessionId`, keying the sidebar's manager so an open menu or rename can't outlive a Cancel remount.
- Only edit mode writes: a read-mode sidebar view gets no `setAttr`, since the change would miss autosave and be swallowed by the next Cancel baseline.

`BlockSidebarArea` (rendered by `RightSidebar` for modules with `ModuleMeta.usesBlocks`, rows described in [components.md](../components.md)) shows the session only if its `entryId` matches the open entry. Types can add settings via `components/blocks/blockSidebarViews.ts` (read/edit variant; the fields block's and the canvas block's edit views), expanded in a box under the selected row. `blockSidebarViews.ts` must never import TipTap: the sidebar is loaded eagerly.

### Canvas block

**`core.canvas` and `core.altar` (`lib/blocks/canvas.ts`, `CanvasBlock`)**: a scene of the canvas editor in an entry. The altar is the same block with "Images" below it by default (`defaultCanvasParts`), a type of its own so that it is offered, named and iconed as one (icon `AltarIcon`, `lib/altarIcon.ts`). The built-in template `core-altar` starts an operation of the Altars category with an altar on a night background and a text block (`altarBlockSet`). Altar fields of older vaults and files became link fields to the operation that took the altar's place (see [Altars as operations](editors.md#altars-as-operations)). The data JSON holds the artboard's size (1600 × 1000 for a new one), the elements as the canvas editor has them, the background, the guides and their lock; a picture element keeps its stored file in `ref` and `props.src`, a drawing its compact JSON, and the adapter turns a file into a URL to show and back. `storedCanvasElement` is the one place for that stored form (the block and the altar conversion both write through it), `storedImageElement` a picture placed new. The config JSON holds the parts the block offers (`CanvasParts`: "Images" below, shapes, text, symbols, drawing; without config, the type's defaults), set in the sidebar (`CanvasSidebarEdit`); a part switched off adds nothing new, what is on the canvas stays. Next to the parts it holds `tag`, the tag "Images" below show ('' for all; an altar without one starts with "Altar Library", see [Canvas blocks](editors.md#canvas-blocks)). The inner HTML lists the rendered picture first (`data-canvas="render"`), then each picture once (`data-canvas="image"`) and the background picture (`data-canvas="background"`), so backups, `.emerald`, exports and the image cleanup find them like any other image. A `.emerald` import that stores a picture under another name replaces that name in the scene JSON too (`remapImages` in `emeraldFormat.ts`): a stored name is a hash and stands for nothing else. Every change goes into the block at once. The PNG is rendered from data URLs on Done, when the scene differs from the one editing started with (Cancel brings that one back) or the block has no render yet (an altar converted from an older vault), and goes in through `onPersist`, only if the block still holds the scene it shows; a render per change would leave a file behind each time. The picture it replaces is removed once the entry is saved, unless something else still shows it (`discardRenders` in `imageStore.ts`). Read mode shows the scene in the canvas editor, the PDF and Markdown export the rendered picture (`exportRender.ts`); a block without one, such as an altar converted from an older vault (the conversion renders nothing), is left out of them until its first Done. The canvas editor's export dialog renders the scene at the chosen format, area, width and background (`exportedScene`; JPEG flattened on white) and saves it through `savePictureAs` (`lib/pictureExport.ts`: the save dialog under `<block type>_<yyyy-MM-dd>.<ext>` from `exportFilename` in `lib/export.ts`, every export's default name, then `export_image`). For "Images", a canvas's pictures are shown (role `content`), its render is the thing itself; `withoutCanvasFile` takes a picture's elements out, and the render with them until the canvas is next edited.

### Paint block

**`core.paint` (`lib/blocks/paint.ts`, `PaintBlock`)**: a drawing of its own (`parseDrawing`/`withDrawing`): the paint vector document as block data, the rendered picture and each layer's picture as `<img>` in the HTML. Its pictures are in `block_refs` as `render` and `layer` (`blockRefs.ts`): "Images" lists neither, and taking a picture out of a block never touches a drawing — nor a custom block's drawing part, whose slot `withoutImage` leaves alone; the export shows the rendered picture. Marked in its config (`{"sigil":true}`, `isSigilDrawing`) it is a sigil's drawing: named "Sigil drawing" with the pen icon (`blockTypeLabel`, `blockIcon`), title shown, painted in the sigil's colours (`SigilCanvasBlock`), and concealed and locked by charges. An unmarked paint block is none of that.

### Sigils

**Sigils (`lib/blocks/sigil.ts`)**: calculator, drawing, charge. Calculator and charge are always elements of a fields block (kinds `sigilCalc`, `sigilCharge`) — on their own a fields block with that one element (`createSigilCalcBlock`/`createSigilChargeBlock`: element IDs `calc`/`charge`, `readHideEmpty: false`, title shown). The drawing is a sigil paint block (see [Paint block](#paint-block)) or a drawing part (`sigilCanvas`); either way the canvas editor's paint vector document plus its rendered image (`saveImage`), and a drawing from before the vector format opens with its image as the first layer (see [Editors](editors.md#canvas-editor)). The save may finish after Done: `DrawingBlock` keeps it in the part that stays mounted, writes through `onPersist` if editing has ended, and drops the result if the stack was unmounted. Up to v63 the three were block types of their own; v64 and every import convert them (`legacySigilBlocks.ts`, see [Sigil Workflow](../database.md#sigil-workflow)), and migration v42 (`migrateLegacySigils.ts`) still writes that old form from the sigil rows before v64 converts it.

**Charges.** A `SigilCharge`'s `targets` are the unit ids it covers (`<blockId>:<elementId>` for a part, the block id for a sigil paint block), or `null` for every calculator and drawing in the entry, including later ones (the default); `chargeCovers` is the one check. `chargeConceals(charge, today)` is true for a loaded charge until its `revealDate` — and indefinitely without one, so a charge loaded without a date stays hidden until unloaded. `sigilState(blocks, today)` folds all loaded charges into one `SigilState`:

- `concealed`: `Map<blockId, revealDate | null>`; on overlap the later date wins, `null` beating any date;
- `locked`: every block id a loaded charge covers, concealed or not (read-only while editing);
- `lockEntry`: some loaded charge locks the whole entry;
- `revealDate`: for cards and lists only — the first loaded charge's, else the first charge's.

**Units.** A part is a **virtual block** with id `<blockId>:<elementId>` (`sigilPartId`) and its element kind as type: `sigilPartBlock` builds it from the fields model (element value as `data-block`, slot HTML as `html`), `withSigilPart` writes it back. `sigilUnits(blocks)` yields every sigil paint block and every part (`SigilUnit[]`), and everything downstream — `sigilState`, `entrySummary`, `withoutConcealed`, PDF/Markdown export — goes through it, so a sigil on its own and one inside a user-built block behave identically. `withoutElementContent`/`withElementValue` blank a concealed part's content or write back a charge part's state. `mayHoldSigil`/`mayHoldCharge` are string pre-filters that skip parsing; they match bare kind names, since an imported part's JSON may quote them differently.

**Copies of a loaded sigil stay loaded.** Duplicating is always allowed and the copy stays as loaded: `withRenamedPartTargets` retargets charge parts inside the copy, and `withChargesCoveringCopy` adds the copy to every other charge covering the original (unneeded for `targets: null`). `duplicateEntry` keeps content as is: block ids, and so charge targets, stay the same within the copy. Templates carry a sigil the same way: saving an entry as a template and inserting a template keep what is drawn and loaded, and `instantiateTemplateBlocks` only maps the charge targets to the new ids. Appended to an entry with content, `withChargesCoveringOnly` turns a template charge's `targets: null` into the template's own calculators and drawings, so it does not conceal what the entry already held.

**State and writes.** `BlockStack` computes the state once per structure and passes it to every view as `sigil`; lists, sidebar and menu use `entryBlockSummary`. Loading and unloading are read-mode writes through `onPersist`. Under a full-entry lock, `onPersist` still reaches any fields block holding a charge (`holdsCharge`), since unloading is the one write such a lock must permit.

### User-built blocks

**Copies, without any link.** The Blocks view (`views/BlocksView.tsx`, on the rail) is a `Dashboard` of `block_definitions` rows (`blockDefinitionStore`) with a read-only "Built-in blocks" section (`BLOCK_PRESETS`) below. `{ type: 'blocks', id }` renders `BlockDefinitionEditor`, a page shaped like an entry in edit mode, its sidebar parts portalled via `SidebarPortal` (see [List Header Portal](editing.md#list-header-portal)); page shell and draft lifecycle (`LibraryPageFrame`, `useDraftPage`) are shared with [the template page](templates.md#the-dashboard-and-the-template-page). The icon is an emoji or an image shrunk to 64px (`useShrunkIcon`), since it travels inside every copy; `BlockGlyph` renders either.

**Definition:** name, icon, elements and display rules (`readHideEmpty`, `readOnly`, plus `showTitle`, which becomes the instance attribute on insert). Removing a field removes it from the definition; `parseDefinitionElements` also drops a field an earlier version archived.

**Inserting** (`createFromPreset('def:<id>', …)` → `instantiateDefinition`) writes a `core.fields` block that carries everything itself — elements without `defaultValue`, display rules, name, icon (`lib/blocks/definitions.ts`) — and nothing that points back. Editing or deleting the definition changes no entry and no template, and `FieldsSidebarEdit` edits a copy's settings directly. Older copies still carry `data-block-origin`, `data-block-rev` and `data-template-origin`, which nothing reads, and may hold archived elements (`ElementDef.archived` — invisible, value kept).

**Prefills (`ElementDef.defaultValue`)** are what a *new* copy starts with; their stored shapes are in [`block_definitions`](../database.md#block_definitions). `slotFromDefault`/`defaultFromSlot` convert link/image defaults to and from slot HTML. `defaultsOf(elements, blockId)` turns defaults into values for a *specific* block: charge `targets` become `<blockId>:<elementId>`, and checklist items get fresh ids per copy. That is why `instantiateDefinition` takes a `text: FallbackText` — writing values renders the fallback. Calculator and drawing parts start empty; their builder settings (`calcMode`, `brushColor`/`brushSize`) sit on the element and are inherited. A `select` default naming a removed option is dropped on read (`parseDefault`).

**Deleting** goes straight to the Trash with Undo (`BlocksView.remove`; the draft is cleared only once the delete worked). Copies stay.

### Drafts

A block page edits a **draft**; only Done calls `updateDefinition`. The draft is mirrored into `useBlockDraftStore` (`store/draftStore.ts`, see [the template page](templates.md#the-dashboard-and-the-template-page)) rather than view state, since `MainArea` unmounts a view on module switch; the list reads it for its "Unsaved" marker.

Drafts are written along into the vault's `drafts.json` (debounced, `write_vault_drafts`), so a crash loses nothing that was typed.

- `restoreDrafts(vaultId)` reads them back when a vault opens, through the parsers a database row goes through (`parseDefinitionElements`, `parseAssignments`, …); the previous vault's drafts only leave memory.
- `DRAFTS_VERSION` is 2: a version-1 file's template tag names are mapped to ids (see [Tags](modules.md#tags)); a newer file is left untouched and nothing is written for that vault this session.
- `flushDrafts()` writes what is pending and waits — before the window closes and before an update installs, so a discarded draft doesn't return after the restart.
- A replace-mode restore calls `clearAllDrafts()` and then `flushDrafts()` (and closes every tab), or a stale draft would overwrite a freshly restored block on the next Done.

### Prefills across backup and `.emerald`

A definition's `elements` JSON is the only place a prefill's image filename or link target lives before a copy exists, so it needs its own remap: `definitionImageRefs` feeds the image list `exportDatabase` embeds and `collectUsedImageFilenames` protects, and `remapDefinitionDefaults` rewrites defaults during backup merge/replace and `.emerald` import, dropping a link default that resolves to nothing (see [`database.md`](../database.md#block_definitions)).
