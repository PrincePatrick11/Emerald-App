import { useTranslation } from 'react-i18next';
import { phraseText } from '../../lib/blocks/blockType';
import { moonBlockLabelKey, moonPhaseIn, moonPhaseValue } from '../../lib/blocks/moon';
import BlockFieldRow from './BlockFieldRow';
import type { BlockViewProps } from './blockViews';

/**
 * The moon phase block (`core.moon`): the phase of the entry's day as a
 * labelled row, laid out like a single field. Nothing to edit — in a
 * template, which has no day, it says what it will show.
 */
export default function MoonBlock({ isEditing, context }: BlockViewProps) {
  const { t } = useTranslation();
  const phase = moonPhaseIn(context);
  return (
    <div className={isEditing ? 'block-fields block-fields--edit' : 'block-fields'}>
      <BlockFieldRow label={t(moonBlockLabelKey)}>
        {phase
          ? phraseText(moonPhaseValue(phase), t)
          : <span className="block-field-hint">{t('blocks.types.moon.outsideEntry')}</span>}
      </BlockFieldRow>
    </div>
  );
}
