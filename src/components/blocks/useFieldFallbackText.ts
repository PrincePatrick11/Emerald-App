import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { fieldFallbackText } from '../../lib/blocks/blockAttrs';
import type { FallbackText } from '../../lib/blocks/fields';

/**
 * The texts with which `serializeFields` writes the readable fallback of a
 * field block, in the current language. One place for block and
 * sidebar section; migration and imports take `fieldFallbackText`
 * directly with `i18n.t`.
 */
export function useFieldFallbackText(): FallbackText {
  const { t } = useTranslation();
  return useMemo(() => fieldFallbackText(t), [t]);
}
