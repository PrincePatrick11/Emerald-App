# Content Blocks

## Content Blocks

Journal, Wiki and Operations entries render their body as a vertical stack of blocks — `BlockStack` (`src/components/blocks/BlockStack.tsx`) inside `EntryDetailFrame`'s `body="scroll"`. The types are text (`core.text`, one `TextEditor` per block), fields (`core.fields`, which also carries user-built blocks and an operation's Status) and the three sigil blocks (`core.sigil.calc`/`.canvas`/`.charge`).

### Stored format

Blocks live in the `content` column, not a side table, so every pipeline that reads `content` (search, "Linked entries", image cleanup, merge-import link remapping, `.emerald`, backup, export) works without a special case. Each block is a top-level `<section data-block="<type>" data-block-id="<id>" …>inner HTML</section>` (`src/lib/blocks/blockHtml.ts`). Three rules carry the format:

1. Content *outside* a section is text: content with no wrapper is one text block, and raw HTML an import or migration appends becomes another.
2. A single text block with no further attributes is written **without** a wrapper.
3. Sections only appear at the top level; TipTap has no section node, so none can end up inside a text block.

`parseBlocks`/`serializeBlocks` are deliberately `DOMParser`-free, so migrations and `scripts/check-blocks.mjs` (`npm run check:blocks`, in CI) can run them under Node. Only `data-*` attributes are carried through. A block of an unknown type, or with a `data-block-v` newer than its registry entry, renders its inner HTML through DOMPurify (`UnknownBlock`), can only be moved or removed, and is written back untouched.

### Registry

Two halves, mirroring `modules.ts`/`moduleViews.ts`: `src/lib/blocks/` is pure (no React, stores or TipTap) because migrations and export use it; `src/components/blocks/blockViews.ts` maps a type to its component and is imported only by `BlockStack`, since the text block pulls in TipTap.

### The block stack

**One owner for document-wide listeners.** With several text blocks, a `document`-level listener per editor would let every request hit every block, so `BlockStack` is the host of the entry's text editors ([`editors.md`](editors.md#text-editor)): toolbar, link picker, chip-click navigation, OS file drops, pointer drops from the left list and `DragGhost` exist once per entry. The stack itself handles the three `lib/links.ts` link requests: append goes to the last-focused text block, else the last; reveal/remove try each block in order, then link and altar fields.

**Keystrokes don't re-render the stack.** A text block's HTML goes into `blocksRef` and, serialised, to `useEntryEditor.handleContentChange`; React state only changes on structural edits (add, duplicate, remove, reorder). Read and edit mode share one tree — `Reorder.Group` stays mounted and inert in read mode — because remounting a text block on a mode switch would rebuild it from the last structural snapshot instead of the latest keystrokes. Only the grip starts a drag (`dragListener={false}`), so text selection still works.

Every block sits in a `BlockErrorBoundary`, so one that throws shows its sanitized fallback instead of taking the app down. In read mode, `BlockStack` resets when `initialContent` changes to something other than its own serialisation and reports it to the view's content mirror, so a later Done can't restore the old content.

### Instance attributes

