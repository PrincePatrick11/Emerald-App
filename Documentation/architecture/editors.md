# Editors

Editors that more than one place embeds live in `src/components/editors/`, one folder each, with an `index.ts` as the public entry. A place that embeds one imports from that index, not from the files inside.

## Text Editor

`src/components/editors/text/` is the rich-text editor: TipTap (ProseMirror), saving HTML. Entries use it for their text blocks and for the text elements of user-built blocks; `TasksView` uses its `LinkPickerModal`.

### Parts

- **`TextEditor`** — one writing surface. *Props:* `initialContent` (initial value only; remount via `key` to load other content), `onChange(html)`, `editable`, `placeholder`, `features`, `hostKey`. It also holds what belongs to exactly this editor: the extensions, the chip lookups, the popup for external links, pasting images.
- **`useTextEditorHost`** — what may exist only once for a set of editors shown together: the one toolbar, bound to the focused editor; `LinkPickerModal`; chip-click navigation in read mode; OS file drops; pointer drops from the entry list; `DragGhost`. It returns `context` for `TextEditorHostContext`, the `toolbar` and `overlays` to render, `dropActive` for highlighting, and `orderedEditors`/`targetEditor`/`focusOnMount` for requests the host handles itself.
- **`useTextEditorRegistry`** — the host's bookkeeping: which editors exist under which key, in what order (`getOrder`), which was focused last. The focused editor, else the last one, gets the toolbar and receives requests from outside.
- **`features.ts`** — `TextFeatures`, the switches an embedding place sets, and `FULL_TEXT_FEATURES`.
- **`editorCommands.ts`** — commands on an editor: appending, finding, revealing and removing a link chip; inserting an image or a chip.

### Embedding

A single `TextEditor` works on its own, without a toolbar (Markdown shortcuts and paste still apply). For a toolbar, or several editors in one document, the place calls `useTextEditorHost`, wraps its content in `TextEditorHostContext.Provider value={host.context}`, renders `host.toolbar` and `host.overlays`, and gives each `TextEditor` a `hostKey` that `getOrder` lists in document order. `BlockStack` does exactly that: the keys are block IDs, and `<block ID>:<element ID>` for a user-built block's text element.

Requests that depend on the place's content stay with the place. `BlockStack` handles the sidebar's link requests itself, because they also reach link and altar fields, and uses `orderedEditors`/`targetEditor` to find the editor.

### Features

`TextFeatures` switches parts of the editor on or off: `structure` (headings, quote, horizontal rule), `lists`, `tasks`, `highlight`, `align`, `links` (external), `entryLinks` (chips, `[[`, link picker, drops from the entry list) and `images` (paste, file drops, image button). The default is everything, which is what entries use.

A switched-off feature is missing from the schema, not only from the toolbar. Content that uses it is dropped when the editor loads it, and the next change saves the content without it, so features are switched off only where such content cannot exist yet. The toolbar asks the editor's schema (`editorHas`), not the feature set, so it always matches what the editor can do. The host also sends file drops only to an editor with images and pointer drops only to editors with link chips.

`features` is read once, when the editor is created, like the formatting settings under Settings → Entries ([Vault Settings](storage.md#vault-settings)).
