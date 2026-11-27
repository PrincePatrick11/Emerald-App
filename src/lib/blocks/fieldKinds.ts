import type { ElementDef, FieldKindDef } from './fieldKinds/fieldKind';
import { textFieldKind } from './fieldKinds/text';
import { shorttextFieldKind } from './fieldKinds/shorttext';
import { numberFieldKind } from './fieldKinds/number';
import { dateFieldKind } from './fieldKinds/date';
import { selectFieldKind } from './fieldKinds/select';
import { toggleFieldKind } from './fieldKinds/toggle';
import { checklistFieldKind } from './fieldKinds/checklist';
import { linkFieldKind } from './fieldKinds/link';
import { imageFieldKind } from './fieldKinds/image';

/**
 * The kinds of field the fields block (`core.fields`) knows — its registry,
 * as `blockTypes.ts` is the app's for block types. Everything the fields
 * block, the Block builder and the field views know about a kind they ask it
 * here (`fieldKindOf`); none of them names a kind. The order is the one the
 * builder's "Add field" and "Add block" offer them in.
 *
 * The other half, what each kind shows, is `components/blocks/fieldKindViews.ts`.
 */

const registry = new Map<string, FieldKindDef>();

/** Registers a kind of field (the built-in ones below; later an extension's). The last registration of an ID wins. */
export function registerFieldKind<E extends ElementDef>(kind: FieldKindDef<E>): void {
  registry.set(kind.id, kind as unknown as FieldKindDef);
}

for (const kind of [
  textFieldKind,
  shorttextFieldKind,
  numberFieldKind,
  dateFieldKind,
  selectFieldKind,
  toggleFieldKind,
  checklistFieldKind,
  linkFieldKind,
  imageFieldKind,
] as FieldKindDef[]) registerFieldKind(kind);

/** Every registered kind, in the order they are offered. */
export function fieldKinds(): readonly FieldKindDef[] {
  return [...registry.values()];
}

/** The kind of this ID — `undefined` for one this app does not know. */
export function fieldKindOf(id: string): FieldKindDef | undefined {
  return registry.get(id);
}
