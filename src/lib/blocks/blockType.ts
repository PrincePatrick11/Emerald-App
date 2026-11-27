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
 *   overridden — and the block's beats the category's (`resolveProperty`).
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

/**
 * One value a block delivers — for the info line, property rows, filters and
 * sorting. The app words and formats it: a `link` by its target's current
 * title (`linkValueTitle`; the name stored with it only once the target is
 * gone), a `phrase` as a text key (after an optional symbol).
 */
export type BlockValue =
  | { kind: 'date'; iso: string }
  | { kind: 'text'; text: string }
  | { kind: 'number'; value: number }
  | { kind: 'bool'; value: boolean }
  | { kind: 'link'; id: string; targetKind: string; label: string }
  | { kind: 'phrase'; key: string; symbol?: string };

/**
 * What a value is called: a text key for a type's own names, or — for what
 * the user named (a field of a custom block) — the name itself.
 */
export type BlockValueLabel = { labelKey: string; label?: never } | { label: string; labelKey?: never };

/** The name of a value in the current language (`t` translates a key). */
export function valueLabel(named: BlockValueLabel, t: (key: string) => string): string {
  return named.label ?? t(named.labelKey);
}

/** A `phrase` value worded: its symbol, then its text. */
export function phraseText(value: { key: string; symbol?: string }, t: (key: string) => string): string {
  return value.symbol ? `${value.symbol} ${t(value.key)}` : t(value.key);
}

/* ---------------- 2 Export ---------------- */

/** The formats a block is asked for (`.emerald` carries the block itself, unasked). */
export type BlockExportFormat = 'pdf' | 'html' | 'markdown';

/**
 * One piece of what a block shows in PDF, HTML, Markdown — the app lays them
 * out per format and words them (#151):
 * - `row` is "label: value" (a missing value shows as a dash), labelled by a
 *   text key or by a name the user gave (a field's),
 * - `html` is markup the block already holds in its readable form (a link
 *   chip, an escaped text),
 * - `image` is a stored picture, its alt text a key or — without one — the
 *   block's title,
 * - `concealed` is content the reader uncovers: in HTML covered under its
 *   heading (`labelKey`, if any), with a switch to uncover it; in the formats
 *   without one (PDF, Markdown) it is left out, heading and all. A block that
 *   wants it missing even in HTML leaves it out itself.
 */
export type BlockExportPart =
  | { kind: 'text'; text: string }
  | { kind: 'html'; html: string }
  | { kind: 'image'; file: string; altKey?: string }
  | { kind: 'heading'; labelKey: string }
  | ({ kind: 'row'; value: BlockExportValue | null } & BlockValueLabel)
  | { kind: 'note'; textKey: string }
  | { kind: 'concealed'; labelKey?: string; until: string | null; parts: BlockExportPart[] };

/**
 * The value of an export row: a value the app formats, markup the block holds
 * in readable form, or a stored picture (its alt text the row's label unless
 * given).
 */
export type BlockExportValue =
  | BlockValue
  | { kind: 'html'; html: string }
  | { kind: 'image'; file: string; alt?: string };

/** Where a block is exported: the format asked for, the entry's day, and what the entry's blocks conceal today. */
export interface ExportContext {
  format: BlockExportFormat;
  /** The entry's day, local `yyyy-MM-dd`, as `BlockContext.entryDate`; `null` outside an entry. */
  entryDate: string | null;
  today: string;
  /** Block or part IDs concealed by the entry's effects (`entryEffects`), until a day or (`null`) until lifted. */
  concealed: ReadonlyMap<string, string | null>;
}

/** What the search and the entry's effects need to know of where they read: today, for what is concealed until a day. */
export interface ReadContext {
  today: string;
  /**
   * Read as if nothing were concealed — for the stored row text (`blocks.text`),
   * which outlives the day it was written; whoever searches it applies the
   * concealing then.
   */
  revealAll?: boolean;
}

