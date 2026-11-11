import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, Trash2 } from 'lucide-react';
import { SYMBOL_PACKS, type SymbolDef } from './packs';
import { OWN_PACK, useSymbolLibrary } from './library';

/** The pack shown last, for the next time the library opens. */
let lastPack = SYMBOL_PACKS[0].id;

/** A symbol's name: its own, or the translation of its id `pack.name`. */
export function symbolName(id: string, t: (key: string) => string, own?: string): string {
  return own ?? t(`symbols.${id}`);
}

/** A symbol drawn small, in the current text colour. */
export function SymbolGlyph({ d, solid, weight = 5, size = 28 }: { d: string; solid?: string; weight?: number; size?: number }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden>
      {solid && <path d={solid} fill="currentColor" />}
      <path d={d} fill="none" stroke="currentColor" strokeWidth={Math.max(2.5, weight * 1.2)} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * The symbol library: the packs as tabs, a search over every pack by name,
 * and the symbols in a grid. A click picks one.
 */
export default function SymbolPicker({ onPick, current }: { onPick: (symbol: SymbolDef) => void; current?: string }) {
  const { t } = useTranslation();
  const library = useSymbolLibrary();
  const packs = useMemo(
    () => (library ? [{ id: OWN_PACK, symbols: library.own }, ...SYMBOL_PACKS] : SYMBOL_PACKS),
    [library],
  );
  const [pack, setPack] = useState(() => (packs.some((p) => p.id === lastPack) ? lastPack : SYMBOL_PACKS[0].id));
  const [query, setQuery] = useState('');
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return packs.find((p) => p.id === pack)?.symbols ?? [];
    return packs.flatMap((p) => p.symbols).filter((s) => symbolName(s.id, t, s.name).toLowerCase().includes(q) || s.id.toLowerCase().includes(q));
  }, [packs, pack, query, t]);

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
          {packs.map((p) => (
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
          <div key={s.id} className="canvas-symbols-cell">
            <button
              type="button"
              className={`canvas-symbols-item${current === s.id ? ' canvas-symbols-item--active' : ''}`}
              title={symbolName(s.id, t, s.name)}
              onClick={() => onPick(s)}
            >
              <SymbolGlyph d={s.d} solid={s.solid} weight={s.weight} />
            </button>
            {library && s.id.startsWith(`${OWN_PACK}.`) && (
              <button
                type="button"
                className="canvas-symbols-remove"
                title={t('symbols.remove')}
                onClick={() => library.remove(s.id.slice(OWN_PACK.length + 1))}
              >
                <Trash2 size={10} />
              </button>
            )}
          </div>
        ))}
        {!shown.length && (
          <p className="canvas-symbols-empty">{t(!query.trim() && pack === OWN_PACK ? 'symbols.ownEmpty' : 'symbols.none')}</p>
        )}
      </div>
    </div>
  );
}
