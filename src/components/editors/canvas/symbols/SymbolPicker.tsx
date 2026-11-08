import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Search } from 'lucide-react';
import { SYMBOL_PACKS, type SymbolDef } from './packs';

/** The pack shown last, for the next time the library opens. */
let lastPack = SYMBOL_PACKS[0].id;

/** A symbol's translated name, from its id `pack.name`. */
export function symbolName(id: string, t: (key: string) => string): string {
  return t(`symbols.${id}`);
}

/** A symbol drawn small, in the current text colour. */
export function SymbolGlyph({ d, size = 28 }: { d: string; size?: number }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden>
      <path d={d} fill="none" stroke="currentColor" strokeWidth={6} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * The symbol library: the packs as tabs, a search over every pack by name,
 * and the symbols in a grid. A click picks one.
 */
export default function SymbolPicker({ onPick, current }: { onPick: (symbol: SymbolDef) => void; current?: string }) {
  const { t } = useTranslation();
  const [pack, setPack] = useState(lastPack);
  const [query, setQuery] = useState('');
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return SYMBOL_PACKS.find((p) => p.id === pack)?.symbols ?? [];
    return SYMBOL_PACKS.flatMap((p) => p.symbols).filter((s) => symbolName(s.id, t).toLowerCase().includes(q) || s.id.toLowerCase().includes(q));
  }, [pack, query, t]);

  return (
    <div className="canvas-symbols">
      <label className="canvas-symbols-search">
        <Search size={13} />
        <input
          type="search"
          value={query}
          placeholder={t('symbols.search')}
          onChange={(e) => setQuery(e.target.value)}
          // The canvas editor's letters pick tools; typing here must not.
          onKeyDown={(e) => e.stopPropagation()}
          autoFocus
        />
      </label>
      {!query.trim() && (
        <div className="canvas-symbols-packs" role="tablist">
          {SYMBOL_PACKS.map((p) => (
            <button
              key={p.id}
              type="button"
              role="tab"
              aria-selected={pack === p.id}
              className={`canvas-symbols-pack${pack === p.id ? ' canvas-symbols-pack--active' : ''}`}
              onClick={() => { setPack(p.id); lastPack = p.id; }}
            >
              {t(`symbols.packs.${p.id}`)}
            </button>
          ))}
        </div>
      )}
      <div className="canvas-symbols-grid">
        {shown.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`canvas-symbols-item${current === s.id ? ' canvas-symbols-item--active' : ''}`}
            title={symbolName(s.id, t)}
            onClick={() => onPick(s)}
          >
            <SymbolGlyph d={s.d} />
          </button>
        ))}
        {!shown.length && <p className="canvas-symbols-empty">{t('symbols.none')}</p>}
      </div>
    </div>
  );
}
