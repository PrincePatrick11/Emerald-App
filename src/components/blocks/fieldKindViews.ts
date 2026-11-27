import type { ElementDef, FieldKindDef } from '../../lib/blocks/fieldKinds/fieldKind';
import { shorttextFieldKind } from '../../lib/blocks/fieldKinds/shorttext';
import { numberFieldKind } from '../../lib/blocks/fieldKinds/number';
import { dateFieldKind } from '../../lib/blocks/fieldKinds/date';
import { selectFieldKind } from '../../lib/blocks/fieldKinds/select';
import { toggleFieldKind } from '../../lib/blocks/fieldKinds/toggle';
import { checklistFieldKind } from '../../lib/blocks/fieldKinds/checklist';
import { linkFieldKind } from '../../lib/blocks/fieldKinds/link';
import { imageFieldKind } from '../../lib/blocks/fieldKinds/image';
import { shorttextFieldView } from './fieldKinds/shorttext';
import { numberFieldView } from './fieldKinds/number';
import { dateFieldView } from './fieldKinds/date';
import { selectFieldView } from './fieldKinds/select';
import { toggleFieldView } from './fieldKinds/toggle';
import { checklistFieldView } from './fieldKinds/checklist';
import { linkFieldView } from './fieldKinds/link';
import { imageFieldView } from './fieldKinds/image';
import type { FieldKindView } from './fieldKinds/fieldKindView';

/** A kind and its views — typed alike, so that a view fits the elements of its kind; the map holds them as any kind's. */
function entry<E extends ElementDef>(kind: FieldKindDef<E>, view: FieldKindView<E>): [string, FieldKindView] {
  return [kind.id, view as unknown as FieldKindView];
}

/**
 * Which views show a kind of field: the component half of the field kinds'
 * registry (`lib/blocks/fieldKinds.ts`), by the kind's ID. Text has none: a
 * kind that is a text editor is hosted by the fields block itself.
 *
 * Import rule: nothing here may load TipTap — the block's sidebar, which is
 * loaded eagerly, renders the kinds' settings.
 */
const FIELD_KIND_VIEWS: ReadonlyMap<string, FieldKindView> = new Map<string, FieldKindView>([
  entry(shorttextFieldKind, shorttextFieldView),
  entry(numberFieldKind, numberFieldView),
  entry(dateFieldKind, dateFieldView),
  entry(selectFieldKind, selectFieldView),
  entry(toggleFieldKind, toggleFieldView),
  entry(checklistFieldKind, checklistFieldView),
  entry(linkFieldKind, linkFieldView),
  entry(imageFieldKind, imageFieldView),
]);

/** The views of a field's kind — `undefined` for a text editor's kind (or one without views). */
export function fieldKindView(element: ElementDef): FieldKindView | undefined {
  return FIELD_KIND_VIEWS.get(element.kind);
}
