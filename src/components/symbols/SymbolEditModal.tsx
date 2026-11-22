import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Modal from '../ui/Modal';
import EditDialogFooter from '../ui/EditDialogFooter';
import { SymbolGlyph } from '../editors/canvas/symbols/SymbolPicker';
import { OP_PROP_SELECT_CLASSES } from '../../lib/styleClasses';
import { useSymbolStore } from '../../store/symbolStore';
import { SYMBOL_NAME_MAX, type UserSymbol } from '../../lib/userSymbols';


/**
 * One of the vault's own symbols, large, with its name to change. The drawing
 * itself is not edited here — a symbol is made from a drawing on a canvas.
 * Deleting hands back to the caller, which removes it with undo.
 */
export default function SymbolEditModal({ symbol, onClose, onDelete }: {
  symbol: UserSymbol;
  onClose: () => void;
  onDelete: (symbol: UserSymbol) => void;
}) {
  const { t } = useTranslation();
  const renameSymbol = useSymbolStore((s) => s.renameSymbol);
  const [name, setName] = useState(symbol.name);

  const save = async () => {
    if (name.trim() !== symbol.name) {
      try {
        await renameSymbol(symbol.id, name);
      } catch (err) {
        console.error('[SymbolEditModal] renaming the symbol failed:', err);
        return;
      }
    }
    onClose();
  };

  return (
    <Modal
      title={t('symbols.editTitle')}
      onClose={onClose}
      widthClassName="w-full max-w-sm"
      bodyClassName="modal-body space-y-4"
      footer={(
        <EditDialogFooter onDelete={() => { onClose(); onDelete(symbol); }} onCancel={onClose} onSave={() => void save()} />
      )}
    >
      <div className="panel rounded-xl flex items-center justify-center py-6 text-soft">
        <SymbolGlyph d={symbol.d} solid={symbol.solid || undefined} weight={symbol.weight} fit size={120} />
      </div>
      <div>
        <p className="label-xs mb-2">{t('symbols.namePlaceholder')}</p>
        <input
          autoFocus
          value={name}
          maxLength={SYMBOL_NAME_MAX}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void save(); } }}
          placeholder={t('symbols.ownDefault')}
          aria-label={t('symbols.namePlaceholder')}
          className={`${OP_PROP_SELECT_CLASSES} selectable w-full`}
        />
      </div>
    </Modal>
  );
}
