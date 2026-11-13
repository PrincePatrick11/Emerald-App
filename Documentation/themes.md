# Custom Themes

A custom theme is a small JSON file. It sets colours and nothing else: spacing, layout, radius and fonts stay as they are, so any theme still works and still reads as Emerald. **Import theme** on the start page's Appearance adds it to this installation (`device.json`) and selects it. A backup from before themes moved to the installation still brings its custom themes along: importing it adds them to the list.

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

Colours are `#rgb` or `#rrggbb`. Anything else makes the file invalid, as does an unknown version. Every other token is derived from these in [`src/themes/customTheme.ts`](../src/themes/customTheme.ts), and `npm run check:colors` fails if a token of the theme files is missing there. The editor's six text colours (`--editor-color-*`) are not derived but taken from the built-in theme of the same base, so coloured text keeps its shade and stays readable.

## What the App Checks

The Emerald mark takes the theme's `accent`, its lines a light tint of it; its shape stays, and so does the loading screen. On macOS the Dock icon follows while the app runs; before launch and after quitting it is the bundle's, and Windows and Linux keep theirs. A file can only set validated hex values, never CSS, so a shared theme cannot load anything from outside or change anything but colour. Stored themes pass the same check when `device.json` is read, since they can come from a backup.

Pairs below the [contrast rule](design.md#colour) produce a warning after import; the theme is still added. Only `text` below 2:1 against `sheet` or `panel` is refused, because the controls to remove the theme would be unreadable too. An installation holds at most 20 themes. Themes a backup still carries in its settings are appended when it is imported, after the installation's own, and what no longer fits is left out; the selected theme stays as it is. A vault's `settings.json` from before themes moved to the installation lends its themes the same way, once per vault. Removing the active theme falls back to Emerald Noctis.

## How It Applies

`applyTheme` sets `data-theme="custom"` and writes the tokens with `style.setProperty` on `<html>`. A `<style>` element would collide with the release build's CSP nonce. The per-theme rules in `index.css` do not match `custom`, so a custom theme sees the token-based base rules. Before the bundle runs, the loading screen shows Noctis colours; `index.html` does not know custom themes.

Example file: [`tools/themes/example-theme.json`](../tools/themes/example-theme.json). To check that the app still follows the tokens, see the [test theme](../tools/themes/README.md).
