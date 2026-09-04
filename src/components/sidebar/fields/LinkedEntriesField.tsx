import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useUIStore } from '../../../store/uiStore';
import { useLinkItems } from '../../../hooks/useLinkItems';
import LinkedEntryPicker, { LinkedEntryChip } from './LinkedEntryPicker';
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

/**
 * So viele Vorschläge zeigt die Liste. Deutlich mehr als bei den beiden
 * ID-Feldern (`LINK_RESULT_LIMIT`), weil hier alle fünf Module in einem Topf
 * liegen: bei acht Treffern bekäme man ohne Suchbegriff nur das erste Modul zu
 * sehen. Das Menü ist auf `max-h-40` begrenzt und scrollt.
 */
const RESULT_LIMIT = 50;

/** Zuletzt bearbeitet zuerst — ohne Zeitstempel ans Ende. */
function byRecency(a: SuggestionItem, b: SuggestionItem): number {
  return (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '');
}

/** Nach Kategorie, darin nach Titel. Einträge ohne Kategorie kommen zuletzt. */
function byCategory(a: SuggestionItem, b: SuggestionItem): number {
  const ca = a.categoryLabel ?? '';
  const cb = b.categoryLabel ?? '';
  // Erst die Frage „hat überhaupt eine Kategorie?" — ein Platzhalterzeichen am
  // Ende des Alphabets wäre kürzer, aber die Kollation darf es ignorieren.
  if (!ca !== !cb) return ca ? -1 : 1;
  return ca.localeCompare(cb) || a.label.localeCompare(b.label);
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
    // Nach Kategorie sortiert, nicht in der Reihenfolge des Textes: gleichartige
    // Verlinkungen stehen so beieinander, unabhängig davon, wann sie in den
    // Eintrag geraten sind.
    return out.sort((a, b) => byCategory(a.item, b.item));
  }, [content, legacyIds, pending, removed, byKey]);

  const filtered = useMemo(() => {
    const linkedKeys = new Set(linked.map((l) => itemKey(l.item)));
    const q = query.toLowerCase();
    return items
      .filter((i) => !linkedKeys.has(itemKey(i)) && i.label.toLowerCase().includes(q))
      // Zuletzt bearbeitet zuerst — sonst entschiede die Modul-Reihenfolge aus
      // `buildLinkItems`, und ohne Suchbegriff stünde nur Journal in der Liste.
      .sort(byRecency)
      .slice(0, RESULT_LIMIT);
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

  // `linked` ist bereits nach Kategorie sortiert — gleiche Kategorien stehen
  // also beieinander, und ein Durchlauf reicht, um sie zu Gruppen zu bündeln.
  const groups: Array<{ label: string; entries: typeof linked }> = [];
  for (const entry of linked) {
    const label = entry.item.categoryLabel ?? '';
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.entries.push(entry);
    else groups.push({ label, entries: [entry] });
  }

  const chips = groups.length === 0 ? undefined : (
    <div className="space-y-2">
      {groups.map((group) => (
        <div key={group.label} className="space-y-1">
          {/* Ohne Kategorie keine Überschrift — die Gruppe steht am Ende.
              Bewusst nicht `PropertySummarySectionTitle`: das ist der Titel
              einer Abschnittsgruppe im Panel und läge damit über der
              Feldbeschriftung, unter der diese Überschrift steht. Sie muss eine
              Stufe leiser sein als `label-xs` — dieselbe Kombination benutzt
              `PlacedElementRow` für seine Unterbeschriftungen. */}
          {group.label && (
            <p className="text-[10px] uppercase tracking-wider text-stone-500">{group.label}</p>
          )}
          <div className="flex flex-wrap gap-1">
            {group.entries.map(({ item, inContent }) => (
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
            ))}
          </div>
        </div>
      ))}
    </div>
  );

  if (!editable) {
    return (
      <div className="space-y-1.5">
        {chips ?? <p className="text-xs text-stone-600">{t('properties.noLinkedEntries')}</p>}
      </div>
    );
  }

  return (
    <LinkedEntryPicker
      chips={chips}
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
