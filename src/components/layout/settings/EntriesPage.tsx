import EditorFormattingSection from './EditorFormattingSection';
import EmojiDefaultsSection from './EmojiDefaultsSection';
import MoonPhaseSection from './MoonPhaseSection';
import ImageLimitsSection from './ImageLimitsSection';
import TagRulesSection from './TagRulesSection';
import TemplateDefaultSection from './TemplateDefaultSection';

/** Was beim Anlegen und Bearbeiten von Einträgen gilt. */
export default function EntriesPage() {
  return (
    <>
      <EmojiDefaultsSection />
      <ImageLimitsSection />
      <TagRulesSection />
      <TemplateDefaultSection />
      <EditorFormattingSection />
      <MoonPhaseSection />
    </>
  );
}
