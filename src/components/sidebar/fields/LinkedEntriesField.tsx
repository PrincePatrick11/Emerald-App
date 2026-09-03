import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useUIStore } from '../../../store/uiStore';
import { useLinkItems } from '../../../hooks/useLinkItems';
import LinkedEntryPicker, { LINK_RESULT_LIMIT, LinkedEntryChip } from './LinkedEntryPicker';
import {
  requestEntryLinkAppend, requestEntryLinkRemove, requestEntryLinkReveal,
} from '../../../lib/links';
import { extractInternalLinks } from '../../../lib/internalLinkHtml';
import { viewTypeForEntryType } from '../../../lib/modules';
import { linkItemKey as itemKey, linkItemsByKey } from '../../../lib/linkItems';
import { isImageIcon } from '../../../lib/helpers';
import {
  DEFAULT_ENTRY_EMOJI,
  ENTRY_TYPE_ICONS,
  ENTRY_TYPE_LABEL_KEYS,
  type SuggestionItem,
} from '../../editor/SuggestionList';

interface Props {
  /** Der gespeicherte HTML-Inhalt des Eintrags — die Quelle der Liste. */
  content: string;
  /**
   * Übergangsbrücke für Journal-Einträge aus der Zeit der Spalten
   * `linked_operation_ids`/`linked_wiki_ids`: deren Verknüpfungen stehen nicht
   * im Inhalt und wären ohne das hier von einem Tag auf den anderen unsichtbar.
   * Sie werden nur gelistet — angelegt wird ab jetzt ausschließlich im Inhalt.
   */
  legacyIds?: Array<{ id: string; entryType: 'operation' | 'wiki' }>;
  /** Edit-Modus: zusätzlich die Suchzeile zum Anhängen. */
  editable?: boolean;
  /** Klassen der Suchzeile (OP_PROP_SELECT_CLASSES der Panels). */
  inputCls?: string;
}

function ItemIcon({ item }: { item: SuggestionItem }) {
  const icon = item.displayIcon || item.icon || DEFAULT_ENTRY_EMOJI[item.entryType];
  return isImageIcon(icon)
    ? <img src={icon} alt="" className="w-4 h-4 object-cover rounded flex-shrink-0" />
    : <span className="flex-shrink-0">{icon}</span>;
}

/**
 * Was der Eintrag verlinkt — gelesen aus den internen Link-Chips seines
 * Inhalts, nicht aus eigenen Spalten. Damit zeigt das Feld auch die Links, die
 * im Fließtext über `[[` oder den Link-Picker entstanden sind, und eine
 * Auswahl hier landet umgekehrt als Chip unten im Eintrag.
 *
 * Im Edit-Modus lässt sich eine Verlinkung auch wieder entfernen. Nur die aus
 * dem Inhalt — die aus den alten Spalten (`legacyIds`) stehen nirgends im Text
 * und haben deshalb kein „×".
 */
