import { useTranslation } from 'react-i18next';
import TagInput from '../../editor/TagInput';

/**
 * Das Tag-Feld der Eigenschaften-Seitenleiste: Beschriftung und `TagInput` —
 * im Bearbeiten in seinem Feldrahmen, im Lesen ohne. Journal, Wiki,
 * Operationen und die Seite einer Vorlage zeigen es gleich.
 */
export default function TagsField({ tags, onChange, readOnly = false }: {
  tags: string[];
  onChange?: (tags: string[]) => void;
  readOnly?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div>
      <p className="label-xs mb-2">{t('properties.tags')}</p>
      {readOnly ? (
        <TagInput tags={tags} onChange={() => {}} readOnly />
      ) : (
        <div className="bg-stone-800/40 rounded-md px-3 py-2 border border-stone-700/40">
          <TagInput tags={tags} onChange={onChange ?? (() => {})} />
        </div>
      )}
    </div>
  );
}
