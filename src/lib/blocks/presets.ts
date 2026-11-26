import { fieldFallbackText } from './fields';
import { instantiateDefinition, type BlockDefinition } from './definitions';
import { blockTypePresets } from './blockTypes';
import type { BlockPreset } from './blockType';
import type { BlockInstance } from './types';

/**
 * What "Add block" offers: what each type offers of itself (`BlockTypeDef.presets`,
 * a field per kind for the fields block), in the order the types are
 * registered. Behind them come the custom blocks from the blocks view
 * (`def:<id>`) — the caller reads them from the store and passes them in,
 * because `lib/blocks` knows no stores.
 */
export const BLOCK_PRESETS: readonly BlockPreset[] = blockTypePresets();

const DEFINITION_PRESET_PREFIX = 'def:';

/** The preset ID of a custom block. */
export function definitionPresetId(defId: string): string {
  return `${DEFINITION_PRESET_PREFIX}${defId}`;
}

/**
 * A new block from a preset — `null` if it does not (or no longer) exist.
 * `t` words the readable fallback a custom block's copy writes along.
 */
export function createFromPreset(
  presetId: string,
  definitions: readonly BlockDefinition[],
  t: (key: string) => string,
): BlockInstance | null {
  if (presetId.startsWith(DEFINITION_PRESET_PREFIX)) {
    const def = definitions.find((d) => d.id === presetId.slice(DEFINITION_PRESET_PREFIX.length));
    return def ? instantiateDefinition(def, fieldFallbackText(t)) : null;
  }
  return BLOCK_PRESETS.find((p) => p.id === presetId)?.create() ?? null;
}
