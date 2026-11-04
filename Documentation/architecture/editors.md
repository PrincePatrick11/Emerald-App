# Editors

Editors that more than one place embeds live in `src/components/editors/`, one folder each, with an `index.ts` as the public entry. A place that embeds one imports from that index, not from the files inside.

## Text Editor

`src/components/editors/text/` is the rich-text editor: TipTap (ProseMirror), saving HTML. Entries use it for their text blocks and for the text elements of user-built blocks; `TasksView` uses its `LinkPickerModal`.

### Parts

- **`TextEditor`** — one writing surface. *Props:* `initialContent` (initial value only; remount via `key` to load other content), `onChange(html)`, `editable`, `placeholder`, `features`, `hostKey`. It also holds what belongs to exactly this editor: the extensions, the chip lookups, the popup for external links, pasting images.
- **`useTextEditorHost`** — what may exist only once for a set of editors shown together: the one toolbar, bound to the focused editor; the find bar; the word count while editing (`WordCount`: words and characters of all editors, a link chip counted with its label, recounted at most once per frame); `LinkPickerModal`; chip-click navigation in read mode; OS file drops; pointer drops from the entry list; `DragGhost`. It returns `context` for `TextEditorHostContext`, the `toolbar`, `wordCount` and `overlays` to render, `dropActive` for highlighting, and `orderedEditors`/`targetEditor`/`focusOnMount` for requests the host handles itself.
- **`useTextEditorRegistry`** — the host's bookkeeping: which editors exist under which key, in what order (`getOrder`), which was focused last. The focused editor, else the last one, gets the toolbar and receives requests from outside.
- **`SelectionMenus`** — the small menus at a selection, rendered by each `TextEditor` through TipTap's `BubbleMenu` while it is editable (each menu is a plugin that follows every transaction): over selected text the marks, a text colour and a web link (both chosen in the menu itself), over a selected image alignment, three widths and removing; at the top edge of a table the cursor is in its rows, columns, header row and removing. The image and table menus are anchored to the picture and the table, not to the node's full-width element; a cell selection shows only the table menu. Like the toolbar they show what the schema has, and they subscribe to the editor state with `useEditorState`, since the editor does not re-render per transaction.
- **`slashCommands.ts`** — the `/` menu (`CommandList`): typed at the start of a line or after a space, it lists what the editor's schema has (text, headings, lists, checklist, quote, rule, collapsible section, table, image, entry link) and filters by the translated label and English keywords. The entry link types `[[`, which opens the link suggestion in place; the image opens a file picker for several files.
- **`suggestionPopup.ts`** — the popup both suggestions (`[[`, `/`) render in. The suggestion plugin mounts and places it at the caret (`props.mount`, Floating UI) and closes it on Escape and on a click outside.
- **`EditorToolbar`** — the formatting bar: a rounded surface (`.editor-toolbar`, panel colours with an edge) in the sticky strip, which has the sheet's colour. Its buttons (`ToolbarBtn`, shared with the selection menus and the find bar) are 28px, neutral on hover and jade when active (`--editor-toolbar-active-*`).
- **`features.ts`** — `TextFeatures`, the switches an embedding place sets, and `FULL_TEXT_FEATURES`.
- **`editorCommands.ts`** — commands on an editor: appending, finding, revealing and removing a link chip; inserting an image or a chip.

### Embedding

A single `TextEditor` works on its own, without a toolbar (Markdown shortcuts and paste still apply). For a toolbar, or several editors in one document, the place calls `useTextEditorHost`, wraps its content in `TextEditorHostContext.Provider value={host.context}`, renders `host.toolbar` and `host.overlays`, and gives each `TextEditor` a `hostKey` that `getOrder` lists in document order. `BlockStack` does exactly that: the keys are block IDs, and `<block ID>:<element ID>` for a user-built block's text element.

Requests that depend on the place's content stay with the place. `BlockStack` handles the sidebar's link requests itself, because they also reach link and altar fields, and uses `orderedEditors`/`targetEditor` to find the editor.

### Features

`TextFeatures` switches parts of the editor on or off: `structure` (headings, quote, horizontal rule), `folding` (by headings, needs `structure`), `lists`, `tasks`, `highlight`, `colors`, `align`, `links` (external), `entryLinks` (chips, `[[`, link picker, drops from the entry list) `images` (paste, file drops, image button), `tables`, `details` (collapsible sections) and `commands` (the `/` menu). The default is everything, which is what entries use.

A switched-off feature is missing from the schema, not only from the toolbar. Content that uses it is dropped when the editor loads it, and the next change saves the content without it, so features are switched off only where such content cannot exist yet. The toolbar asks the editor's schema (`editorHas`), not the feature set, so it always matches what the editor can do. The host also sends file drops only to an editor with images and pointer drops only to editors with link chips.