/* ---------------- 3 Properties ---------------- */

/** A row a block adds to the entry's properties panel. */
export type BlockPropertyRow = BlockValueLabel & {
  key: string;
  icon?: LucideIcon;
  value: BlockValue;
};

/**
 * What a block adds to the entry's properties: rows of its own, and values it
 * suggests for icon, cover and tags — and the block's own properties, its
 * name and icon, where it carries them itself. Suggested values are told apart from
 * the user's (`resolveProperty` says where each one comes from).
 *
 * Tags of a block hold only while the block is there: they are never
 * written into the entry's own tags, but count in dashboard filters and the
 * tags view. They are reported with the block's references (`block_refs`,
 * kind `tag`), which is why `tags` reads the block alone, without context.
 * A hidden block is still there: it keeps giving its tags, while its rows,
 * icon and cover are not shown (`blockSuggestions`).
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
  /**
   * What this block is called and its icon in the frame, the block management
   * and the menus, where it carries its own (a custom block's copy, a single
   * field); else the type's. Read whether or not `mayContribute` holds.
   */
  name?: (block: BlockInstance) => BlockInstanceName;
}

/** A lucide icon, or an emoji or icon file the block carries itself. */
export type BlockGlyph = LucideIcon | string;

/** A block's own name and icon (`BlockProperties.name`); a part missing is the type's. */
export interface BlockInstanceName {
  name?: BlockValueLabel;
  glyph?: BlockGlyph;
}

/* ---------------- 4 / 9 Filter, sort, date ---------------- */

/** A value a block offers dashboards to filter or sort by (later a calendar). */
export type BlockFieldValue = BlockValueLabel & {
  /** The same key in every entry for the same value (`sigil.targetDate`, a custom block's field): what a dashboard filters and sorts by. */
  key: string;
  value: BlockValue | null;
  filter: boolean;
  sort: boolean;
  /** Of several values under one key, the lowest rank (then the first) is the entry's — as in the info line; 0 if missing. */
  rank?: number;
};

/**
 * The values a block offers to filter and sort by. Data, not display: a
 * hidden block still has them (a concealed sigil still sorts by its target
 * date). Read through `entryBlockValues` (`entrySummary.ts`).
 */
export interface BlockValues {
  /** The cheap pre-check on the raw content, as `ListInfoProvider.mayContribute`. */
  mayContribute: (content: string) => boolean;
  read: (block: BlockInstance, ctx: BlockContext) => BlockFieldValue[];
}

/* ---------------- 6 Effect on the entry ---------------- */

/** What a block does to the whole entry: lock it, lock or conceal blocks and parts of blocks. */
export interface BlockEntryEffect {
  lockEntry?: boolean;
  /** With `lockEntry`: the text key saying why and how to lift it ("unload the sigil first"). */
  lockReasonKey?: string;
  /** Block (or part) IDs that cannot be edited. */
  locked?: readonly string[];
  /** Block (or part) IDs concealed, until a day or (`null`) until lifted. */
  concealed?: ReadonlyMap<string, string | null>;
}

/**
 * How a type acts on its entry. Read for every list row (an entry locked
 * from the list's menu), hence the cheap pre-check as for the info line.
 * The effects of all blocks are folded by `entryEffects` (`blockTypes.ts`).
 */
