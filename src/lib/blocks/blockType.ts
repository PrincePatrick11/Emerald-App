import type { LucideIcon } from 'lucide-react';
import type { ListInfoProvider } from './listInfo';
import type { RefReporter } from './toolkit';
import type { BlockInstance, BlockTypeId } from './types';

/**
 * What a block type is and brings along — the interfaces through which the
 * app learns everything it has to know about a block and can do with it.
 * Nothing about a type is wired into views, lists or categories: a view asks
 * the type (`resolveBlockType`) and works with what comes back.
 *
 * Two ground rules hold for every interface:
 * - **Blocks deliver values, the app builds the display.** No interface
 *   returns markup or components (the component half lives in
 *   `components/blocks/blockViews.ts`); what comes back is data.
 * - **The user before the block before the category.** Where a block
 *   suggests something the user or the category can also set (icon, cover),
 *   the user's own value wins — unless the type says its value is not to be
 *   overridden — and the block's beats the category's (`entryProperties`).
 *
 * Built-in types (`origin: 'core'`) fix their behaviour here; a user-built
 * block is a `core.fields` whose settings decide more. The shape is meant to
 * carry a later extension API (`origin: 'plugin'`) unchanged.
 *
 * Numbers in the comments are those of the concept "block interfaces";
 * interfaces whose turn comes in a later step are declared, and no type
 * fills them yet.
 *
 * Import rule as for all of `lib/blocks`: pure — no React, stores or TipTap.
 */

export type BlockGroup = 'text' | 'fields' | 'sigil' | 'media' | 'reference' | 'moon';

/** Where a block is: the entry it belongs to, and its date. `null` outside an entry (a template, a block definition). */
export interface BlockContext {
  entryId: string | null;
  /** The entry's day, local `yyyy-MM-dd` (`entryDate` in the toolkit). */
  entryDate: string | null;
  /** Today, local `yyyy-MM-dd`: what is due or concealed depends on it. */
  today: string;
}

/** One value a block delivers — for property rows, filters and sorting. The app words and formats it. */
export type BlockValue =
  | { kind: 'date'; iso: string }
  | { kind: 'text'; text: string }
  | { kind: 'number'; value: number }
  | { kind: 'bool'; value: boolean };

/* ---------------- 2 Export ---------------- */

/** One piece of what a block shows in PDF, HTML, Markdown — the app lays them out per format (#151). */
export type BlockExportPart =
  | { kind: 'text'; text: string }
  | { kind: 'html'; html: string }
  | { kind: 'image'; file: string; alt?: string };

/* ---------------- 3 Properties ---------------- */

/** A row a block adds to the entry's properties panel. */
export interface BlockPropertyRow {
  key: string;
  labelKey: string;
  icon?: LucideIcon;
  value: BlockValue;
}

/**
 * What a block adds to the entry's properties: rows of its own, and values it
 * suggests for icon, cover and tags. Suggested values are told apart from
 * the user's (`entryProperties` returns where each one comes from).
 *
 * Tags of a block hold only while the block is there: they are never
 * written into the entry's own tags, but count in dashboard filters and the
 * tags view. They are reported with the block's references (`block_refs`,
 * kind `tag`), which is why `tags` reads the block alone, without context.
 * A hidden block is still there: it keeps giving its tags, while its rows,
 * icon and cover are not shown (`entryProperties`).
 */
export interface BlockProperties {
  /** The cheap pre-check on the raw content, as `ListInfoProvider.mayContribute`: lists stay fast. */
  mayContribute: (content: string) => boolean;
  rows?: (block: BlockInstance, ctx: BlockContext) => BlockPropertyRow[];
  /** An emoji or an icon file, or `null`. */
  icon?: (block: BlockInstance, ctx: BlockContext) => string | null;
  /** A stored picture, or `null`. */
  cover?: (block: BlockInstance, ctx: BlockContext) => string | null;
  /** Tag IDs. */
  tags?: (block: BlockInstance) => string[];
  /** May the user's own icon or cover take the place of the block's? */
  overridable: { icon: boolean; cover: boolean };
}

/* ---------------- 4 / 9 Filter, sort, date ---------------- */

/** A value a block offers dashboards to filter or sort by (later a calendar). */
export interface BlockFieldValue {
  key: string;
  labelKey: string;
  value: BlockValue | null;
  filter: boolean;
  sort: boolean;
}

/* ---------------- 6 Effect on the entry ---------------- */

