/**
 * Data types of the functional blocks.
 *
 * Import rule for everything under `lib/blocks/`: only types, `lucide-react`
 * and other pure `lib` modules — no React components, no stores, no
 * TipTap. Migrations, export and `scripts/check-blocks.mjs` use these
 * files, and those run without a browser.
 */

/** `<origin>.<name>` — built-in types are named `core.*`; the form later
 *  allows extensions (`myplugin.x`) alongside the built-in ones. */
export type BlockTypeId = `${string}.${string}`;

/** The text block: TipTap HTML as the inner HTML of its section. */
export const TEXT_BLOCK_TYPE = 'core.text' satisfies BlockTypeId;

/** Name of a section attribute — only `data-*` survives reading (see `parseBlocks`). */
export type BlockAttrName = `data-${string}`;

/**
 * The instance attributes any block can carry, regardless of type.
 * They sit on the block itself — and thus in the content: Cancel rolls them
 * back along with the text, export and backup carry them without a field of their own.
 */
export const BLOCK_ATTR = {
  /** Data format version of the type; missing = 1. */
  version: 'data-block-v',
  /** `"1"`: hidden in read mode, greyed out in edit mode. */
  hidden: 'data-block-hidden',
  /** Own title instead of the type name. */
  title: 'data-block-title',
  /** `"1"`/`"0"`: show the title in read mode — missing = the type's default. */
  showTitle: 'data-block-show-title',
  /** JSON: how the block is built (field block: elements + display rules). */
  config: 'data-block-config',
  /** JSON: scalar values of the block. References and images are in the markup (slots). */
  data: 'data-block-data',
} as const;

/**
 * A block as it stands in the stored `content`.
 *
 * `type` is deliberately `string`, not `BlockTypeId`: what this app version
 * does not know is read too — a block from a newer version or from a missing
 * extension. It must be written back unchanged.
 */
export interface BlockInstance {
  id: string;
  type: string;
  /** Inner HTML of the section. For the text block, the TipTap HTML. */
  html: string;
  /**
   * All remaining `data-*` attributes of the section (`data-block-v`,
   * `data-block-hidden` …), decoded and in their order — so that an
   * unknown type loses nothing on saving.
   */
  attrs: Record<string, string>;
}
