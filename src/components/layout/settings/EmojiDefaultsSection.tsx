import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RotateCcw, Smile } from 'lucide-react';
import Button from '../../ui/Button';
import { DEFAULT_EMOJI_PICKER_EMOJIS, searchEmojis } from '../../../lib/emojiSearch';
import { useEmojiSearchData } from '../../../hooks/useEmojiSearchData';
import { useSettingsStore } from '../../../store/settingsStore';
import SettingsSection from './SettingsSection';
import SearchField from '../../ui/SearchField';

/** From this many pixels of movement on, a press is a drag and no longer a click. */
const DRAG_THRESHOLD = 4;

interface DragState {
  pointerId: number;
  startX: number;
  startY: number;
  index: number;
  moved: boolean;
  order: string[];
}

/**
 * The emojis every picker offers without a search. Click removes, dragging
 * sorts, the search below adds.
 *
 * Dragging uses pointer events instead of HTML5 drag: on Windows,
 * Tauri's file drop intercepts the native drag events (the same situation as
 * when dragging entries, see `lib/dragState`).
 *
 * Not via `hooks/usePointerReorder`: it measures the target position on the
 * Y axis and expects a list of rows. The grid here wraps, so an
 * emoji has neighbours left and right — the target position therefore comes
 * from `elementFromPoint`.
 */
export default function EmojiDefaultsSection() {
  const { t } = useTranslation();
  const stored = useSettingsStore((s) => s.settings.emojis.defaults);
  const update = useSettingsStore((s) => s.update);
  const current = stored ?? DEFAULT_EMOJI_PICKER_EMOJIS;

  // A local order while dragging; it is only written on release.
  const [draft, setDraft] = useState<string[] | null>(null);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const drag = useRef<DragState | null>(null);
  const list = draft ?? current;

  const [query, setQuery] = useState('');
  const trimmedQuery = query.trim().toLowerCase();
  const searchData = useEmojiSearchData(trimmedQuery !== '');
  const results = trimmedQuery && searchData ? searchEmojis(searchData, trimmedQuery) : [];

  const save = (defaults: string[]) => update('emojis', { defaults });
  // As with the sidebar tabs, one is always left.
  const remove = (index: number) => { if (current.length > 1) save(current.filter((_, i) => i !== index)); };

  function onPointerDown(e: React.PointerEvent<HTMLButtonElement>, index: number) {
    if (e.button !== 0) return;
    // It works without capture too (the neighbours carry the same handlers) —
    // only a synthetic event rejects it.
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* s.o. */ }
    drag.current = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, index, moved: false, order: [...current] };
  }

  function onPointerMove(e: React.PointerEvent<HTMLButtonElement>) {
    const state = drag.current;
    if (!state || state.pointerId !== e.pointerId) return;
    if (!state.moved) {
      if (Math.hypot(e.clientX - state.startX, e.clientY - state.startY) < DRAG_THRESHOLD) return;
      state.moved = true;
      setDraggingIndex(state.index);
    }
    const over = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-emoji-index]');
    const target = over ? Number(over.dataset.emojiIndex) : state.index;
    if (target === state.index) return;
    const order = [...state.order];
    const [moved] = order.splice(state.index, 1);
    order.splice(target, 0, moved);
    state.order = order;
    state.index = target;
    setDraft(order);
    setDraggingIndex(target);
  }

  function onPointerUp(e: React.PointerEvent<HTMLButtonElement>) {
    const state = drag.current;
    if (!state || state.pointerId !== e.pointerId) return;
    drag.current = null;
    setDraggingIndex(null);
    setDraft(null);
    // Without movement, `state.index` is the emoji the press began on — not
    // necessarily the one under the release, if the capture did not happen.
    if (state.moved) save(state.order);
    else remove(state.index);
  }

  function onPointerCancel(e: React.PointerEvent<HTMLButtonElement>) {
    if (drag.current?.pointerId !== e.pointerId) return;
    drag.current = null;
    setDraggingIndex(null);
    setDraft(null);
  }

  return (
    <SettingsSection icon={<Smile size={14} />} title={t('settings.emojiDefaults')} description={t('settings.emojiDefaultsHint')}>
      <div className="panel p-2 space-y-2">
        <div className="flex flex-wrap gap-1">
          {list.map((emoji, index) => (
            <button
              key={emoji}
              type="button"
              data-emoji-index={index}
              // The last one stays (like the sidebar's last tab) — visibly
              // greyed out, instead of merely not reacting to the click.
              disabled={list.length === 1}
              title={t('settings.emojiItemTitle')}
              aria-label={t('settings.emojiRemove', { emoji })}
              onPointerDown={(e) => onPointerDown(e, index)}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerCancel}
              // Keyboard: Enter/Space removes like a click. Pointer clicks are
              // handled by `onPointerUp`; `detail === 0` means triggered by key.
              onClick={(e) => { if (e.detail === 0) remove(index); }}
              className={`emoji-picker-item text-xl w-9 h-9 flex items-center justify-center rounded-md transition-colors touch-none disabled:opacity-50 disabled:cursor-default ${
                draggingIndex === index ? 'emoji-picker-item-active cursor-grabbing' : 'emoji-picker-item-idle cursor-grab'
              }`}
            >
              {emoji}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <SearchField
            value={query}
            onValueChange={setQuery}
            placeholder={t('common.searchEmoji')}
            aria-label={t('common.searchEmoji')}
            className="flex-1 min-w-0"
          />
          {stored !== null && (
            <Button variant="secondary" onClick={() => update('emojis', { defaults: null })} className="shrink-0">
              <RotateCcw size={14} />
              {t('settings.emojiReset')}
            </Button>
          )}
        </div>

        {trimmedQuery && searchData && (
          results.length === 0 ? (
            <p className="text-xs px-1 text-muted">{t('common.noEmojiResults')}</p>
          ) : (
            <div className="flex flex-wrap gap-1 max-h-40 overflow-y-auto">
              {results.map((emoji) => {
                const added = current.includes(emoji);
                return (
                  <button
                    key={emoji}
                    type="button"
                    disabled={added}
                    aria-label={t('settings.emojiAdd', { emoji })}
                    onClick={() => save([...current, emoji])}
                    className={`emoji-picker-item text-xl w-9 h-9 flex items-center justify-center rounded-md transition-colors ${
                      added ? 'emoji-picker-item-active cursor-default' : 'emoji-picker-item-idle'
                    }`}
                  >
                    {emoji}
                  </button>
                );
              })}
            </div>
          )
        )}
      </div>
    </SettingsSection>
  );
}
