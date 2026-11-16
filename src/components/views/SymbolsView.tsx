import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pencil, Trash2 } from 'lucide-react';
import { useSymbolStore } from '../../store/symbolStore';
import { removeSymbolWithUndo } from '../../store/symbolActions';
import { AUX_VIEWS } from '../../lib/modules';
import { formatEntryDate } from '../../lib/formatDate';
import type { UserSymbol } from '../../lib/userSymbols';
import { SymbolGlyph } from '../editors/canvas/symbols/SymbolPicker';
import SymbolEditModal from '../symbols/SymbolEditModal';
import CollectionDashboard, { useCollectionState } from './CollectionDashboard';

/**
 * "Symbols", the collection of the vault's own symbols for the canvas editor:
 * each drawn as it looks, with its name. A click opens it large to rename
 * (`SymbolEditModal`); deleting takes it out at once, with undo — symbols
 * have no trash. New ones are made from a drawing on a canvas ("Save as
 * symbol"), so this view has no "New".
 */
export default function SymbolsView() {
  const { t } = useTranslation();
  const symbols = useSymbolStore((s) => s.symbols);
  const state = useCollectionState('symbols');
  const [editing, setEditing] = useState<UserSymbol | null>(null);

  const nameOf = (symbol: UserSymbol) => symbol.name || t('symbols.ownDefault');

  const remove = (symbol: UserSymbol) => removeSymbolWithUndo(symbol.id, t);

  return (
    <>
      <CollectionDashboard<UserSymbol>
        state={state}
        title={t('nav.symbols')}
        items={symbols}
        itemKey={(symbol) => symbol.id}
        itemTitle={nameOf}
        itemDate={(symbol) => symbol.created_at}
        dateField="created"
        // The glyph is a preview of the drawing, not an icon: it gets the room
        // a row and a card have for their symbol, not the icon scale.
        describe={(symbol) => ({
          icon: <span className="text-soft flex"><SymbolGlyph d={symbol.d} solid={symbol.solid || undefined} weight={symbol.weight} fit size={20} /></span>,
          cardIcon: <span className="text-soft flex"><SymbolGlyph d={symbol.d} solid={symbol.solid || undefined} weight={symbol.weight} fit size={28} /></span>,
          title: symbol.name ? symbol.name : <span className="italic text-subtle">{nameOf(symbol)}</span>,
          meta: formatEntryDate(symbol.created_at),
          onOpen: () => setEditing(symbol),
        })}
        contextActions={(symbol) => [
          { label: t('editor.edit'), icon: <Pencil size={12} />, onClick: () => setEditing(symbol) },
          { label: t('contextMenu.delete'), icon: <Trash2 size={12} />, danger: true, onClick: () => remove(symbol) },
        ]}
        emptyState={{
          icon: AUX_VIEWS.symbols.icon,
          title: t('emptyState.symbols.title'),
          description: t('emptyState.symbols.description'),
        }}
      />
      {editing && (
        <SymbolEditModal key={editing.id} symbol={editing} onClose={() => setEditing(null)} onDelete={remove} />
      )}
    </>
  );
}
