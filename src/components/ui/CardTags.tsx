import { useLayoutEffect, useRef, useState } from 'react';
import type { Tag } from '../../types';
import { tagChipColors } from '../../lib/tagChipColors';

const CHIP_CLASS = 'h-6 inline-flex items-center px-2.5 rounded-full text-xs font-medium whitespace-nowrap border';

/** A tag chip's colours, from the tag's own colour; `dashed` for a tag a block gives (`TagInput`). Goes with a `border` class. */
export function chipStyle(color: string, dashed = false) {
  const colors = tagChipColors(color, dashed);
  return {
    ...(colors && { backgroundColor: colors.background, color: colors.text, borderColor: colors.border }),
    ...(dashed && { borderStyle: 'dashed' }),
  };
}

/**
 * The tags of a card in one line, so cards of a row stay equally tall: only as many
 * as fit whole, the rest as "+N" (its tooltip names them). Measured on an invisible
 * copy of all chips, re-measured when the card or the copy changes size (width of
 * the card, a font switch, a rename). If not even the first fits beside "+N", it
 * stays, shortened.
 */
export default function CardTags({ tags }: { tags: Tag[] }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(tags.length);
  const tagsKey = tags.map((tag) => `${tag.id}:${tag.name}`).join('|');

  useLayoutEffect(() => {
    const box = boxRef.current;
    const measure = measureRef.current;
    if (!box || !measure) return;
    const compute = () => {
      const avail = box.clientWidth;
      const gap = parseFloat(getComputedStyle(measure).columnGap) || 0;
      // The last child is the widest "+N" there can be.
      const kids = Array.from(measure.children) as HTMLElement[];
      const plusW = kids[kids.length - 1].offsetWidth;
      const widths = kids.slice(0, -1).map((el) => el.offsetWidth);
      const total = widths.reduce((sum, w) => sum + w, 0) + gap * (widths.length - 1);
      if (total <= avail) { setFit(widths.length); return; }
      let used = plusW;
      let count = 0;
      for (const w of widths) {
        if (used + gap + w > avail) break;
        used += gap + w;
        count++;
      }
      setFit(count);
    };
    compute();
    const observer = new ResizeObserver(compute);
    observer.observe(box);
    observer.observe(measure);
    return () => observer.disconnect();
  }, [tagsKey]);

  if (tags.length === 0) return null;
  const shrinkFirst = fit === 0;
  const shownCount = Math.max(1, Math.min(fit, tags.length));
  const shown = tags.slice(0, shownCount);
  const rest = tags.slice(shownCount);

  return (
    <div ref={boxRef} className="relative mt-2 h-6 overflow-hidden">
      <div className="flex gap-1.5 h-6">
        {shown.map((tag) => (
          <span key={tag.id} title={tag.name}
            className={`${CHIP_CLASS} ${shrinkFirst ? 'min-w-0 shrink' : 'shrink-0'}`}
            style={chipStyle(tag.color)}>
            <span className="truncate">{tag.name}</span>
          </span>
        ))}
        {rest.length > 0 && (
          <span title={rest.map((tag) => tag.name).join(', ')} className={`${CHIP_CLASS} shrink-0 text-muted border-edge-default`}>
            +{rest.length}
          </span>
        )}
      </div>
      <div ref={measureRef} aria-hidden className="absolute left-0 top-0 flex gap-1.5 invisible pointer-events-none">
        {tags.map((tag) => <span key={tag.id} className={CHIP_CLASS}>{tag.name}</span>)}
        <span className={CHIP_CLASS}>+{tags.length}</span>
      </div>
    </div>
  );
}
