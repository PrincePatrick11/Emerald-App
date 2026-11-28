import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DEFAULT_EMOJI_PICKER_EMOJIS, searchEmojis } from '../../lib/emojiSearch';
import { useEmojiSearchData } from '../../hooks/useEmojiSearchData';
import { useSettingsStore } from '../../store/settingsStore';
import GlyphPicker, { type GlyphPickerProps } from './GlyphPicker';

interface EmojiPickerProps extends Pick<GlyphPickerProps, 'trigger' | 'align' | 'size' | 'wrapperClassName'> {
  value: string;
  onChange: (emoji: string) => void;
  /** Defaults to the vault's emoji set (Settings → Entries) — pass only to offer a narrower selection. */
  emojis?: string[];
}

/** Shared emoji-picker popover (`GlyphPicker`): the vault's emoji set, and a search across the full localised emoji set. */
export default function EmojiPicker({ value, onChange, emojis, ...rest }: EmojiPickerProps) {
  const { t } = useTranslation();
  const vaultEmojis = useSettingsStore((s) => s.settings.emojis.defaults);
  const offered = emojis ?? vaultEmojis ?? DEFAULT_EMOJI_PICKER_EMOJIS;
  const [open, setOpen] = useState(false);
  const searchData = useEmojiSearchData(open);

  return (
    <GlyphPicker
      {...rest}
      onOpenChange={setOpen}
      searchPlaceholder={t('common.searchEmoji')}
      emptyText={t('common.noEmojiResults')}
      cells={(query) => {
        if (query && searchData === null) return null;
        const shown = query ? searchEmojis(searchData ?? [], query) : offered;
        return shown.map((emoji) => ({ key: emoji, content: emoji, active: value === emoji, onPick: () => onChange(emoji) }));
      }}
    />
  );
}
