import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useUIStore } from '../../../store/uiStore';
import { Search } from 'lucide-react';
import SidebarSection, { SidebarEmpty, SidebarItemRow, SidebarRowRemove } from './SidebarSection';
import { useLinkItems } from '../../../hooks/useLinkItems';
import LinkedEntryPicker, { LinkItemIcon } from './LinkedEntryPicker';
import {
  requestEntryLinkAppend, requestEntryLinkRemove, requestEntryLinkReveal,
} from '../../../lib/links';
import { extractInternalLinks } from '../../../lib/internalLinkHtml';
import { viewTypeForEntryType } from '../../../lib/modules';
import { linkItemKey as itemKey, linkItemsByKey } from '../../../lib/linkItems';
import {
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
}

/**
 * So viele Vorschläge zeigt die Liste — alle fünf Module liegen in einem Topf:
 * bei wenigen Treffern bekäme man ohne Suchbegriff nur das erste Modul zu
 * sehen. Das Menü ist auf `max-h-40` begrenzt und scrollt.
 */
const RESULT_LIMIT = 50;

/** Auf/Zu der Verlinkungen — Lesen und Bearbeiten teilen es. */
const OPEN_KEY = 'entry-sidebar-links-open';

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

type LegacyIds = Props['legacyIds'];

const NO_ITEMS: SuggestionItem[] = [];
const NO_KEYS: string[] = [];

/**
 * Die Verlinkungen eines Eintrags, nach Kategorie sortiert: die Link-Chips
 * seines Inhalts, dazu die alten Spalten (`legacyIds`). `pending`/`removed`
 * überbrücken im Bearbeiten den Autosave (siehe `LinkedEntriesField`).
 */
function useLinkedEntries(
  content: string,
  legacyIds: LegacyIds,
  pending: SuggestionItem[] = NO_ITEMS,
  removed: string[] = NO_KEYS,
): Array<{ item: SuggestionItem; inContent: boolean }> {
  const items = useLinkItems();
  const byKey = useMemo(() => linkItemsByKey(items), [items]);
  return useMemo(() => {
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
}

/**
 * Ein Klick zeigt die Stelle im Eintrag, an der der Link steht. Nur wenn der
 * Editor ihn nicht findet — Links aus den alten Spalten (`legacyIds`) stehen
 * nirgends im Text — geht es zum verlinkten Eintrag selbst.
 */
function useRevealLink() {
  const setActiveView = useUIStore((s) => s.setActiveView);
  return (item: SuggestionItem) => {
    if (requestEntryLinkReveal(item)) return;
    setActiveView({ type: viewTypeForEntryType(item.entryType), id: item.id, mode: 'view' });
  };
}

/**
 * Die Verlinkungen in der Leseansicht: ein Abschnitt mit Zähler, je Link eine
 * Zeile — Icon, Titel, rechts die Kategorie (ohne Kategorie die Eintragsart).
 */
export function LinkedEntriesSection({ content, legacyIds }: { content: string; legacyIds?: LegacyIds }) {
  const { t } = useTranslation();
  const linked = useLinkedEntries(content, legacyIds);
  const reveal = useRevealLink();
  return (
    <SidebarSection storageKey={OPEN_KEY} label={t('properties.linkedEntries')} count={linked.length}>
      {linked.length === 0 && <SidebarEmpty>{t('properties.noLinkedEntries')}</SidebarEmpty>}
      {linked.map(({ item }) => (
        <SidebarItemRow
          key={itemKey(item)}
          icon={<LinkItemIcon item={item} />}
          label={item.label}
          meta={item.categoryLabel ?? t(ENTRY_TYPE_LABEL_KEYS[item.entryType])}
          onClick={() => reveal(item)}
        />
      ))}
    </SidebarSection>
  );
}

/**
 * Was der Eintrag verlinkt — gelesen aus den internen Link-Chips seines
 * Inhalts, nicht aus eigenen Spalten. Damit zeigt das Feld auch die Links, die
 * im Fließtext über `[[` oder den Link-Picker entstanden sind, und eine
 * Auswahl hier landet umgekehrt als Chip unten im Eintrag. Die Bearbeiten-
 * Variante von `LinkedEntriesSection`: dieselben Zeilen, dazu je ein „×" und
 * darunter das Suchfeld.
 *
 * Eine Verlinkung lässt sich hier auch wieder entfernen. Nur die aus
 * dem Inhalt — die aus den alten Spalten (`legacyIds`) stehen nirgends im Text
 * und haben deshalb kein „×".
 */
export default function LinkedEntriesField({ content, legacyIds }: Props) {
  const { t } = useTranslation();
  const items = useLinkItems();
  const [query, setQuery] = useState('');

  // Der Store-Inhalt hinkt dem Editor um den Autosave-Debounce hinterher — das
  // gilt für hier angehängte Links ebenso wie für die, die im Text über `[[`
  // entstehen. Nur die eigenen kann das Feld überbrücken: sie leben so lange
  // hier und fallen wieder heraus, sobald der gespeicherte Inhalt sie mitbringt.
  const [pending, setPending] = useState<SuggestionItem[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  useEffect(() => { setPending([]); setRemoved([]); }, [content]);

  const linked = useLinkedEntries(content, legacyIds, pending, removed);

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

  const reveal = useRevealLink();

  const add = (item: SuggestionItem) => {
    // Nur als eingefügt vormerken, wenn ein Editor die Bitte quittiert hat —
    // sonst stünde hier eine Zeile für einen Link, den es im Eintrag nicht gibt.
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

  return (
    <SidebarSection storageKey={OPEN_KEY} label={t('properties.linkedEntries')} count={linked.length}>
      {linked.length === 0 && <SidebarEmpty>{t('properties.noLinkedEntries')}</SidebarEmpty>}
      {linked.map(({ item, inContent }) => (
        <SidebarItemRow
          key={itemKey(item)}
          icon={<LinkItemIcon item={item} />}
          label={item.label}
          meta={item.categoryLabel ?? t(ENTRY_TYPE_LABEL_KEYS[item.entryType])}
          title={item.label}
          onClick={() => reveal(item)}
          // Nur was im Inhalt steht, lässt sich von hier entfernen.
          action={<SidebarRowRemove title={t('properties.removeLink')} onClick={inContent ? () => remove(item) : undefined} />}
        />
      ))}
      <div className="mt-1 pl-[9px] pr-3">
        <LinkedEntryPicker
          results={filtered}
          resultKey={itemKey}
          onSelect={add}
          query={query}
          onQueryChange={setQuery}
          placeholder={t('properties.linkEntry')}
          fieldIcon={<Search size={14} />}
          renderResult={(item) => {
            const TypeIcon = ENTRY_TYPE_ICONS[item.entryType];
            return (
              <>
                <LinkItemIcon item={item} />
                <span className="flex-1 truncate">{item.label}</span>
                <TypeIcon size={12} className="text-stone-600 flex-shrink-0" />
                <span className="text-stone-600 flex-shrink-0">{t(ENTRY_TYPE_LABEL_KEYS[item.entryType])}</span>
              </>
            );
          }}
        />
      </div>
    </SidebarSection>
  );
}
