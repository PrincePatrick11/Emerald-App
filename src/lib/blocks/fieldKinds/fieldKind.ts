import type { LucideIcon } from 'lucide-react';
import type { BlockExportValue, BlockGroup, BlockValue } from '../blockType';
import type { LinkCategoryFilter, RefReporter } from '../toolkit';

/**
 * What a kind of field is and brings along — the interface through which the
 * fields block (`core.fields`) learns everything about one of its fields, as
 * the app learns about a block through `BlockTypeDef`. The fields block knows
 * no kind: it asks the field's kind (`fieldKindOf`, `fieldKinds.ts`) and works
 * with what comes back. Each built-in kind is a file of its own in this
 * folder; `fieldKinds.ts` registers them, and `components/blocks/fieldKinds/`
 * holds what each one shows.
 *
 * Where a field's value lives is the kind's to say (`storage`):
 * - `value`: JSON in the block's `data-block-data`, under the field's ID;
 * - `slot`: markup in the inner HTML, in `<dd data-block-slot="el:<id>">` —
 *   a link chip, an `<img src>`, the text editor's HTML — so that the link
 *   table, backlinks, merge import and image cleanup find it without a special case.
 * Either way the kind sees it as the field's *stored* value (`FieldRead.stored`):
 * the JSON value, or the slot's markup as a string.
 *
 * Pure, like all of `lib/blocks`: no React, stores or TipTap.
 */

/** Any JSON value a field may hold, or a slot's markup (a string). */
export type FieldValue = string | number | boolean | object;

/** What a prefill is: a value of the kind's own shape (a link's target with its name, an image's file name, a checklist …). */
export type ElementDefault = FieldValue;

/** How a field shows outside its block — see `FieldUses` in `fields.ts`. */
export const FIELD_USES = ['info', 'panel', 'values'] as const;
export type FieldUse = (typeof FIELD_USES)[number];
export type FieldUses = Record<FieldUse, boolean>;

/**
 * One field (element) of a fields block, as it is stored in the block's config
 * and in a custom block's definition. A kind may keep settings of its own
 * beside these keys (a choice's `options`, a link's `linkCategories`); it reads
 * them itself (`FieldKindDef.parseConfig`).
 */
export interface ElementDef {
  id: string;
  /** The ID of its kind (`FieldKindDef.id`). */
  kind: string;
  /** Empty = name of the kind in the current language. */
  label: string;
  /** Overrides `display.readHideEmpty` for this element. */
  hideWhenEmpty?: boolean;
  /**
   * Only in a custom block definition: the value with which every new copy
   * prefills the element. Its shape is the kind's (`FieldKindDef.prefill`);
   * the definition holds no markup — a link gives its target, an image its
   * file name, and only the copy makes a chip or `<img>` of it.
   */
  defaultValue?: ElementDefault;
  /**
   * How the field shows outside its block (`FieldUse`) — set in the builder
   * and travelling with every copy like the rest of the element. A use not
   * stored is off.
   */
  uses?: Partial<FieldUses>;
  /** The data version of its kind (`FieldKindDef.dataVersion`) — stored only above 1. */
  v?: number;
}

/** A choice's option. Values store the option ID, renaming loses nothing. */
export interface SelectOption {
  id: string;
  label: string;
}

/** A choice field: its options in its own key. */
export interface SelectElement extends ElementDef {
  options?: SelectOption[];
}

/**
 * A link field: the search offers just entries and tasks of these categories
 * (and, with `includeUncategorized`, those without one). Missing = no filter.
 * A link already set stays, whatever its category.
 */
export interface LinkElement extends ElementDef {
  linkCategories?: LinkCategoryFilter;
}

/** A field as its kind is asked about it: the element and what it holds (JSON value or slot markup; `undefined` = nothing). */
export interface FieldRead<E extends ElementDef = ElementDef> {
  element: E;
  stored: FieldValue | undefined;
}

/** What the readable fallback says in the current language — the callers pass `t` in. */
export interface FallbackText {
  label: (element: ElementDef) => string;
  /** A text by its i18n key, for what a kind writes along (yes/no). */
  t: (key: string) => string;
}

/** How a prefill's targets are mapped on import: a picture's stored name, a link's target (`null`: not there, the prefill is dropped). */
export interface PrefillRemap {
  image: (name: string) => string;
  link: (target: { id: string; targetKind: string; label: string }) => { id: string; label: string; targetKind?: string } | null;
}

/**
 * The kind's prefills in a custom block's definition (`ElementDef.defaultValue`).
 * A kind without one offers no prefill (a long text: it would be markup in the definition).
 */
