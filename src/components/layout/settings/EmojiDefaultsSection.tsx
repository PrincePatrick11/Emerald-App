import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RotateCcw, Smile } from 'lucide-react';
import Button from '../../ui/Button';
import { DEFAULT_EMOJI_PICKER_EMOJIS, searchEmojis } from '../../../lib/emojiSearch';
import { useEmojiSearchData } from '../../../hooks/useEmojiSearchData';
import { useSettingsStore } from '../../../store/settingsStore';
import SettingsSection from './SettingsSection';

/** Ab so vielen Pixeln Bewegung ist ein Druck ein Ziehen und kein Klick mehr. */
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
 * Die Emojis, die jeder Picker ohne Suche anbietet. Klick entfernt, Ziehen
 * sortiert, die Suche darunter fügt hinzu.
 *
 * Gezogen wird über Pointer-Events statt HTML5-Drag: unter Windows fängt
 * Tauris Datei-Drop die nativen Drag-Ereignisse ab (dieselbe Lage wie beim
 * Ziehen von Einträgen, siehe `lib/dragState`).
 *
 * Nicht über `hooks/usePointerReorder`: der misst die Zielposition an der
 * Y-Achse und erwartet eine Liste aus Zeilen. Das Raster hier bricht um, ein
 * Emoji hat also Nachbarn links und rechts — die Zielposition kommt deshalb
 * aus `elementFromPoint`.
 */
export default function EmojiDefaultsSection() {
  const { t } = useTranslation();
  const stored = useSettingsStore((s) => s.settings.emojis.defaults);
  const update = useSettingsStore((s) => s.update);
  const current = stored ?? DEFAULT_EMOJI_PICKER_EMOJIS;

  // Während des Ziehens eine lokale Reihenfolge; geschrieben wird erst beim Loslassen.
  const [draft, setDraft] = useState<string[] | null>(null);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const drag = useRef<DragState | null>(null);
  const list = draft ?? current;

  const [query, setQuery] = useState('');
  const trimmedQuery = query.trim().toLowerCase();
  const searchData = useEmojiSearchData(trimmedQuery !== '');
  const results = trimmedQuery && searchData ? searchEmojis(searchData, trimmedQuery) : [];

  const save = (defaults: string[]) => update('emojis', { defaults });
  // Wie bei den Tabs der Seitenleiste bleibt eins stehen.
  const remove = (index: number) => { if (current.length > 1) save(current.filter((_, i) => i !== index)); };

  function onPointerDown(e: React.PointerEvent<HTMLButtonElement>, index: number) {
    if (e.button !== 0) return;
    // Ohne Capture geht es auch (die Nachbarn tragen dieselben Handler) — nur
    // ein synthetisches Ereignis lehnt es ab.
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
    // Ohne Bewegung ist `state.index` das Emoji, auf dem der Druck begann — nicht
    // unbedingt das unter dem Loslassen, falls die Capture ausblieb.
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
              // Das letzte bleibt (wie der letzte Tab der Seitenleiste) — als
              // sichtbar ausgegraut, statt auf den Klick nur nicht zu reagieren.
              disabled={list.length === 1}
              title={t('settings.emojiItemTitle')}
              aria-label={t('settings.emojiRemove', { emoji })}
              onPointerDown={(e) => onPointerDown(e, index)}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerCancel}
              // Tastatur: Enter/Leertaste entfernt wie ein Klick. Pointer-Klicks
              // erledigt `onPointerUp`; `detail === 0` heißt ausgelöst per Taste.
              onClick={(e) => { if (e.detail === 0) remove(index); }}
              className={`emoji-picker-item text-xl w-9 h-9 flex items-center justify-center rounded transition-colors touch-none disabled:opacity-50 disabled:cursor-default ${
                draggingIndex === index ? 'emoji-picker-item-active cursor-grabbing' : 'emoji-picker-item-idle cursor-grab'
              }`}
            >
              {emoji}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('common.searchEmoji')}
            className="emoji-picker-search flex-1 min-w-0 rounded px-2 py-1 text-xs outline-none"
          />
          {stored !== null && (
            <Button variant="secondary" onClick={() => update('emojis', { defaults: null })} className="shrink-0">
              <RotateCcw size={12} />
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
                    className={`emoji-picker-item text-xl w-9 h-9 flex items-center justify-center rounded transition-colors ${
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