export default function LinkedEntriesField({ content, legacyIds, editable = false, inputCls }: Props) {
  const { t } = useTranslation();
  const setActiveView = useUIStore((s) => s.setActiveView);
  const items = useLinkItems();
  const [query, setQuery] = useState('');

  // Der Store-Inhalt hinkt dem Editor um den Autosave-Debounce hinterher — das
  // gilt für hier angehängte Links ebenso wie für die, die im Text über `[[`
  // entstehen. Nur die eigenen kann das Feld überbrücken: sie leben so lange
  // hier und fallen wieder heraus, sobald der gespeicherte Inhalt sie mitbringt.
  const [pending, setPending] = useState<SuggestionItem[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  useEffect(() => { setPending([]); setRemoved([]); }, [content]);

  const byKey = useMemo(() => linkItemsByKey(items), [items]);

  const linked = useMemo(() => {
    const gone = new Set(removed);
    const seen = new Set<string>();
    const out: Array<{ item: SuggestionItem; inContent: boolean }> = [];
    const sources = [
      ...extractInternalLinks(content).map((l) => ({ link: l, inContent: true })),
      ...pending.map((l) => ({ link: l, inContent: true })),
      ...(legacyIds ?? []).map((l) => ({ link: l, inContent: false })),
    ];
    for (const { link, inContent } of sources) {
      const key = itemKey(link);
      if (seen.has(key) || gone.has(key)) continue;
      // Ziel gelöscht oder unbekannt: der Chip im Text zeigt dann seinen
      // gespeicherten Label-Text, hier bleibt die Zeile lieber leer.
      const item = byKey.get(key);
      if (!item) continue;
      seen.add(key);
      out.push({ item, inContent });
    }
    return out;
  }, [content, legacyIds, pending, removed, byKey]);

  const filtered = useMemo(() => {
    const linkedKeys = new Set(linked.map((l) => itemKey(l.item)));
    const q = query.toLowerCase();
    return items
      .filter((i) => !linkedKeys.has(itemKey(i)) && i.label.toLowerCase().includes(q))
      .slice(0, LINK_RESULT_LIMIT);
  }, [items, linked, query]);

  /**
   * Ein Klick zeigt die Stelle im Eintrag, an der der Link steht. Nur wenn der
   * Editor ihn nicht findet — Links aus den alten Spalten (`legacyIds`) stehen
   * nirgends im Text — geht es zum verlinkten Eintrag selbst.
   */
  const reveal = (item: SuggestionItem) => {
    if (requestEntryLinkReveal(item)) return;
    setActiveView({ type: viewTypeForEntryType(item.entryType), id: item.id, mode: 'view' });
  };

  const add = (item: SuggestionItem) => {
    // Nur als eingefügt vormerken, wenn ein Editor die Bitte quittiert hat —
    // sonst stünde hier ein Chip für einen Link, den es im Eintrag nicht gibt.
    if (requestEntryLinkAppend(item)) {
      setPending((prev) => [...prev, item]);
      setRemoved((prev) => prev.filter((k) => k !== itemKey(item)));
    }
  };

  const remove = (item: SuggestionItem) => {
    if (!requestEntryLinkRemove(item)) return;
    setPending((prev) => prev.filter((p) => itemKey(p) !== itemKey(item)));
    setRemoved((prev) => [...prev, itemKey(item)]);
  };

  const chips = linked.map(({ item, inContent }) => (
    <LinkedEntryChip
      key={itemKey(item)}
      icon={<ItemIcon item={item} />}
      label={item.label}
      labelMaxWidth="max-w-[140px]"
      onClick={() => reveal(item)}
      // Nur was im Inhalt steht, lässt sich von hier entfernen.
      onRemove={editable && inContent ? () => remove(item) : undefined}
      removeTitle={t('properties.removeLink')}
    />
  ));

  if (!editable) {
    return (
      <div className="space-y-1.5">
        {chips.length > 0
          ? <div className="flex flex-wrap gap-1">{chips}</div>
          : <p className="text-xs text-stone-600">{t('properties.noLinkedEntries')}</p>}
      </div>
    );
  }

  return (
    <LinkedEntryPicker
      chips={chips.length > 0 ? chips : undefined}
      results={filtered}
      resultKey={itemKey}
      onSelect={add}
      query={query}
      onQueryChange={setQuery}
      placeholder={t('linkPicker.searchPlaceholder')}
      inputCls={inputCls}
      renderResult={(item) => {
        const TypeIcon = ENTRY_TYPE_ICONS[item.entryType];
        return (
          <>
            <ItemIcon item={item} />
            <span className="flex-1 truncate">{item.label}</span>
            <TypeIcon size={12} className="text-stone-600 flex-shrink-0" />
            <span className="text-stone-600 flex-shrink-0">{t(ENTRY_TYPE_LABEL_KEYS[item.entryType])}</span>
          </>
        );
      }}
    />
  );
}
