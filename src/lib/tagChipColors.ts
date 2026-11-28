/**
 * A tag chip's colours from the tag's own colour — the one rule for the
 * app's chips (`chipStyle` in `CardTags.tsx`) and the export's
 * (`tagStyle` in `exportStyle.ts`): the colour as text, a tint behind, a
 * fainter edge (a stronger, dashed one for a tag a block gives). `null` for
 * anything but `#rrggbb`, which then gets the neutral chip.
 */
export function tagChipColors(color: string | null | undefined, dashed = false): { background: string; text: string; border: string } | null {
  if (!color || !/^#[0-9a-f]{6}$/i.test(color)) return null;
  return { background: `${color}20`, text: color, border: `${color}${dashed ? '60' : '40'}` };
}
