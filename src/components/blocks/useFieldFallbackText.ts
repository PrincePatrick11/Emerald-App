import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { fieldFallbackText } from '../../lib/blocks/blockAttrs';
import type { FallbackText } from '../../lib/blocks/fields';

/**
 * Die Texte, mit denen `serializeFields` den lesbaren Fallback eines
 * Feldblocks schreibt — in der aktuellen Sprache. Eine Stelle für Block und
 * Seitenleisten-Abschnitt; Migration und Importe nehmen `fieldFallbackText`
 * direkt mit `i18n.t`.
 */
export function useFieldFallbackText(): FallbackText {
  const { t } = useTranslation();
  return useMemo(() => fieldFallbackText(t), [t]);
}
