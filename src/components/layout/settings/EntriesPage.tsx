import EditorFormattingSection from './EditorFormattingSection';
import EmojiDefaultsSection from './EmojiDefaultsSection';
import MoonPhaseSection from './MoonPhaseSection';
import ImageLimitsSection from './ImageLimitsSection';
import TagRulesSection from './TagRulesSection';
import TemplateDefaultSection from './TemplateDefaultSection';

/** What applies when creating and editing entries. */
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
