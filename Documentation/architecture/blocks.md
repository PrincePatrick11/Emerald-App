# Content Blocks

## Content Blocks

Journal, Wiki and Operations entries render their body as a vertical stack of blocks —
`BlockStack` (`src/components/blocks/BlockStack.tsx`) inside `EntryDetailFrame`'s
`body="scroll"`. The block types are text (`core.text`, one `RichEditor` per block), fields
(`core.fields`, below — which also carries the user-built blocks of the Blocks view and an
operation's Status) and the three sigil blocks (`core.sigil.calc`/`.canvas`/`.charge`, below).

**Stored format.** Blocks live in the existing `content` column, not in a side table — every
pipeline that already reads `content` (search, the "Linked entries" field, image cleanup,
merge-import link remapping, `.emerald`, backup, export) keeps working unchanged. Each block is a top-level
`<section data-block="<type>" data-block-id="<id>" …>inner HTML</section>`
(`src/lib/blocks/blockHtml.ts`). Three rules carry the format:

1. Content *outside* a block section is text. Legacy content with no wrapper at all is one text
   block, and raw HTML that an import or migration appends becomes another — no migration was
   needed.
2. A single text block with no further attributes is written **without** a wrapper. Most
   entries therefore stay byte-for-byte what they were.
3. Sections only ever appear at the top level; TipTap has no section node, so none can end up
   inside a text block.

`parseBlocks`/`serializeBlocks` are deliberately `DOMParser`-free (like `extractInternalLinks`),
so migrations and `scripts/check-blocks.mjs` (`npm run check:blocks`, also in CI) can use them
under Node. Only `data-*` attributes are carried through; a block of a type this version doesn't
know, or with a `data-block-v` newer than its registry entry, renders its inner HTML through
DOMPurify (`UnknownBlock`), can only be moved or removed, and is written back untouched.

**Registry, two halves** — mirroring `modules.ts`/`moduleViews.ts`. `src/lib/blocks/`
(`types.ts`, `blockTypes.ts`, `blockHtml.ts`) is pure: types, `lucide-react` and other pure
`lib` modules only — no React, stores or TipTap — because migrations and export will need it.
`src/components/blocks/blockViews.ts` maps a type to its component; only `BlockStack` imports it,
since the text block pulls in TipTap.

**One owner for document-wide listeners.** Everything that used to hang off each `RichEditor`
at `document` level now lives once per open entry in `BlockStack`, because with several text
blocks every request would otherwise hit every block: the three `lib/links.ts` link requests
(append goes to the last-focused text block, else the last one; reveal/remove try each block in
order), chip-click navigation (`useInternalLinkNavigation`), file drops from the OS
(`useEditorFileDrop`), pointer drops from the left list (`useEditorPointerDrops`, which finds
the editor under the pointer and always clears the drag — it dropped its routine branch when
routines were removed, see [Templates](templates.md#templates)), the drag ghost
(`DragGhost`), the one sticky `EditorToolbar` bound to the focused editor, and `LinkPickerModal`.
`RichEditor` itself is now just a text block's writing surface; the link commands it used to
keep private live in `src/components/editor/editorCommands.ts`.

**Keystrokes don't re-render the stack.** A text block's new HTML goes into `blocksRef` and,
serialised, to `useEntryEditor.handleContentChange`; React state only changes on structural
edits (add, duplicate, remove, reorder). Read and edit mode share one component tree —
`Reorder.Group` stays mounted and is simply inert in read mode, `BlockFrame` keeps its body at
the same position — because a mode switch that remounted a text block would rebuild it from the
last structural snapshot rather than the latest keystrokes. Reordering uses framer-motion's
`Reorder` with `dragListener={false}`; only the grip starts a drag, so text selection still works.

**Instance attributes.** Every block, whatever its type, can carry `data-block-hidden="1"`
(hidden: gone in read mode — via CSS, so the tree stays stable — greyed out while editing),
`data-block-title` (its own title instead of the type name) and `data-block-show-title`
(`"1"`/`"0"`, overriding the type's `defaultShowTitle` for the read-mode heading). The names
live in `BLOCK_ATTR` (`lib/blocks/types.ts`), the rules in `lib/blocks/blockAttrs.ts`. Because
they sit on the block, they are part of `content`: Cancel reverts them with the text, and a
text block whose switches are back at their defaults is stored without a wrapper again
(`showTitleAttrValue` drops a value that equals the default).

An empty text block gets the same read-mode treatment as a hidden one without carrying
`data-block-hidden` itself: `BlockStack` applies `block-frame--hidden` whenever
`!isEditing && isTextBlockEmpty(block)`. `isTextBlockEmpty` (`lib/blocks/templates.ts`) is the
same `EMPTY_TEXT_RE` check `areBlocksEmpty` already used to decide whether an entry counts as
still empty for defaulting — `areBlocksEmpty` now just adds the "no template origin" condition
on top of it. The check reads the live block off `blocksRef` rather than the block passed in
from the last structural render, since leaving edit mode (e.g. pressing "Done") can otherwise
render one frame behind the just-cleared text.

**Fields block (`core.fields`, `lib/blocks/fields.ts`).** A sequence of labelled elements —
short text, number, date, choice, yes/no, checklist, link, image, moon phase, altar (a link
restricted to altars, rendered full width with the altar's own picture), and the three sigil
parts `sigilCalc`/`sigilCanvas`/`sigilCharge` (`isSigilKind`, below). A single field is a
fields block with one element; "add block" offers one preset per kind except the sigil parts,
which only exist inside a user-built block (`lib/blocks/presets.ts`), and a one-element block is
named and iconed after its element. Where things live follows the content convention:
`data-block-config` (JSON) holds the elements and display rules (`readHideEmpty`, `readOnly`),
`data-block-data` (JSON) the scalar values keyed by element id (a sigil part's whole data JSON
counts as its "value" here), and **links, images and altars are markup, never JSON** — a real
internal-link chip or `<img src>` inside a `<dd data-block-slot="el:<id>">` (`isSlotKind`). That
keeps the "Linked entries" field, merge-import remapping and image cleanup working with no
special case. The inner HTML doubles as the readable fallback (a `<dl>` of label and value) for
search, export and apps that don't know the type; it is rewritten on every change, while the JSON
stays the truth for scalars. Values whose element is unknown are kept and written back
(`orphans`). `canBeEmpty(kind)` says which kinds even have an "empty" state to hide — yes/no,
drawing and charge never do, so the sidebar and the Blocks builder skip the "hide when empty"
checkbox for them. `FieldsBlock` is controlled: every render reads the block, every change writes
a new one through `onBlockChange` (a structural commit). In read mode, checklist items and yes/no
switches can be toggled unless the block is `readOnly`: the change goes through `onPersist` →
`BlockStack.persistRead`, which also calls `onChange` so the view's content mirror (and the next
Cancel baseline) know it, and then `onReadModeChange` — the views pass `update*(id, { content })`,
since `useEntryEditor` only autosaves while editing. Element ids come from content and may come
from an import: they must match `[A-Za-z0-9_-]{1,64}` and must not name an `Object.prototype`
property (`constructor`, `__proto__`, …), and `values`/`orphans`/`slots` are prototype-less
records — otherwise a crafted id would read a built-in property as slot HTML and the render would
throw. As a second layer, `BlockStack` wraps every block in `BlockErrorBoundary`, so a block that
throws shows its sanitized fallback instead of taking the app down.

**Prefilling an element (`ElementDef.defaultValue`).** Only meaningful on a block definition
(below): the value every *new* copy starts with. A scalar kind stores the value itself; `link`
and `altar` store `{id, entryType, label}` (`LinkDefault`) rather than a chip, and `image` stores
the stored filename rather than an `<img>` — none of it is markup yet, so a definition row needs
no internal-link or image-cleanup special-casing. `slotFromDefault`/`defaultFromSlot` convert
between that shape and the slot HTML a copy actually needs, only at the point a copy is created
or the builder reads one back. `sigilCharge`'s default is `ChargeDefault {lock, targets}`, with
`targets` holding *element* ids — a definition doesn't know its future copies' block ids, so
`defaultsOf` (`definitions.ts`) qualifies them into `<blockId>:<elementId>` only once a concrete
copy's block id exists. `sigilCalc`/`sigilCanvas` prefill their *builder settings* instead
(`calcMode`, `brushColor`/`brushSize` on the element itself, not `defaultValue`) — a calculator or
drawing always starts empty. A `select` default that names an option the definition no longer has
is dropped on read (`parseDefault`), so a stale prefill can't hand a copy a dead choice.

**`withoutElementContent`/`withElementValue`** rewrite a fields block's value and/or slot for one
or more element ids without touching anything else — used to blank out a concealed sigil part's
content (search, export, the `UnknownBlock` fallback) and to write back a charge part's new
"loaded" state on unload, respectively.

**Sidebar block manager.** The right sidebar and the main area are sibling trees, so `BlockStack`
publishes its structure — on structural changes only, not per keystroke — plus a stable API
(`insert`/`duplicate`/`remove`/`reorder`/`setAttr`/`reveal`) to `useBlockSessionStore`
(`src/store/blockSessionStore.ts`), the same idea as `uiStore.editActions`. The API object is
created once and forwards to the latest closures through a ref, so `clear(api)` on unmount only
removes the session that stack itself published — a remount (Cancel, entry switch) may already
have replaced it. After unmount the API forwards nothing: a stale call would otherwise reach the
now-open entry through the view's `onChange`. Each mount gets a fresh `sessionId`, which keys the
sidebar's manager so an open menu or rename can't outlive a Cancel remount. Only edit mode
writes: renaming is edit-only, and a type's read-mode sidebar view gets no `setAttr` — a change
made in read mode would miss autosave and be swallowed by the next Cancel baseline. `BlockSidebarArea`, rendered by `RightSidebar` for modules with
`ModuleMeta.usesBlocks`, shows the session only if its `entryId` matches the open entry: in edit
mode a reorderable list with eye, rename, "show title in read mode", duplicate and remove; in
read mode an outline whose rows jump to their block, only when there is more than one. Block types
can contribute their own settings via `components/blocks/blockSidebarViews.ts` (read/edit variant
each; so far only the fields block's edit view): clicking such a row's label jumps to the block and
expands the settings in a box directly under the row — like the Altar's placed elements, one at a
time, moving with the row when dragged. Both lists reorder through `hooks/usePointerReorder.ts`,
without animation — a row simply jumps to its new place while dragged. `blockSidebarViews.ts` must never import TipTap: the sidebar is loaded
eagerly.

A fields block's **`text` element** is the text block's own `RichEditor`; its HTML lives in the
element's slot like a link chip or image, so the "Linked entries" field, image cleanup and import
remap see it unchanged. It registers with the stack's editor registry as `<blockId>:<elementId>`, so the
toolbar, sidebar link requests and drops treat it like a text block at its block's position. It is
only offered in the Blocks builder (the standalone Text block already covers the "Add block" menu)
and has no prefill, since that would put markup into the definition.

**Sigil blocks (`lib/blocks/sigil.ts`).** Calculator, drawing and charge replace the former
`OperationSigilView` and its columns (migration v42, `migrateLegacySigils.ts`). The drawing is an
image file (`saveImage`) referenced by `<img src>` in the canvas block, loaded into the canvas as a
data URL (`readImageAsBase64`) — an `emerald-img:` URL would taint the canvas and `toDataURL` would
throw. Saving is asynchronous and may finish after Done; `SigilCanvasBlock` keeps the save in the
part that stays mounted across modes and writes through `onPersist` if editing has ended, and drops
the result if the stack was unmounted (another entry may own it now).

A charge (`SigilCharge`) now also carries **`targets`**: the block ids of the calculators and
drawings it covers, or `null` for every one currently in the entry, including ones added later —
how every charge behaved before targeting existed, and still the default. `chargeCovers(charge,
blockId)` is the one check; `chargeConceals(charge, today)` says whether a *loaded* charge is
still hiding what it covers right now — true for as long as there's no `revealDate` at all, which
is how a charge loaded without a target date stays hidden until it is explicitly unloaded, rather
than showing an unset date as already past. `sigilState(blocks, today)` folds every readable,
loaded charge together into one `SigilState`: `concealed` (a `Map<blockId, revealDate | null>` —
several charges can each hide their own blocks, and where two charges cover the same block the
later `revealDate` wins, `null` meaning "until unload" beating any date), `locked` (the `Set` of
block ids *any* loaded charge covers, concealed or not — read-only while editing), and `lockEntry`
(true if any loaded charge locks the whole entry). `revealDate` on the state itself is only what a
card or list shows, from the first loaded charge, or the first charge at all if none is loaded.

**Parts of a user-built block.** The same three kinds exist as fields-block elements
(`sigilCalc`/`sigilCanvas`/`sigilCharge`, `isSigilKind` in `fields.ts`) — a block you assemble in
the Blocks view can hold a calculator, a drawing and a charge next to its other fields. A part
is treated as a **virtual block** with id `<blockId>:<elementId>` (`sigilPartId`): `sigilPartBlock`
builds one from the fields block's model (the element's JSON value as `data-block`, its slot HTML
as the block's own `html`), and `withSigilPart` writes a changed virtual block back into the
model. `sigilUnits(blocks)` walks every real sigil block *and* every sigil part of every fields
block in one pass, returning `SigilUnit[]` (`{ block, part? }`) — everything downstream that used
to scan for `core.sigil.*` types (`sigilState`, `entrySummary`, `withoutConcealed`,
`withChargeUnloaded`, PDF/Markdown export) now goes through it, so a charge or a hidden calculator
behaves identically whether it's a standalone block or a part. `mayHoldSigil`/`mayHoldCharge` are
the cheap string pre-filters (looking for `core.sigil.` *or* the bare kind names `sigilCalc` etc.,
since an imported part's JSON may quote them differently) that let most content skip parsing
entirely, replacing the old single-marker check.

**Copies of a loaded sigil stay loaded.** `blockHoldsLocked(state, blockId)` says whether a
block itself or any part of it (`<blockId>:*`) is in `state.locked`; `isSigilFrozen(block, state)`
adds "or the block *is* a loaded charge" — what a user-built block's own update/removal (below)
needs to know, since rebuilding the block would silently drop the charge that's currently hiding
something. Duplicating is always allowed, and the copy is as loaded as the original:
`withRenamedPartTargets` retargets any charge part inside the copy from the original block's id to
the copy's own, and `withChargesCoveringCopy` adds the copy (or its parts) to every charge
*elsewhere* in the entry that covers the original — without that, the copy would get a fresh id
no charge covers and show what the original hides. A charge that covers everything
(`targets: null`) needs neither. Whole entries copy the same way: `duplicateEntry`,
`duplicateArticle` and `duplicateOperation` keep the content as it is, charge included, since the
block ids stay the same within the copy. Only a template unloads (`withChargeUnloaded` in
`instantiateTemplateBlocks` and `contentForTemplate`): a blueprint carries no charge.

The entry's sigil state is computed once per structure by `BlockStack` and passed to every view as
`sigil`; lists, sidebar and menu read it from `entryBlockSummary` (which now also finds the first
visible, non-concealed drawing among parts, not just top-level canvas blocks). Loading and
unloading are read-mode writes through `onPersist`, like ticking a checklist — `onPersist` on a
locked-entry block is still allowed for the charge itself (or a fields block that contains one,
`holdsCharge` in `BlockStack`), since unloading is the one write a full-entry lock must still
permit.

**User-built blocks — copies, not live links.** The Blocks view (`views/BlocksView.tsx`, an aux
view on the rail) is a `Dashboard` list of `block_definitions` rows (v40, `blockDefinitionStore`),
built like every other module's list rather than the built-in-blocks overview it replaced;
clicking a row opens `{ type: 'blocks', id }`, which `BlocksView` renders as
`BlockDefinitionEditor` — a page shaped like an entry in edit mode (back link and name as
title, fields below; Done/Delete/Cancel, icon, display rules and usage portalled into the right
sidebar via `SidebarPortal`, see [List Header Portal](editing.md#list-header-portal)) instead of the list.
A definition's icon is an emoji or an image (`Favicon`, shrunk to 64px edge —
`shrinkImageDataUrl` re-encodes anything still heavy after that, e.g. a large embedded thumbnail
or a long GIF animation — via `shrinkImage.ts`, since it travels inside every copy in every
entry); `BlockGlyph` renders either. What's being edited is a **draft**: `BlockDefinitionEditor`
keeps it in local state and only calls `updateDefinition` on Done, so a keystroke in the name
doesn't bump every copy's revision. An unsaved draft is mirrored into `useBlockDraftStore`
(`src/store/draftStore.ts`, one `createDraftStore<T>()` instance of two — the other backs
templates, see [Templates](templates.md#templates) below) — not the view's own state, since `MainArea`
unmounts a view on module switch and an open block tab would otherwise lose its edits silently;
the list reads the same store for its "Unsaved" marker. Drafts are written along into
`drafts.json` in the vault folder (debounced, through `write_vault_drafts`), so a crash takes
nothing that was typed — what the autosave does for an entry. `restoreDrafts(vaultId)` reads
them back when a vault opens (at boot and after a switch), passing every entry through the
same parsers a database row goes through (`parseDefinitionElements`, `parseAssignments`, …) and
dropping a file of another version — except a version-1 file (`DRAFTS_VERSION` is 2 since
v53), whose template drafts get their tag names mapped to ids (see [Tags](modules.md#tags)); the previous vault's drafts only leave memory, their file
stays with that vault. `flushDrafts()` writes what is pending and waits for it — called before
the window closes and before an update installs, so a draft that was just discarded does not
come back after the restart. `clearAllDrafts()` empties memory, and the `flushDrafts()` right
after it the file, on a replace-mode restore, which also closes every tab — a stale draft would otherwise silently overwrite a
freshly restored block on the next Done. Deleting a definition asks nothing unless copies exist: `BlocksView.remove` sends a definition with no copies in entries or templates straight to the Trash with an Undo toast (a failure is logged and leaves block and draft alone; the draft is cleared only after the delete worked). Only with copies does the delete confirmation (`DeleteDefinitionModal`,
still defined in `BlockDefinitionEditor.tsx`) open, asking whether to remove them too; it is *hosted* by `BlocksView`, one level up
from both list and page, so its own closing notice ("N entries left open, skipped") survives the
navigation back to the list that deleting triggers. `BlocksView`'s page shell and draft lifecycle
are shared with the templates dashboard's own page — see [Templates](templates.md#templates) for
`LibraryPageFrame` and `useDraftPage`.

Definition fields: name, icon, elements, display rules (`readHideEmpty`, `readOnly`, plus
`showTitle`, which becomes the instance attribute on insert) and a `revision` that rises
whenever something a copy inherits changes — an element's `defaultValue`/`calcMode`/
`brushColor`/`brushSize` does *not* count (`elementForCopy` strips them before `sameShape`
compares), since a prefill only affects copies not yet created; an existing copy has nothing to
update to. `showTitle` does not count either (`sameShape` compares `blockDisplay(display)`, which
leaves it out): updating a copy keeps the copy's own title setting, so a revision for it would mark
every copy outdated with nothing to update. Inserting one (`createFromPreset('def:<id>', definitions, text)`) writes a
`core.fields` block that carries everything itself — elements (without their `defaultValue`,
already turned into the copy's own values/slots) and display rules, name and icon in
`data-block-config` — plus `data-block-origin` and `data-block-rev`
(`lib/blocks/definitions.ts`). `instantiateDefinition`/`updateInstanceToDefinition` now take a
`text: FallbackText` because writing a prefill means calling `serializeFields`, which needs it to
render the readable fallback; `defaultsOf(elements, blockId)` is the one place that turns an
element's `defaultValue` into a value or slot for a *specific* block id — a `sigilCharge`
default's `targets` (bare element ids) become `<blockId>:<elementId>` here, and a checklist
default gets fresh item ids per copy so two copies never share one. On update, only elements the
copy never held in any form — not even as an archived element or an orphaned value/slot — pick up
their default; anything the copy already has keeps what's there. It always renders from its own
copy, so editing or deleting the definition changes no entry, and a copy whose definition is
missing (trash, another vault) works unchanged. Element ids are shared by the definition and all
its copies, so values survive renames and updates and a later list filter can find them in every
copy (`entrySummary.ts` already collects them as `"<definition>:<element>"`). A copy with a lower
`rev` is outdated: `BlockFrame` shows a "Newer version" pill, and the block's menu runs
`updateInstanceToDefinition` through the stack like any edit (so Cancel reverts it) — unless
`isSigilFrozen` says the copy holds a loaded sigil, in which case it's left alone entirely (see
above). The merge keeps values by id, adds new elements with their prefill (else empty), archives
elements the definition no longer shows (`ElementDef.archived` — invisible everywhere, value kept,
back when the element returns), takes labels, options, display rules, name and icon from the
definition, and leaves the instance's own attributes (title, eye, read-mode title) alone. "Update
all" and "also remove from entries" live in `store/blockCopies.ts`: they rewrite content through
`useEntryStore`'s `updateEntry` and skip the entry open in edit mode, whose editor would write its old
state back, and — per source, via `hasFrozenCopy` — any entry holding a frozen copy, counted
separately as `CopyRunResult.skippedLocked` and reported in the builder's notice alongside
`skippedEditing`. An entry open in read mode picks a real change up itself — `BlockStack` resets
when its `initialContent` prop changes to something other than its own serialisation while not
editing, and reports the new content to the view's mirror, so a later Done can't restore the old
one.

**Prefills across backup and `.emerald`.** A definition's `elements` JSON is the only place a
prefill's image filename or link/altar target lives before any copy exists, so it needs its own
remap wherever a copy's *content* would normally be remapped: `definitionImageRefs` feeds the
image list `exportDatabase`/`exportAsEmerald` embed and `collectUsedImageFilenames` protects (see
[`database.md`](../database.md#block_definitions)); `remapDefinitionDefaults` (with an
`image`/`link` callback) rewrites a definition row's defaults during backup merge/replace and
`.emerald` import — a link default that resolves to nothing is dropped from the element instead
of being kept dangling, since a fresh copy would otherwise start with a chip into the void.
