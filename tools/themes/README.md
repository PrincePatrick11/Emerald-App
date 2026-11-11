# Test Theme

`test-garish.css` is a third theme for development only. The app never imports it. Under it, anything still brown, grey, jade, red or amber is bypassing the theme tokens, which is what a custom theme would run into. See [Colour](../../Documentation/design.md#colour).

Start the app through the MCP server, then activate the theme with `eval`:

```js
(async () => {
  const style = document.createElement('style');
  style.textContent = await (await fetch('/tools/themes/test-garish.css')).text();
  document.head.appendChild(style);
  document.documentElement.dataset.theme = 'test-garish';
})()
```

Evaluating `scan-bypass.js` returns the visible colours outside the theme's hues on the current page, grouped by class. Emoji, images and canvases (the canvas editor, sigil drawings) are skipped. The count covers one screen at a time, so it has to be run per view.