Any block can carry `data-block-hidden="1"` (gone in read mode via CSS, so the tree stays stable; greyed out while editing), `data-block-title` (its own title) and `data-block-show-title` (`"1"`/`"0"`, overriding the type's `defaultShowTitle`). Names are in `BLOCK_ATTR` (`lib/blocks/types.ts`), rules in `lib/blocks/blockAttrs.ts`. Being part of `content`, they revert with Cancel, and a text block back at its defaults is stored without a wrapper again (`showTitleAttrValue` drops a value equal to the default).

An empty text block is hidden in read mode too (`block-frame--hidden` when `!isEditing && isTextBlockEmpty(block)`), using the same `EMPTY_TEXT_RE` check as `areBlocksEmpty` (`lib/blocks/templates.ts`). It reads the live block off `blocksRef`, since leaving edit mode can otherwise render one frame behind the just-cleared text.

### Fields block

`core.fields` (`lib/blocks/fields.ts`) is a sequence of labelled elements: text, short text, number, date, choice, yes/no, checklist, link, image, moon phase, altar (a link restricted to altars, shown full width with the altar's picture) and the sigil parts (`isSigilKind`, see [Sigils](#sigils)). A single field is a one-element fields block, named and iconed after it. "Add block" offers one preset per kind (`lib/blocks/presets.ts`) except `text` (the Text block covers it) and the sigil parts, which only exist in user-built blocks.

- `data-block-config` (JSON): elements and display rules (`readHideEmpty`, `readOnly`).
- `data-block-data` (JSON): scalar values by element id (a sigil part's whole data JSON counts as its value). Values of unknown elements are kept and written back (`orphans`).
- **Text, links, images and altars are markup, never JSON** (`isSlotKind`): editor HTML, a real link chip or `<img src>` in a `<dd data-block-slot="el:<id>">`, so link and image pipelines see them without a special case.
- The inner HTML is also the readable fallback (a `<dl>`) for search, export and apps that don't know the type; it is rewritten on every change, while the JSON stays the truth for scalars.

`canBeEmpty(kind)` is false for yes/no, drawing and charge, so the sidebar and builder skip "hide when empty" for them. A `text` element registers with the stack's editor registry as `<blockId>:<elementId>`, so toolbar, link requests and drops treat it like a text block; it is builder-only and has no prefill, since that would put markup into the definition.

`FieldsBlock` is controlled: each change is a new block through `onBlockChange`. In read mode, checklist items and yes/no switches can be toggled unless the block is `readOnly`, through `onPersist` → `BlockStack.persistRead`, which updates the stack (so the content mirror and the next Cancel baseline know it) and calls `onReadModeChange` — the views pass `update*(id, { content })`, since `useEntryEditor` only autosaves while editing. Nothing is written while editor saves are suspended (backup import).

Element ids may come from an import: they must match `[A-Za-z0-9_-]{1,64}` and not name an `Object.prototype` property, and `values`/`orphans`/`slots` are prototype-less — otherwise a crafted id would read a built-in property as slot HTML and crash the render.

### Sidebar block manager

The right sidebar and the main area are sibling trees, so `BlockStack` publishes its structure (on structural changes only) plus a stable API (`insert`, `duplicate`, `remove`, `reorder`, `setAttr`, `update`, `reveal`, …) to `useBlockSessionStore` (`src/store/blockSessionStore.ts`), like `uiStore.editActions`.

- The API object is created once and forwards to the latest closures through a ref, so `clear(api)` on unmount only removes that stack's own session — a remount (Cancel, entry switch) may already have replaced it. After unmount it forwards nothing, or a stale call would reach the now-open entry.
- Each mount gets a fresh `sessionId`, keying the sidebar's manager so an open menu or rename can't outlive a Cancel remount.
- Only edit mode writes: a read-mode sidebar view gets no `setAttr`, since the change would miss autosave and be swallowed by the next Cancel baseline.

`BlockSidebarArea` (rendered by `RightSidebar` for modules with `ModuleMeta.usesBlocks`, rows described in [components.md](../components.md)) shows the session only if its `entryId` matches the open entry. Types can add settings via `components/blocks/blockSidebarViews.ts` (read/edit variant; so far only the fields block's edit view), expanded in a box under the selected row. `blockSidebarViews.ts` must never import TipTap: the sidebar is loaded eagerly.

### Sigils

**Sigil blocks (`lib/blocks/sigil.ts`)**: calculator, drawing, charge; migration v42 (`migrateLegacySigils.ts`) converts the old sigil rows into them. The drawing is the canvas editor's paint vector document as block data plus its rendered image (`saveImage`) referenced by `<img src>`; `parseSigilDrawing` and `withSigilDrawing` read and write both, and a drawing from before the vector format opens with its image as the first layer (see [Editors](editors.md#canvas-editor)). The save may finish after Done: `SigilCanvasBlock` keeps it in the part that stays mounted, writes through `onPersist` if editing has ended, and drops the result if the stack was unmounted.

**Charges.** A `SigilCharge`'s `targets` are the block ids it covers, or `null` for every calculator and drawing in the entry, including later ones (the default); `chargeCovers` is the one check. `chargeConceals(charge, today)` is true for a loaded charge until its `revealDate` — and indefinitely without one, so a charge loaded without a date stays hidden until unloaded. `sigilState(blocks, today)` folds all loaded charges into one `SigilState`:

- `concealed`: `Map<blockId, revealDate | null>`; on overlap the later date wins, `null` beating any date;
- `locked`: every block id a loaded charge covers, concealed or not (read-only while editing);
- `lockEntry`: some loaded charge locks the whole entry;
- `revealDate`: for cards and lists only — the first loaded charge's, else the first charge's.

**Parts of a user-built block.** The same three kinds exist as fields elements. A part is a **virtual block** with id `<blockId>:<elementId>` (`sigilPartId`): `sigilPartBlock` builds it from the fields model (element value as `data-block`, slot HTML as `html`), `withSigilPart` writes it back. `sigilUnits(blocks)` yields every real sigil block and every part (`SigilUnit[]`), and everything downstream — `sigilState`, `entrySummary`, `withoutConcealed`, PDF/Markdown export — goes through it, so both forms behave identically. `withoutElementContent`/`withElementValue` blank a concealed part's content or write back a charge part's state. `mayHoldSigil`/`mayHoldCharge` are string pre-filters that skip parsing; they also match bare kind names, since an imported part's JSON may quote them differently.

**Copies of a loaded sigil stay loaded.** Duplicating is always allowed and the copy stays as loaded: `withRenamedPartTargets` retargets charge parts inside the copy, and `withChargesCoveringCopy` adds the copy to every other charge covering the original (unneeded for `targets: null`). `duplicateEntry` keeps content as is: block ids, and so charge targets, stay the same within the copy. Templates carry a sigil the same way: saving an entry as a template and inserting a template keep what is drawn and loaded, and `instantiateTemplateBlocks` only maps the charge targets to the new ids. Appended to an entry with content, `withChargesCoveringOnly` turns a template charge's `targets: null` into the template's own calculators and drawings, so it does not conceal what the entry already held.

**State and writes.** `BlockStack` computes the state once per structure and passes it to every view as `sigil`; lists, sidebar and menu use `entryBlockSummary`. Loading and unloading are read-mode writes through `onPersist`. Under a full-entry lock, `onPersist` still reaches the charge and any fields block holding one (`holdsCharge`), since unloading is the one write such a lock must permit.

### User-built blocks

**Copies, without any link.** The Blocks view (`views/BlocksView.tsx`, on the rail) is a `Dashboard` of `block_definitions` rows (`blockDefinitionStore`) with a read-only "Built-in blocks" section (`BLOCK_PRESETS`) below. `{ type: 'blocks', id }` renders `BlockDefinitionEditor`, a page shaped like an entry in edit mode, its sidebar parts portalled via `SidebarPortal` (see [List Header Portal](editing.md#list-header-portal)); page shell and draft lifecycle (`LibraryPageFrame`, `useDraftPage`) are shared with [the template page](templates.md#the-dashboard-and-the-template-page). The icon is an emoji or an image shrunk to 64px (`useShrunkIcon`), since it travels inside every copy; `BlockGlyph` renders either.

**Definition:** name, icon, elements and display rules (`readHideEmpty`, `readOnly`, plus `showTitle`, which becomes the instance attribute on insert). Removing a field removes it from the definition; `parseDefinitionElements` also drops a field an earlier version archived.

**Inserting** (`createFromPreset('def:<id>', …)` → `instantiateDefinition`) writes a `core.fields` block that carries everything itself — elements without `defaultValue`, display rules, name, icon (`lib/blocks/definitions.ts`) — and nothing that points back. Editing or deleting the definition changes no entry and no template, and `FieldsSidebarEdit` edits a copy's settings directly. Older copies still carry `data-block-origin`, `data-block-rev` and `data-template-origin`, which nothing reads, and may hold archived elements (`ElementDef.archived` — invisible, value kept).

**Prefills (`ElementDef.defaultValue`)** are what a *new* copy starts with; their stored shapes are in [`block_definitions`](../database.md#block_definitions). `slotFromDefault`/`defaultFromSlot` convert link/altar/image defaults to and from slot HTML. `defaultsOf(elements, blockId)` turns defaults into values for a *specific* block: charge `targets` become `<blockId>:<elementId>`, and checklist items get fresh ids per copy. That is why `instantiateDefinition` takes a `text: FallbackText` — writing values renders the fallback. Calculator and drawing parts start empty; their builder settings (`calcMode`, `brushColor`/`brushSize`) sit on the element and are inherited. A `select` default naming a removed option is dropped on read (`parseDefault`).

**Deleting** goes straight to the Trash with Undo (`BlocksView.remove`; the draft is cleared only once the delete worked). Copies stay.

### Drafts

A block page edits a **draft**; only Done calls `updateDefinition`. The draft is mirrored into `useBlockDraftStore` (`store/draftStore.ts`, see [the template page](templates.md#the-dashboard-and-the-template-page)) rather than view state, since `MainArea` unmounts a view on module switch; the list reads it for its "Unsaved" marker.

Drafts are written along into the vault's `drafts.json` (debounced, `write_vault_drafts`), so a crash loses nothing that was typed.

- `restoreDrafts(vaultId)` reads them back when a vault opens, through the parsers a database row goes through (`parseDefinitionElements`, `parseAssignments`, …); the previous vault's drafts only leave memory.
- `DRAFTS_VERSION` is 2: a version-1 file's template tag names are mapped to ids (see [Tags](modules.md#tags)); a newer file is left untouched and nothing is written for that vault this session.
- `flushDrafts()` writes what is pending and waits — before the window closes and before an update installs, so a discarded draft doesn't return after the restart.
- A replace-mode restore calls `clearAllDrafts()` and then `flushDrafts()` (and closes every tab), or a stale draft would overwrite a freshly restored block on the next Done.

### Prefills across backup and `.emerald`

A definition's `elements` JSON is the only place a prefill's image filename or link/altar target lives before a copy exists, so it needs its own remap: `definitionImageRefs` feeds the image list `exportDatabase` embeds and `collectUsedImageFilenames` protects, and `remapDefinitionDefaults` rewrites defaults during backup merge/replace and `.emerald` import, dropping a link default that resolves to nothing (see [`database.md`](../database.md#block_definitions)).
