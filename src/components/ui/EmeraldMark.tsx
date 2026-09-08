import { useId } from 'react';

/**
 * Emerald's mark: the smaragd of the loading screen, standing still.
 *
 * Same cut, same coordinates — the octagonal outline, the eight crown facets,
 * the table and the step inside it — stripped of everything that only makes
 * sense while something is moving: the halo, the sparks, the travelling band
 * of light. Gone too are the separate facet-edge lines, which the loading
 * screen draws because animated fills meet in a seam that both sides
 * antialias independently; nothing moves here, and at this size they would
 * only add mud. The two strokes are relatively heavier than there for the
 * same reason — at 20px a hairline is not a line.
 *
 * The shape exists four times over, and that is deliberate rather than
 * sloppy: here, as raw SVG in `index.html` (which has to render before the
 * bundle exists, so it cannot import a component), and in the two
 * `src-tauri/icons/source/*.svg` (which `tauri icon` rasterises at build time,
 * outside the app entirely — no CSS variables, no components, no bundle).
 * None of the other three can import this one. Change the cut and all four
 * want changing — which is why they all carry the *same* numbers, in the
 * loading screen's frame (74..182 x 54..190). The square viewBox here is an
 * offset window onto that frame, not a renumbering: the point strings below
 * can be diffed against the other three character for character.
 *
 * Colours are class names, resolved in `src/index.css`, and follow the theme.
 * Facet opacities carry the cut: they say how steeply each face stands to the
 * light, so they are not decoration to be evened out.
 *
 * Damped against the loading screen, though, and by how much is a per-theme
 * decision that lives with the other colours in `src/index.css`. At the 20px
 * of the title bar none of the detail survives, and on the dark theme all that
 * arrives undamped is the sum of it: a bright green slab beside menu labels
 * half its weight. The damping sits on the crown as a group rather than on
 * each facet, so the eight values stay the loading screen's and stay readable
 * as the same cut — and since the facets tile the crown without overlapping,
 * a group opacity is arithmetically the same thing as scaling all eight.
 */
export default function EmeraldMark({ size, className }: { size: number; className?: string }) {
  // Gradient references are document-wide. Two marks on screen — title bar and
  // settings dialog — would otherwise both resolve to whichever `<defs>`
  // mounted first, and unmounting that one would blank the other.
  const tableId = `emerald-mark-table-${useId()}`;

  return (
    <svg
      width={size}
      height={size}
      // 140 units square around the stone's 108 x 136, so `size` is the box and
      // the stone sits centred in it with a unit to spare for the stroke.
      viewBox="58 52 140 140"
      className={`emerald-mark${className ? ` ${className}` : ''}`}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        {/* Every colour here is a class, resolved in `src/index.css` — see the
            comment there, and the same one above `.splash-outline` in
            `public/splash.css`. It is not a style preference.

            The ramp itself ends at `--accent-strong`, not at the loading
            screen's own `--splash-gem-deep`. That one exists because a ramp
            this flat cannot carry a table 100px tall; here the table is 15px
            and at half opacity, so the ramp is barely doing any work and one
            fewer hand-picked colour is worth more than the depth. */}
        <linearGradient id={tableId} x1="0" y1="0" x2="0" y2="1">
          <stop className="emerald-mark-table-top" offset="0%" />
          <stop className="emerald-mark-table-bottom" offset="100%" />
        </linearGradient>
      </defs>

      {/* Crown, clockwise from the top left corner. */}
      <g className="emerald-mark-crown">
        <polygon points="74,77 97,54 105,71 91,89" opacity="0.30" />
        <polygon points="97,54 159,54 151,71 105,71" opacity="0.58" />
        <polygon points="159,54 182,77 165,89 151,71" opacity="0.36" />
        <polygon points="182,77 182,167 165,155 165,89" opacity="0.62" />
        <polygon points="182,167 159,190 151,173 165,155" opacity="0.32" />
        <polygon points="159,190 97,190 105,173 151,173" opacity="0.50" />
        <polygon points="97,190 74,167 91,155 105,173" opacity="0.40" />
        <polygon points="74,167 74,77 91,89 91,155" opacity="0.56" />
      </g>

      {/* The table, and the step cut inside it. */}
      <polygon
        className="emerald-mark-table"
        points="91,89 105,71 151,71 165,89 165,155 151,173 105,173 91,155"
        fill={`url(#${tableId})`}
      />
      <polygon
        className="emerald-mark-step"
        points="102,90 111,78 145,78 154,90 154,154 145,166 111,166 102,154"
        fill="none"
        strokeWidth="2"
      />

      <polygon
        className="emerald-mark-outline"
        points="74,77 97,54 159,54 182,77 182,167 159,190 97,190 74,167"
        fill="none"
        strokeWidth="3"
        strokeLinejoin="round"
        opacity="0.95"
      />
    </svg>
  );
}
