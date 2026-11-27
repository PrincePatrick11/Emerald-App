import EditorFormattingSection from './EditorFormattingSection';
import EmojiDefaultsSection from './EmojiDefaultsSection';
import ImageLimitsSection from './ImageLimitsSection';
import TagRulesSection from './TagRulesSection';

/** What applies when creating and editing entries. */
export default function EntriesPage() {
  return (
    <>
      <EmojiDefaultsSection />
      <ImageLimitsSection />
      <TagRulesSection />
      <EditorFormattingSection />
    </>
  );
}