`features` is read once, when the editor is created, like the formatting settings under Settings → Entries ([Vault Settings](storage.md#vault-settings)).

### Images and drops

Every drag into the host's editors goes through one geometry (`dropSpot.ts`): `editorAtPoint` finds the editor under the pointer, or the nearest one when the pointer is between them; `lineSpot` gives the position between two top-level blocks, `caretSpot` the one between two characters. `DropIndicator` draws a line or a caret there while the drag runs. It listens to its own channel, so a pointer move does not re-render the host.

- **Files from the explorer** (`useEditorFileDrop`) land between the blocks under the pointer, several in the order of the files. Tauri reports the position in physical pixels; it is divided by `devicePixelRatio`. Dropped beside all editors, they go to the cursor of the focused editor.
- **Entries from the list** (`useEditorPointerDrops`) become a link chip at the caret.
- **Images in the text** are moved by dragging them. The WebView has no HTML5 drag, so the image node is not `draggable` for ProseMirror; its node view starts a pointer drag after a few pixels (`imageDrag.ts`), and the host's listener moves it at `pointerup`. Within one editor that is one transaction and one undo step; into another editor of the host it is inserted there and then removed at the source. The moved image ends up selected.
- **Paste and the image button** take several images at once, in their order.

### Find and replace

⌘F / Ctrl+F opens `FindBar` in the host that is on screen (its container has a layout box), in reading and in editing; a selected text is searched for first. It sits with the toolbar in the one sticky strip. `SearchExtension` marks the hits in every editor as decorations and finds them again after every change; the bar hands each editor the query and, for the one holding it, the current hit (`setSearch`, kept out of the undo history). A hit runs across marks but not across paragraphs, and an inline node such as a link chip matches nothing. Enter goes to the next hit, Shift+Enter to the previous, Escape closes and takes the marks away. While editing the bar also replaces: the current hit, or all of them, from the back and in one undo step per editor.

### Folding by headings

`HeadingFoldExtension` gives every top-level heading with something under it a chevron in the left margin, shown on hover and while folded: in the page margin while reading, in the frame's inner padding while editing, at a fixed size so it does not grow into the text of an H1. Folding hides everything after the heading up to the next heading of the same or a higher level, so an H1 takes its H2s and H3s along; a folded heading ends in `…`. It is decorations only and is not stored, so it works while reading, survives the switch to editing and every heading opens unfolded. Folded positions are mapped through every change. A selection that lands in a folded section unfolds it, and so does a find-bar hit there (`revealFolded`). Folding works within one text block, not across the blocks of an entry.

### Collapsible sections

`@tiptap/extension-details`: a heading line (`summary`) with a toggle beside it and the content under it, inserted from the `/` menu. The open state is not stored (`persist: false`): opening a section while reading would otherwise change the content. Every section therefore opens closed. The toggle's label is translated; an empty heading line shows its own placeholder, for which `Placeholder` runs with `includeChildren` (the stylesheet still shows the editor's own placeholder only in an empty editor). The PDF export opens every section, or its content would be missing on paper; the Markdown export writes the heading line in bold and the content after it.

### Text colours

`TextColorMark` stores a colour by name only: `<span data-color="blue">`, one of six (`TEXT_COLORS`), anything else is not parsed. The shade comes from the theme (`--editor-color-<name>`, light shades in Noctis, dark ones in Parchment, see [themes.md](../themes.md)), so text coloured in one theme stays readable in the other. The PDF export prints fixed dark shades; Markdown has no colour and keeps the text. Import and PDF export let `data-color` through.

### Tables

`TableKit` from `@tiptap/extension-table`, with resizable columns. A table looks like the app's other surfaces: a rounded frame with an edge, quiet inner lines and the header row on the panel colour; it uses `border-collapse: separate`, since collapsed borders cannot round their outer corners. A new table has three rows and three columns, the first a header row (`NEW_TABLE`, shared by toolbar and `/` menu). Column widths are stored as `colwidth` on the cells and again as `<col style>` widths, which the import and the PDF export's sanitiser let through. The Markdown export (`createMarkdownConverter` in `lib/export.ts`) writes a GFM pipe table: the first row is the header, as GFM requires one, a cell's paragraphs are joined with `<br>` and pipes escaped. Markdown import reads GFM tables through `marked`.

### Image sizes

An image is decoded asynchronously and loaded lazily (`decoding`, `loading` on the `img`): it is stored at the size it came in unless the vault has [image limits](storage.md#vault-settings), and a phone photo decoded at full size on the main thread would stall typing and scrolling.

Resizing drags a handle on the side that moves: right for a left-aligned image, left for a right-aligned one, both for a centred one, where the width changes twice as fast as the pointer. The width is stored in pixels, so an image keeps its size when the window changes; `max-width: 100%` only shrinks it where the text column gets narrower. While dragging it snaps to 25, 33, 50, 66 and 75 % of the editor's current width within two points, and shows in the image's corner. Dragged to the full width, and the menu's 100 %, store `100%`, which is meant to follow the text; the menu's 25 and 50 % store the pixels of that moment. A percentage below 100 from before is converted to the pixels of the moment when the editor starts editing (`pinPercentImageWidths`), outside the undo history; it is a change of the content and is saved with the edit.
