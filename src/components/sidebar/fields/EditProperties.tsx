import { useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ImagePlus, Plus, Smile, X } from 'lucide-react';
import Dropdown, { type DropdownOption } from '../../ui/Dropdown';
import ContextMenu, { type ContextMenuAction } from '../../ui/ContextMenu';
import EmojiPicker from '../../ui/EmojiPicker';
import { ACCEPTED_IMAGE_MIME, isAcceptedImageFile, isImageIcon, readFileAsDataUrl } from '../../../lib/helpers';
import { ImageTooLargeError, imageSizeLabel, prepareImageDataUrl, readIconFile } from '../../../lib/imageLimits';
import { reportImageError } from '../../../store/imageNoticeStore';
import { RowIcon } from './SidebarSection';

/**
 * The building blocks of the edit sidebar, the counterpart to
 * `SidebarPropertyRow` of the read view. The same row (icon, name, value on the
 * right, indented the same), except that here the value is a control: a
 * value button with a menu, a medium with a preview, or the type segments.
 *
 * The body around it is `EditSidebarBody`; the sections are the same
 * `SidebarSection`s as when reading, including their remembered open/closed state.
 */

/** The body of the edit sidebar of a library page; spacing as in `RightSidebar` when reading. */
export function EditSidebarBody({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-5">{children}</div>;
}

/**
 * A property when editing: icon and name on the left (never truncated), the
 * control on the right. 36px tall so that a 28px value button has room.
 */
export function EditPropertyRow({ icon, label, children }: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-1.5 h-9 pl-[9px] pr-3 text-[13px] min-w-0">
      <RowIcon>{icon}</RowIcon>
      <span className="sidebar-prop-label flex-none whitespace-nowrap">{label}</span>
      <div className="ml-auto min-w-0 flex justify-end pl-2">{children}</div>
    </div>
  );
}

/**
 * The value of a choice property (category): value button with
 * chevron, the menu portalled and right-aligned. `muted` for "None".
 */
export function PropertySelect<T extends string>({ value, options, onChange, text, muted = false, ariaLabel }: {
  value: T;
  options: DropdownOption<T>[];
  onChange: (value: T) => void;
  /** What the button shows, usually the emoji and name of the chosen option. */
  text: string;
  muted?: boolean;
  ariaLabel: string;
}) {
  return (
    <Dropdown
      value={value}
      options={options}
      onChange={onChange}
      align="right"
      portal
      trigger={({ open, toggle }) => (
        <button
          type="button"
          onClick={toggle}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={`${ariaLabel}: ${text}`}
          title={text}
          className={`prop-value-btn${muted ? ' prop-value-btn--muted' : ''}`}
        >
          <span className="min-w-0 truncate">{text}</span>
          <ChevronDown size={14} />
        </button>
      )}
    />
  );
}

/** The preview in the media button: image as thumbnail (icon 20×18, cover image 44×18) or the emoji. */
function MediaPreview({ kind, value }: { kind: 'icon' | 'cover'; value: string }) {
  if (kind === 'cover') return <img src={value} alt="" className="prop-value-thumb w-11" />;
  return isImageIcon(value)
    ? <img src={value} alt="" className="prop-value-thumb w-5" />
    : <span className="text-sm leading-none px-0.5">{value}</span>;
}

/**
 * Icon or cover image as a property: the button shows only the preview (no
 * chevron), or "+ Add" when empty. A click opens a menu: choose image,
 * for the icon also emoji, and Remove. An empty cover image has only the one way
 * and opens the file picker right away.
 *
 * With `fallback`, "Remove" resets to this icon instead of to nothing and
 * is absent while it already applies: a custom block and a template always
 * carry an icon.
 */
export function MediaPropertyRow({ rowIcon, label, kind, value, onChange, onRemove, fallback }: {
  rowIcon: ReactNode;
  label: string;
  kind: 'icon' | 'cover';
  value?: string | null;
  onChange: (value: string) => void;
  onRemove?: () => void;
  /** The default icon that "Remove" resets to (instead of `onRemove`). */
  fallback?: string;
}) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; toggleEmoji?: () => void } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const showNotice = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(null), 2500);
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (kind === 'cover' && !isAcceptedImageFile(file)) {
      showNotice(t('common.unsupportedImageFormat'));
      return;
    }
    try {
      const next = kind === 'icon' ? await readIconFile(file) : await prepareImageDataUrl(await readFileAsDataUrl(file));
      // `null`: an icon in a rejected format (SVG too); say so, as with the cover image.
      if (next) onChange(next);
      else showNotice(t('common.unsupportedImageFormat'));
    } catch (err) {
      // Better to set nothing than an empty image: the previous value is better than none.
      if (kind === 'icon') {
        reportImageError(err, 'icon');
      } else if (err instanceof ImageTooLargeError) {
        showNotice(t('common.imageTooLargeDetail', { max: imageSizeLabel(err.maxBytes, t('common.megabytes')) }));
      } else {
        console.error('Failed to read cover image:', err);
      }
    }
  };

  const pickFile = () => inputRef.current?.click();
  const remove = fallback !== undefined
    ? (value === fallback ? undefined : () => onChange(fallback))
    : (value ? onRemove : undefined);

  // Emoji only for the icon: only there is there a picker that opens it.
  const actions = (toggleEmoji?: () => void): ContextMenuAction[] => [
    { label: t('properties.chooseImage'), icon: <ImagePlus size={12} />, onClick: pickFile },
    ...(toggleEmoji ? [{ label: t('properties.emoji'), icon: <Smile size={12} />, onClick: toggleEmoji }] : []),
    ...(remove ? [{ label: t('properties.remove'), icon: <X size={12} />, onClick: remove, danger: true }] : []),
  ];

  // An empty cover image opens the file picker right away, no menu.
  const opensMenu = kind === 'icon' || !!value;

  const button = (toggleEmoji?: () => void) => (
    <button
      type="button"
      aria-haspopup={opensMenu ? 'menu' : undefined}
      aria-expanded={opensMenu ? menu !== null : undefined}
      aria-label={label}
      title={label}
      className={`prop-value-btn${value ? ' prop-value-btn--media' : ' prop-value-btn--muted'}`}
      onClick={(e) => {
        if (!opensMenu) { pickFile(); return; }
        const r = e.currentTarget.getBoundingClientRect();
        setMenu({ x: r.right, y: r.bottom + 4, toggleEmoji });
      }}
    >
      {value ? <MediaPreview kind={kind} value={value} /> : (
        <>
          <Plus size={14} />
          <span className="min-w-0 truncate">{t('properties.add')}</span>
        </>
      )}
    </button>
  );

  return (
    <>
      <EditPropertyRow icon={rowIcon} label={label}>
        <input ref={inputRef} type="file" accept={ACCEPTED_IMAGE_MIME} className="hidden" onChange={handleUpload} />
        {kind === 'icon' ? (
          <EmojiPicker
            value={value && !isImageIcon(value) ? value : ''}
            onChange={onChange}
            align="right"
            wrapperClassName="relative min-w-0"
            trigger={({ toggle }) => button(toggle)}
          />
        ) : button()}
      </EditPropertyRow>
      {notice && <p className="pl-[9px] pr-3 text-xs text-danger">{notice}</p>}
      {menu && <ContextMenu align="right" minWidth={120} x={menu.x} y={menu.y} actions={actions(menu.toggleEmoji)} onClose={() => setMenu(null)} />}
    </>
  );
}