export interface BlockEntryEffects {
  mayContribute: (content: string) => boolean;
  read: (block: BlockInstance, blocks: readonly BlockInstance[], ctx: ReadContext) => BlockEntryEffect;
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

/** An entry of "Add block" and of the built-in blocks in the Blocks view. A type may offer several (the fields block one per kind of field). */
export interface BlockPreset {
  /** Stable: "Add block" and the Blocks view name an entry by it. */
  id: string;
  labelKey: string;
  /** Explanation as a tooltip in the overview of the Blocks view — only where the label is not enough. */
  descriptionKey?: string;
  icon: LucideIcon;
  group: BlockGroup;
  create: () => BlockInstance;
}

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
  /** What "Add block" offers of the type, in this order; none: it is not offered. */
  presets?: readonly BlockPreset[];
  /**
   * 13 — version of the stored data format (`data-block-v`, missing = 1). A
   * lower one is brought up by `upgrade` when the block is read into a stack.
   * A higher one comes from a newer app: the block is unreadable here
   * (`blockReadState`), like one of an unknown type.
   */
  dataVersion: number;
  upgrade?: (block: BlockInstance, from: number) => BlockInstance;
  /**
   * 13 — is the block's stored data damaged (JSON that cannot be read)? Then
   * it is unreadable (`blockReadState`): no interface of the type is asked,
   * the app shows a notice and saves it unchanged. Missing: never.
   */
  isBroken?: (block: BlockInstance) => boolean;
  /**
   * 15 — the text editors the block holds, in order: `''` for the block
   * itself (the text block), else a key below it (a custom block's text field,
   * `<block ID>:<key>`). The stack hosts them all alike — toolbar, link
   * requests, drops, the caret in a new block, the page's placeholder in the
   * first one that is a block of its own.
   */
  textEditors?: (block: BlockInstance) => string[];

  /** 1 — what the block adds to its entry's info line in lists. */
  listInfo?: ListInfoProvider;
  /**
   * 2 — how the block appears in PDF, HTML and Markdown, per format (#151);
   * without it, its readable markup. A part of the block the entry's effects
   * conceal (`ctx.concealed`) is the block's own to show covered or leave
   * out; a block concealed as a whole the export covers (HTML) or leaves out.
   */
  export?: (block: BlockInstance, ctx: ExportContext) => BlockExportPart[];
  /** 3 — rows and suggested values for the entry's properties; the panel shows them, a suggested value marked as the block's. */
  properties?: BlockProperties;
  /** 4 / 9 — values to filter and sort dashboards by; the dashboard's controls for them come with #117. */
  values?: BlockValues;
  /** 6 — what the block does to the whole entry: lock it, lock or conceal blocks or parts. */
  entryEffect?: BlockEntryEffects;
  /** 7 — the tag the block's pictures go under. */
  storage?: BlockStorage;
  /** 8 — the text the search finds; none if missing. A part the block conceals today it leaves out itself. */
  searchText?: (block: BlockInstance, ctx: ReadContext) => string;
  /** 10 — commands of the block. */
  actions?: readonly BlockActionDef[];
  /** 11 — what the block points at: entries, pictures, icons (`block_refs`). Tags come from `properties.tags`. */
  refs?: (block: BlockInstance, report: RefReporter) => void;
  /**
   * 11 — whether the block's links still count in "Linked entries" (and so in
   * "include linked entries" of the export) while it is hidden (the eye).
   * Hidden, a block contributes only what its type says; its references are
   * stored all the same, so no picture of it is cleaned away. No built-in type
   * sets it; it is there for a type whose links matter while it is hidden.
   */
  linksWhenHidden?: boolean;
  /** 11 — the block without a picture where it shows it as one of its own; a drawing keeps its pictures. */
  withoutImage?: (block: BlockInstance, file: string) => BlockInstance;
  /**
   * 11 — the block without its link to an entry or task, where no mounted text
   * editor holds it ("Linked entries" removing one): a link field emptied, a
   * chip in a text turned into its word. `t` words what the block writes
   * along (its readable markup). The same block if it holds none.
   */
  withoutLink?: (block: BlockInstance, target: string, t: (key: string) => string) => BlockInstance;
  /** 12 — the block as a copy (it already carries its new ID): what it points at inside the copied blocks follows. */
  copy?: (block: BlockInstance, ctx: BlockCopyContext) => BlockInstance;
  /** 14 — the settings the block offers. */
  settings?: readonly BlockSettingDef[];
}