/** What a block does to the whole entry: lock it, lock or conceal blocks (#182). */
export interface BlockEntryEffect {
  lockEntry?: boolean;
  /** Block (or part) IDs that cannot be edited. */
  locked?: readonly string[];
  /** Block (or part) IDs concealed, until a day or (`null`) until lifted. */
  concealed?: ReadonlyMap<string, string | null>;
}

/* ---------------- 7 Storage ---------------- */

/**
 * Where a block keeps what it gathers: a tag its pictures carry and its
 * picture list shows first. A fixed ID, so vaults and backups agree on it;
 * the tag is made with the name when first needed, and is an ordinary tag
 * otherwise — renamable, deletable.
 */
export interface BlockStorage {
  tag: { id: string; name: string };
}

/* ---------------- 10 Actions ---------------- */

/**
 * A command of its own in the block's menu while editing — and, with
 * `inRead`, in the "Actions" section of the properties panel while reading.
 * The mounted view carries it out (`useBlockAction`); the type only declares it.
 */
export interface BlockActionDef {
  id: string;
  labelKey: string;
  icon: LucideIcon;
  inRead: boolean;
  /** Offered only if this holds (a canvas with nothing on it has no picture to save). */
  available?: (block: BlockInstance) => boolean;
}

/* ---------------- 12 Copy ---------------- */

export interface BlockCopyContext {
  /** Old block ID → new one, for every block copied in the same go (one when duplicating, all of a template). */
  ids: ReadonlyMap<string, string>;
}

/* ---------------- 14 Settings ---------------- */

/**
 * A setting of a block, described by its type and shown alike for every
 * block (the block's menu while editing). Stored per block
 * (`data-block-settings`), read with its start value through
 * `readBlockSettings`.
 */
export type BlockSettingDef =
  | { key: string; labelKey: string; kind: 'toggle'; initial: boolean }
  | { key: string; labelKey: string; kind: 'select'; options: readonly { value: string; labelKey: string }[]; initial: string };

export type BlockSettingValue = boolean | string;

/* ---------------- The type ---------------- */

export interface BlockTypeDef {
  id: BlockTypeId;
  origin: 'core' | 'plugin';
  icon: LucideIcon;
  labelKey: string;
  descriptionKey: string;
  group: BlockGroup;
  /** Show the title in read mode unless the instance says otherwise. */
  defaultShowTitle: boolean;
  /**
   * 13 — version of the stored data format (`data-block-v`, missing = 1). A
   * block with a higher one comes from a newer app and is treated like an
   * unknown type: shown as a fallback, saved unchanged. A lower one is
   * brought up by `upgrade` when the block is read into a stack.
   */
  dataVersion: number;
  upgrade?: (block: BlockInstance, from: number) => BlockInstance;

  /** 1 — what the block adds to its entry's info line in lists. */
  listInfo?: ListInfoProvider;
  /** 2 — how the block appears in an export (#151). */
  export?: (block: BlockInstance, ctx: BlockContext) => BlockExportPart[];
  /** 3 — rows and suggested values for the entry's properties; the panel shows them (#181). */
  properties?: BlockProperties;
  /** 4 / 9 — values to filter and sort dashboards by (#181). */
  values?: (block: BlockInstance, ctx: BlockContext) => BlockFieldValue[];
  /** 6 — what the block does to the whole entry (#182). */
  entryEffect?: (block: BlockInstance, blocks: readonly BlockInstance[], ctx: BlockContext) => BlockEntryEffect;
  /** 7 — the tag the block's pictures go under. */
  storage?: BlockStorage;
  /** 8 — the text the search finds; none if missing. */
  searchText?: (block: BlockInstance) => string;
  /** 10 — commands of the block. */
  actions?: readonly BlockActionDef[];
  /** 11 — what the block points at: entries, pictures, icons (`block_refs`). Tags come from `properties.tags`. */
  refs?: (block: BlockInstance, report: RefReporter) => void;
  /** 11 — the block without a picture where it shows it as one of its own; a drawing keeps its pictures. */
  withoutImage?: (block: BlockInstance, file: string) => BlockInstance;
  /** 12 — the block as a copy (it already carries its new ID): what it points at inside the copied blocks follows. */
  copy?: (block: BlockInstance, ctx: BlockCopyContext) => BlockInstance;
  /** 12 — another block of the entry was duplicated; this one may have to take the copy in (a charge covering it). */
  siblingCopied?: (block: BlockInstance, from: string, to: string) => BlockInstance;
  /** 14 — the settings the block offers. */
  settings?: readonly BlockSettingDef[];
}