export interface FieldPrefill<E extends ElementDef = ElementDef> {
  /** A prefill from an unreliable source (database, backup, `.emerald`), checked — `undefined` for anything that does not fit. */
  parse: (raw: unknown, element: E) => ElementDefault | undefined;
  /** What a field holds with this prefill (value or markup); `fresh` for a new copy (a checklist's items get IDs of their own). */
  toStored: (prefill: ElementDefault, element: E, fresh: boolean) => FieldValue | undefined;
  /** The reverse, for the builder: the prefill a stored value gives — `undefined` for nothing usable. */
  fromStored: (stored: FieldValue, element: E) => ElementDefault | undefined;
  /** What a ticked prefill starts with before anything is entered (yes/no: "yes", since "no" is the field's start anyway). */
  startValue?: ElementDefault;
  /** What the prefill points at, reported with the role `default`. */
  refs?: (prefill: ElementDefault, report: RefReporter) => void;
  /**
   * The prefill as an import maps it — `undefined` to drop it (a link whose
   * target is not there). Missing: kept as it is. It gets the prefill in the
   * kind's current shape: an element of an older version is brought up first,
   * one of a newer version is left alone.
   */
  remap?: (raw: unknown, map: PrefillRemap) => unknown;
}

export interface FieldKindDef<E extends ElementDef = ElementDef> {
  /** Stable: stored as the element's `kind`. */
  id: string;
  icon: LucideIcon;
  /** Its name — in the picker, as the label of an unnamed field, as placeholder (`blocks.kinds.<id>` in the four locale files). */
  labelKey: string;
  /** "Add block" offers a single field of this kind, in this group; missing: not offered on its own. */
  presetGroup?: BlockGroup;
  /**
   * The version of the kind's stored form (`ElementDef.v`, missing = 1). A
   * lower one is brought up by `upgrade` when the block is read; a higher one
   * comes from a newer app, and the block is unreadable here, like one
   * holding a kind this app does not know.
   */
  dataVersion: number;
  /**
   * Brings an element up from version `from`: the element as it was stored,
   * with its prefill (`defaultValue`) in the old shape — bring that up too —
   * and what the field held, both ways it may have been kept (`value` from the
   * JSON, `slot` the markup; a definition has neither). It returns the element
   * and what the field holds now, as the kind keeps it (`storage`).
   */
  upgrade?: (
    raw: { element: Record<string, unknown>; value: unknown; slot: string | undefined },
    from: number,
  ) => { element: Record<string, unknown>; stored: unknown };
  storage: 'value' | 'slot';
  /** The field is a text editor — the one shared with the text block, hosted by the stack like a text block (interface 15). */
  textEditor?: boolean;
  /** The kind's own settings from an unreliable element (id, kind and label are read already). */
  parseConfig?: (raw: Record<string, unknown>) => Partial<E>;
  /** The own settings a new field starts with (a choice: no options yet). */
  initialConfig?: () => Partial<E>;
  /** A `value` kind's stored JSON, checked — `undefined` for anything that does not fit (it is dropped). */
  parseValue?: (raw: unknown, element: E) => FieldValue | undefined;
  /** Does the field hold no (valid) value? Read mode hides it then, as the display rules say, and nothing shows outside. */
  isEmpty: (field: FieldRead<E>) => boolean;
  /** `false`: never empty (yes/no: unset is "no"), so there is no "hide when empty" for it. */
  canBeEmpty?: false;
  /** The uses outside the block the kind can have; a picture has none, a long text no filtering. */
  uses: readonly FieldUse[];
  /** The uses a new field of a custom block starts with. */
  startUses: readonly FieldUse[];
  /** Offered to sort by, where `values` is on ("done/all" of a checklist is no order). */
  sortable: boolean;
  /** A `value` kind's value as readable HTML for the fallback (search, an app that does not know the type); asked only when not empty. */
  fallbackHtml?: (field: FieldRead<E>, text: FallbackText) => string | null;
  /** Its value for the info line, the panel and the dashboards — asked only when not empty; `null` for none. */
  value: (field: FieldRead<E>) => BlockValue | null;
  /** Its value in PDF, HTML and Markdown where it is not `value` (markup, a picture) — asked only when not empty. */
  exportValue?: (field: FieldRead<E>) => BlockExportValue | null;
  prefill?: FieldPrefill<E>;
  /**
   * A slot without its link to `target` ("Linked entries" removing one where
   * no mounted text editor holds it): the new markup, `null` to empty the
   * field, `undefined` if it holds no such link.
   */
  withoutLink?: (slot: string, target: string) => string | null | undefined;
}

/** A stored value as a string, else nothing — the check most kinds share. */
export function storedString(stored: unknown): string | undefined {
  return typeof stored === 'string' ? stored : undefined;
}
