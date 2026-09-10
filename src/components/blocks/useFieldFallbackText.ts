import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { elementLabel } from '../../lib/blocks/blockAttrs';
import type { FallbackText } from '../../lib/blocks/fields';

/**
 * Die Texte, mit denen `serializeFields` den lesbaren Fallback eines
 * Feldblocks schreibt — in der aktuellen Sprache. Eine Stelle für Block und
 * Seitenleisten-Abschnitt, damit beide denselben Fallback erzeugen.
 */
export function useFieldFallbackText(): FallbackText {
  const { t } = useTranslation();
  return useMemo(() => ({
    label: (element) => elementLabel(t, element),
    yes: t('blocks.fields.yes'),
    no: t('blocks.fields.no'),
    moonName: (phase) => t(`moonPhase.${phase}`),
  }), [t]);
}
