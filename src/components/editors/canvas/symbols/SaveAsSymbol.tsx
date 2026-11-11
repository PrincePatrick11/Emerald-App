import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BookmarkPlus } from 'lucide-react';
import PopoverButton from '../../shared/PopoverButton';
import Button from '../../../ui/Button';
import { ToolbarGroup } from '../../shared/toolbarParts';
import type { CanvasElement } from '../types';
import type { DrawingProps } from '../paint/drawing';
import type { PaintDoc } from '../../../../lib/paint/document';
import { useSymbolLibrary, type CanvasSymbolLibrary } from './library';
import { symbolFromDrawing } from './fromDrawing';
import { SymbolGlyph } from './SymbolPicker';

/** The panel: the drawing as a symbol, a name, and saving it. Converted only while open. */
function SaveForm({ doc, library, close }: { doc: PaintDoc; library: CanvasSymbolLibrary; close: () => void }) {
  const { t } = useTranslation();
  const symbol = useMemo(() => symbolFromDrawing(doc), [doc]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  if (!symbol) return <p className="canvas-panel canvas-export-hint">{t('symbols.emptyDrawing')}</p>;
  return (
    <form
      className="canvas-panel canvas-save-symbol"
      onSubmit={(e) => {
        e.preventDefault();
        if (busy) return;
        setBusy(true);
        library.save({ ...symbol, name: name.trim() || t('symbols.ownDefault') })
          .then(close)
          .catch(console.error)
          .finally(() => setBusy(false));
      }}
    >
      <div className="canvas-save-symbol-preview"><SymbolGlyph d={symbol.d} solid={symbol.solid} weight={symbol.weight} size={72} /></div>
      <input
        className="canvas-save-symbol-name"
        value={name}
        placeholder={t('symbols.namePlaceholder')}
        onChange={(e) => setName(e.target.value)}
        // The canvas editor's letters pick tools; typing here must not.
        onKeyDown={(e) => e.stopPropagation()}
        maxLength={80}
        autoFocus
      />
      <p className="canvas-export-hint">{t('symbols.saveHint')}</p>
      <Button type="submit" tone="neutral" small disabled={busy}>{t('symbols.save')}</Button>
    </form>
  );
}

/**
 * The bar's control for one selected drawing, where the place keeps its own
 * symbols: the drawing as a symbol, a name, and saving it into the
 * library's pack `own`.
 */
export default function SaveAsSymbol({ elements }: { elements: CanvasElement<DrawingProps>[] }) {
  const { t } = useTranslation();
  const library = useSymbolLibrary();
  if (!library || elements.length !== 1) return null;
  return (
    <ToolbarGroup>
      <PopoverButton icon={<BookmarkPlus size={14} />} title={t('symbols.saveAs')} active={false}>
        {(close) => <SaveForm doc={elements[0].props.doc} library={library} close={close} />}
      </PopoverButton>
    </ToolbarGroup>
  );
}
