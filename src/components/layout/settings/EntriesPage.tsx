import EmojiDefaultsSection from './EmojiDefaultsSection';
import ImageLimitsSection from './ImageLimitsSection';
import TagRulesSection from './TagRulesSection';

/** Was beim Anlegen und Bearbeiten von Einträgen gilt. */
export default function EntriesPage() {
  return (
    <>
      <EmojiDefaultsSection />
      <ImageLimitsSection />
      <TagRulesSection />
    </>
  );
}
