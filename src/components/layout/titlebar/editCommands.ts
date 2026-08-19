/**
 * Clipboard commands for the HTML Edit menu on Windows and Linux.
 *
 * On macOS these come from Tauri's `PredefinedMenuItem`s, which map straight
 * onto the OS clipboard. There is no JS equivalent, so the webview's own
 * editing commands stand in. Note that the keyboard shortcuts (Ctrl+X/C/V/A)
 * always work natively regardless of this menu — these entries exist for
 * discoverability.
 */

export function cutSelection(): void {
  document.execCommand('cut');
}

export function copySelection(): void {
  document.execCommand('copy');
}

export function selectAll(): void {
  document.execCommand('selectAll');
}

/**
 * `document.execCommand('paste')` is blocked in WebView2 and WKWebView for
 * security reasons, so the clipboard is read explicitly and replayed as a
 * synthetic paste event. Going through a real `ClipboardEvent` rather than
 * `insertText` matters: it lets ProseMirror (TipTap) apply its own paste
 * handling and keep `text/html` formatting, which a plain-text insert loses.
 */
export async function pasteFromClipboard(): Promise<void> {
  const target = (document.activeElement as HTMLElement | null) ?? document.body;

  try {
    const items = await navigator.clipboard.read();
    const data = new DataTransfer();
    for (const item of items) {
      for (const type of item.types) {
        // Images have to travel as files, not strings: RichEditor's
        // handlePaste looks for an `image/*` entry in `clipboardData.items`
        // and calls `getAsFile()` on it. Without this branch, Paste from the
        // menu would silently drop images that Ctrl+V handles fine.
        if (type.startsWith('image/')) {
          const blob = await item.getType(type);
          data.items.add(new File([blob], 'pasted-image', { type }));
          continue;
        }
        if (type !== 'text/plain' && type !== 'text/html') continue;
        data.setData(type, await (await item.getType(type)).text());
      }
    }
    if (data.types.length > 0 || data.items.length > 0) {
      const handled = !target.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
      );
      if (handled) return;
      // Nothing consumed the event (e.g. a plain <input>): fall through.
      const text = data.getData('text/plain');
      if (text) document.execCommand('insertText', false, text);
      return;
    }
  } catch {
    // clipboard.read is unavailable or the read was denied — fall back below.
  }

  try {
    const text = await navigator.clipboard.readText();
    if (text) document.execCommand('insertText', false, text);
  } catch {
    // Nothing more we can do from JS; Ctrl+V still works natively.
  }
}
