import type { ComponentType } from 'react';
import type { ElementDef, FieldValue } from '../../../lib/blocks/fieldKinds/fieldKind';

/**
 * What a kind of field shows — the component half of a `FieldKindDef`, kept
 * apart as `blockViews.ts` is from `blockTypes.ts`. The fields block, the
 * Block builder and the block's sidebar render these for a field and know no
 * kind. A kind that is a text editor (`FieldKindDef.textEditor`) needs none:
 * the fields block hosts the shared text editor for it.
 *
 * `stored` is what the field holds, as its kind keeps it: the JSON value, or
 * the slot's markup for a kind stored as `slot`. `onChange(undefined)` empties it.
 */
export interface FieldInputProps<E extends ElementDef = ElementDef> {
  element: E;
  stored: FieldValue | undefined;
  onChange: (stored: FieldValue | undefined) => void;
}

/**
 * Read mode: asked only for a field that is not empty (`FieldKindDef.isEmpty`;
 * a kind that is never empty may hold nothing yet). `onChange` where the
 * field may be changed while reading (a tick, a switch).
 */
export interface FieldReadProps<E extends ElementDef = ElementDef> {
  element: E;
  stored: FieldValue | undefined;
  onChange?: (stored: FieldValue | undefined) => void;
}

/** The kind's own settings of a field (a choice's options): `onPatch` changes the element. */
export interface FieldSettingsProps<E extends ElementDef = ElementDef> {
  element: E;
  onPatch: (patch: Partial<E>) => void;
  /** The builder's look, or the block sidebar's (`panel`). */
  variant: 'builder' | 'panel';
}

export interface FieldKindView<E extends ElementDef = ElementDef> {
  /** The input while editing — also the builder's prefill (with the prefill as `stored`). */
  Input: ComponentType<FieldInputProps<E>>;
  /** What read mode shows. */
  Read: ComponentType<FieldReadProps<E>>;
  /** Settings of its own, in the builder and in the block's sidebar, before "hide when empty". */
  Settings?: ComponentType<FieldSettingsProps<E>>;
  /** Settings only the builder offers (a link's category filter: not editable inside an entry), after "hide when empty". */
  DefinitionSettings?: ComponentType<FieldSettingsProps<E>>;
}
