# Custom Themes

A custom theme is a small JSON file. It sets colours and nothing else: spacing, layout, radius and fonts stay as they are, so any theme still works and still reads as Emerald. Settings → General → Import theme adds it to the open vault, and it travels with that vault's settings in a backup.

## Format

```json
{
  "emeraldTheme": 1,
  "name": "Midnight",
  "base": "dark",
  "colors": {
    "frame": "#0d1017",
    "sheet": "#141923",
    "panel": "#1c2331",
    "text": "#eef1f7",
    "textMuted": "#a3adc2",
    "border": "#3a4458",
    "accent": "#7c9cff",
    "onAccent": "#0d1017"
  }
}
```

`emeraldTheme` is the format version, currently `1`. `name` has at most 40 characters. `base` is `dark` or `light` and sets native controls and scrollbars.

| Colour | Used for | Required |
| --- | --- | --- |
| `frame` | title bar, rail, left entry list | yes |
| `sheet` | main content and right sidebar | yes |
| `panel` | cards, menus, dialogs | yes |
| `text` | main text | yes |
| `textMuted` | dates, counts, hints | yes |
| `border` | edges and dividers | yes |
| `accent` | active state and main action | yes |
| `onAccent` | text on an `accent` surface | yes |
| `danger` | destructive actions | no |
| `warning` | warnings and the edit action | no |
| `success` | low task priority | no |

Colours are `#rgb` or `#rrggbb`. Anything else makes the file invalid, as does an unknown version. Every other token is derived from these in [`src/themes/customTheme.ts`](../src/themes/customTheme.ts), and `npm run check:colors` fails if a token of the theme files is missing there.

## What the App Checks

The Emerald mark takes the theme's `accent`, its lines a light tint of it; its shape stays, and so do the loading screen and the app icon. A file can only set validated hex values, never CSS, so a shared theme cannot load anything from outside or change anything but colour. Stored themes pass the same check when settings are read, since they can come from a backup.

Pairs below the [contrast rule](design.md#colour) produce a warning after import; the theme is still added. A vault holds at most 20 themes. Removing the active theme falls back to Emerald Noctis.

## How It Applies

`applyTheme` sets `data-theme="custom"` and writes the tokens with `style.setProperty` on `<html>`. A `<style>` element would collide with the release build's CSP nonce. The per-theme rules in `index.css` do not match `custom`, so a custom theme sees the token-based base rules. Before the bundle runs, the loading screen shows Noctis colours; `index.html` does not know custom themes.

Example file: [`tools/themes/example-theme.json`](../tools/themes/example-theme.json). To check that the app still follows the tokens, see the [test theme](../tools/themes/README.md).
