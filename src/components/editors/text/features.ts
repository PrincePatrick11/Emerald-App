/**
 * What a text editor offers. Each place that embeds the editor picks its set;
 * the toolbar shows only what the editor's schema actually has.
 *
 * A switched-off feature is missing from the schema, not only from the toolbar:
 * content that uses it is dropped when the editor loads it, and the next change
 * writes the content back without it. Switch features off only where such
 * content cannot exist yet.
 */
export interface TextFeatures {
  /** Headings (levels 1–3), block quote and horizontal rule. */
  structure: boolean;
  /** Bulleted and numbered lists. */
  lists: boolean;
  /** Checklists. */
  tasks: boolean;
  highlight: boolean;
  /** Left, centred and right alignment of paragraphs, headings and images. */
  align: boolean;
  /** External links (`http://`, `https://`). */
  links: boolean;
  /** Link chips to other entries: `[[` suggestions, link picker, drops from the entry list. */
  entryLinks: boolean;
  /** Images: paste, file drops, the toolbar's image button. */
  images: boolean;
  /** The `/` menu, offering what else is switched on. */
  commands: boolean;
}

/** Everything; what an entry's text blocks use. */
export const FULL_TEXT_FEATURES: TextFeatures = {
  structure: true,
  lists: true,
  tasks: true,
  highlight: true,
  align: true,
  links: true,
  entryLinks: true,
  images: true,
  commands: true,
};
