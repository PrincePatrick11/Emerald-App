# Editors

Editors that more than one place embeds live in `src/components/editors/`, one folder each, with an `index.ts` as the public entry. A place that embeds one imports from that index, not from the files inside.

## Text Editor

`src/components/editors/text/` is the rich-text editor: TipTap (ProseMirror), saving HTML. Entries use it for their text blocks and for the text elements of user-built blocks; `TasksView` uses its `LinkPickerModal`.

### Parts

- **`TextEditor`** — one writing surface. *Props:* `initialContent` (initial value only; remount via `key` to load other content), `onChange(html)`, `editable`, `placeholder`, `features`, `hostKey`. It also holds what belongs to exactly this editor: the extensions, the chip lookups, the popup for external links, pasting images.
- **`useTextEditorHost`** — what may exist only once for a set of editors shown together: the one toolbar, bound to the focused editor; `LinkPickerModal`; chip-click navigation in read mode; OS file drops; pointer drops from the entry list; `DragGhost`. It returns `context` for `TextEditorHostContext`, the `toolbar` and `overlays` to render, `dropActive` for highlighting, and `orderedEditors`/`targetEditor`/`focusOnMount` for requests the host handles itself.
- **`useTextEditorRegistry`** — the host's bookkeeping: which editors exist under which key, in what order (`getOrder`), which was focused last. The focused editor, else the last one, gets the toolbar and receives requests from outside.
- **`SelectionMenus`** — the small menus at a selection, rendered by each `TextEditor` through TipTap's `BubbleMenu`: over selected text the marks and a web link (typed into the menu itself), over a selected image alignment, three widths and removing; the image menu is anchored to the picture, not to the node's full-width element. Like the toolbar they show what the schema has, and they subscribe to the editor state with `useEditorState`, since the editor does not re-render per transaction.
- **`slashCommands.ts`** — the `/` menu (`CommandList`): typed at the start of a line or after a space, it lists what the editor's schema has (text, headings, lists, checklist, quote, rule, image, entry link) and filters by the translated label and English keywords. The entry link types `[[`, which opens the link suggestion in place; the image opens a file picker for several files.
- **`suggestionPopup.ts`** — the popup both suggestions (`[[`, `/`) render in. The suggestion plugin mounts and places it at the caret (`props.mount`, Floating UI) and closes it on Escape and on a click outside.
- **`features.ts`** — `TextFeatures`, the switches an embedding place sets, and `FULL_TEXT_FEATURES`.
- **`editorCommands.ts`** — commands on an editor: appending, finding, revealing and removing a link chip; inserting an image or a chip.

### Embedding

A single `TextEditor` works on its own, without a toolbar (Markdown shortcuts and paste still apply). For a toolbar, or several editors in one document, the place calls `useTextEditorHost`, wraps its content in `TextEditorHostContext.Provider value={host.context}`, renders `host.toolbar` and `host.overlays`, and gives each `TextEditor` a `hostKey` that `getOrder` lists in document order. `BlockStack` does exactly that: the keys are block IDs, and `<block ID>:<element ID>` for a user-built block's text element.

Requests that depend on the place's content stay with the place. `BlockStack` handles the sidebar's link requests itself, because they also reach link and altar fields, and uses `orderedEditors`/`targetEditor` to find the editor.

### Features

`TextFeatures` switches parts of the editor on or off: `structure` (headings, quote, horizontal rule), `lists`, `tasks`, `highlight`, `align`, `links` (external), `entryLinks` (chips, `[[`, link picker, drops from the entry list) `images` (paste, file drops, image button) and `commands` (the `/` menu). The default is everything, which is what entries use.

A switched-off feature is missing from the schema, not only from the toolbar. Content that uses it is dropped when the editor loads it, and the next change saves the content without it, so features are switched off only where such content cannot exist yet. The toolbar asks the editor's schema (`editorHas`), not the feature set, so it always matches what the editor can do. The host also sends file drops only to an editor with images and pointer drops only to editors with link chips.

`features` is read once, when the editor is created, like the formatting settings under Settings → Entries ([Vault Settings](storage.md#vault-settings)).

### Images and drops

Every drag into the host's editors goes through one geometry (`dropSpot.ts`): `editorAtPoint` finds the editor under the pointer, or the nearest one when the pointer is between them; `lineSpot` gives the position between two top-level blocks, `caretSpot` the one between two characters. `DropIndicator` draws a line or a caret there while the drag runs. It listens to its own channel, so a pointer move does not re-render the host.

- **Files from the explorer** (`useEditorFileDrop`) land between the blocks under the pointer, several in the order of the files. Tauri reports the position in physical pixels; it is divided by `devicePixelRatio`. Dropped beside all editors, they go to the cursor of the focused editor.
- **Entries from the list** (`useEditorPointerDrops`) become a link chip at the caret.
- **Images in the text** are moved by dragging them. The WebView has no HTML5 drag, so the image node is not `draggable` for ProseMirror; its node view starts a pointer drag after a few pixels (`imageDrag.ts`), and the host's listener moves it at `pointerup`. Within one editor that is one transaction and one undo step; into another editor of the host it is inserted there and then removed at the source. The moved image ends up selected.
- **Paste and the image button** take several images at once, in their order.

Resizing drags a handle on the side that moves: right for a left-aligned image, left for a right-aligned one, both for a centred one, where the width changes twice as fast as the pointer. The width is stored in percent of the editor's width, snaps to 25, 33, 50, 66, 75 and 100 % within two points, and shows in the image's corner while dragging.
