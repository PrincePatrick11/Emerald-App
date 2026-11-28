import { useTranslation } from 'react-i18next';
import { DASHBOARD_SYMBOLS, DASHBOARD_SYMBOL_NAMES, symbolIconValue, type DashboardSymbolName } from '../../lib/dashboardSymbols';
import GlyphPicker, { type GlyphPickerProps } from './GlyphPicker';

interface DashboardSymbolPickerProps extends Pick<GlyphPickerProps, 'trigger' | 'align' | 'wrapperClassName'> {
  /** The current icon value — a symbol in it is marked. */
  value: string;
  /** Receives the icon value of the chosen symbol (`symbolIconValue`). */
  onChange: (value: string) => void;
}

/**
 * The line symbols of `DASHBOARD_SYMBOLS` as a popover, the `EmojiPicker`'s
 * twin: the same chrome, a search over each symbol's name in the app's
 * language, its English name and its lucide name. Drawn at the rail's 18px.
 * Not the canvas's symbol library (`editors/canvas/symbols/SymbolPicker`).
 */
export default function DashboardSymbolPicker({ value, onChange, ...rest }: DashboardSymbolPickerProps) {
  const { t, i18n } = useTranslation();
  // English is bundled with the app, so its names are always there to search.
  const english = i18n.getFixedT('en');
  const label = (name: DashboardSymbolName) => t(`dashboardSymbols.${name}`);
  const matches = (name: DashboardSymbolName, query: string) =>
    !query
    || [label(name), english(`dashboardSymbols.${name}`), name, name.replace(/-/g, ' ')].some((text) => text.toLowerCase().includes(query));

  return (
    <GlyphPicker
      {...rest}
      size="lg"
      searchPlaceholder={t('common.searchSymbol')}
      emptyText={t('common.noEmojiResults')}
      cells={(query) => DASHBOARD_SYMBOL_NAMES.filter((name) => matches(name, query)).map((name) => {
        const Icon = DASHBOARD_SYMBOLS[name];
        const icon = symbolIconValue(name);
        return { key: name, label: label(name), active: value === icon, onPick: () => onChange(icon), content: <Icon size={18} /> };
      })}
    />
  );
}
