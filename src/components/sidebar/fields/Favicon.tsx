import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ImagePlus, PenLine, Smile, X } from 'lucide-react';
import { ACCEPTED_IMAGE_MIME, isImageIcon } from '../../../lib/helpers';
import { iconSrc } from '../../../lib/icons';
import EmojiPicker from '../../ui/EmojiPicker';
import DashboardSymbolPicker from '../../ui/DashboardSymbolPicker';
import { dashboardSymbol, isSymbolIconValue } from '../../../lib/dashboardSymbols';
import { readIconFile } from '../../../lib/imageLimits';
import { reportImageError } from '../../../store/imageNoticeStore';
import Button from '../../ui/Button';
import IconCropDialog from './IconCropDialog';

/**
 * Just the glyph, without selection. Default 20px, the size of a
 * row meta entry; `className` replaces the size where the icon should be
 * larger.
 *
 * The one renderer for every kind of icon value: an image, an emoji or a
 * dashboard's line symbol (`lib/dashboardSymbols.ts`; `isSymbolIconValue` is
 * the shared test). A `symbol:` value naming no known symbol draws nothing.
 */
export function FaviconGlyph({ value, className = 'w-5 h-5 text-base' }: {
  value?: string | null;
  className?: string;
}) {
  if (!value) return null;
  // A line symbol (only dashboards have them) is drawn in the text colour, like the rail's glyphs.
  const SymbolIcon = dashboardSymbol(value);
  if (SymbolIcon) return <SymbolIcon className={`${className} flex-shrink-0`} />;
  if (isSymbolIconValue(value)) return null;
  return isImageIcon(value) ? (
    <img src={iconSrc(value)} alt="" className={`${className} object-contain rounded-md border border-edge flex-shrink-0`} />
  ) : (
    <span className={`${className} leading-none flex items-center justify-center flex-shrink-0`}>{value}</span>
  );
}

interface FaviconProps {
  value?: string | null;
  onChange?: (value: string) => void;
  onRemove?: () => void;
  /** Offer the line symbols of `DASHBOARD_SYMBOLS` as the first choice — the dashboards only. */
  symbols?: boolean;
}

/**
 * The icon field: glyph plus the actions (choose symbol where `symbols` is
 * set, choose image, choose emoji, remove) in one row.
 *
 * Returns only this row, without a label; the callers bring that
 * themselves (the dashboard settings). The edit sidebar of entries and
 * library pages uses `MediaPropertyRow` instead. For editing only; reading
 * goes through `FaviconGlyph`.
 *
 * The actions are tone-coded `Button`s in the dense 24px size, as the
 * category headers use them. Labelled with just the keyword;
 * the spelled-out form is in the `title`.
 */
export default function Favicon({ value, onChange, onRemove, symbols = false }: FaviconProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const pickFile = () => inputRef.current?.click();
  // A chosen picture waits here until it is cut to a square or the cut is cancelled.
  const [cropping, setCropping] = useState<string | null>(null);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const icon = await readIconFile(file);
      if (icon) setCropping(icon);
    } catch (err) {
      // Better to set nothing at all than an empty icon: an aborted read
      // has no result, and the previous value is better than none.
      reportImageError(err, 'icon');
    }
  };

  return (
    <>
      <input ref={inputRef} type="file" accept={ACCEPTED_IMAGE_MIME} className="hidden" onChange={handleUpload} />
      {/* Each picker wraps only its own button, so that a click on the other
          one is outside it and closes it — never two popovers at once. The
          row wraps rather than running out of the sidebar in a long language. */}
      <div className="flex flex-wrap items-center gap-1.5 min-w-0">
        {value && <FaviconGlyph value={value} />}
        {symbols && (
          <DashboardSymbolPicker
            value={value ?? ''}
            onChange={(symbol) => onChange?.(symbol)}
            trigger={({ toggle }) => (
              <Button tone="neutral" small title={t('properties.chooseSymbol')} onClick={toggle}>
                <PenLine size={12} /> {t('properties.symbol')}
              </Button>
            )}
          />
        )}
        <Button tone="neutral" small title={value ? t('properties.changeIcon') : t('properties.addIcon')} onClick={pickFile}>
          <ImagePlus size={12} /> {value ? t('properties.change') : t('properties.icon')}
        </Button>
        <EmojiPicker
          value={value ?? ''}
          onChange={(emoji) => onChange?.(emoji)}
          trigger={({ toggle }) => (
            <Button tone="neutral" small title={t('properties.chooseEmoji')} onClick={toggle}>
              <Smile size={12} /> {t('properties.emoji')}
            </Button>
          )}
        />
        {/* Remove as an icon only: with a label the row would run out of the
            sidebar, and the X is unambiguous enough for a destructive
            row action. */}
        {value && (
          <Button tone="danger" small compact title={t('properties.removeIcon')} aria-label={t('properties.removeIcon')} onClick={() => onRemove?.()}>
            <X size={12} />
          </Button>
        )}
      </div>
      {cropping && (
        <IconCropDialog
          key={cropping}
          src={cropping}
          onApply={(icon) => { setCropping(null); onChange?.(icon); }}
          onCancel={() => setCropping(null)}
        />
      )}
    </>
  );
}
