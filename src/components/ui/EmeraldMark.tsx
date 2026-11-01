/**
 * Emerald's mark: a round emerald whose cut follows the pentagram. The same shape
 * lives in `index.html` (it renders before the bundle) and in
 * `src-tauri/icons/source/*.svg` (rasterised at build time); none of them can
 * import this component, so changing the cut means changing all of them.
 *
 * At 24px and below the ten facets blur, so a simpler cut with a heavier star
 * takes over. Colours are class names in `src/index.css`: a presentation-attribute
 * `var()` silently falls back to black on engines that don't substitute it.
 */
export default function EmeraldMark({ size, className }: { size: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      className={`emerald-mark${className ? ` ${className}` : ''}`}
      aria-hidden="true"
      focusable="false"
    >
      {size <= 24 ? (
        <>
          <circle className="emerald-mark-stone" cx="60" cy="60" r="58" />
          <path className="emerald-mark-f1" d="M2 60 A58 58 0 0 1 118 60 Z" />
          <polygon
            className="emerald-mark-line"
            points="60,10 89.4,100.5 12.4,44.5 107.6,44.5 30.6,100.5"
            fill="none"
            strokeWidth="9"
            strokeLinejoin="round"
          />
        </>
      ) : (
        <>
          <circle className="emerald-mark-stone" cx="60" cy="60" r="56" />
          <path className="emerald-mark-f1" d="M60 4 L60 14 L70.33 45.79 L103.75 45.79 L113.26 42.7 A56 56 0 0 0 60 4 Z" />
          <path className="emerald-mark-f2" d="M113.26 42.7 L103.75 45.79 L76.71 65.43 L87.04 97.21 L92.92 105.3 A56 56 0 0 0 113.26 42.7 Z" />
          <path className="emerald-mark-f3" d="M92.92 105.3 L87.04 97.21 L60 77.57 L32.96 97.21 L27.08 105.3 A56 56 0 0 0 92.92 105.3 Z" />
          <path className="emerald-mark-f4" d="M27.08 105.3 L32.96 97.21 L43.29 65.43 L16.25 45.79 L6.74 42.7 A56 56 0 0 0 27.08 105.3 Z" />
          <path className="emerald-mark-f5" d="M6.74 42.7 L16.25 45.79 L49.67 45.79 L60 14 L60 4 A56 56 0 0 0 6.74 42.7 Z" />
          <polygon className="emerald-mark-t1" points="60,14 49.67,45.79 70.33,45.79" />
          <polygon className="emerald-mark-t2" points="103.75,45.79 70.33,45.79 76.71,65.43" />
          <polygon className="emerald-mark-t3" points="87.04,97.21 76.71,65.43 60,77.57" />
          <polygon className="emerald-mark-t4" points="32.96,97.21 60,77.57 43.29,65.43" />
          <polygon className="emerald-mark-t5" points="16.25,45.79 43.29,65.43 49.67,45.79" />
          <polygon className="emerald-mark-table" points="60,77.57 43.29,65.43 49.67,45.79 70.33,45.79 76.71,65.43" />
          <polygon
            className="emerald-mark-line"
            points="60,14 87.04,97.21 16.25,45.79 103.75,45.79 32.96,97.21"
            fill="none"
            strokeWidth="4.5"
            strokeLinejoin="round"
          />
          <circle className="emerald-mark-line" cx="60" cy="60" r="52.5" fill="none" strokeWidth="2.5" />
        </>
      )}
    </svg>
  );
}
