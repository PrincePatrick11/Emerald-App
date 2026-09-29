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
 * Die Bausteine der Bearbeiten-Seitenleiste — das Gegenstück zu
 * `SidebarPropertyRow` der Leseansicht. Dieselbe Zeile (Icon, Name, rechts der
 * Wert, gleich eingerückt), nur ist der Wert hier ein Bedienelement: ein
 * Wert-Knopf mit Menü, ein Medium mit Vorschau oder die Typ-Segmente.
 *
 * Der Körper darum herum ist `EditSidebarBody`; die Abschnitte sind dieselben
 * `SidebarSection`s wie im Lesen, samt ihrem gemerkten Auf/Zu.
 */

/** Der Körper der Bearbeiten-Seitenleiste einer Bibliotheksseite — Abstand wie `RightSidebar` im Lesen. */
export function EditSidebarBody({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-5">{children}</div>;
}

/**
 * Eine Eigenschaft im Bearbeiten: Icon und Name links (nie gekürzt), das
 * Bedienelement rechts. 36px hoch, damit ein 28px-Wert-Knopf Luft hat.
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
 * Der Wert einer Auswahl-Eigenschaft (Kategorie): Wert-Knopf mit
 * Chevron, das Menü geportalt und rechtsbündig. `muted` für „Keine".
 */
export function PropertySelect<T extends string>({ value, options, onChange, text, muted = false, ariaLabel }: {
  value: T;
  options: DropdownOption<T>[];
  onChange: (value: T) => void;
  /** Was der Knopf zeigt — meist Emoji und Name der gewählten Option. */
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
          <ChevronDown size={13} />
        </button>
      )}
    />
  );
}

/** Die Vorschau im Medien-Knopf: Bild als Thumbnail (Icon 20×18, Titelbild 44×18) oder das Emoji. */
function MediaPreview({ kind, value }: { kind: 'icon' | 'cover'; value: string }) {
  if (kind === 'cover') return <img src={value} alt="" className="prop-value-thumb w-11" />;
  return isImageIcon(value)
    ? <img src={value} alt="" className="prop-value-thumb w-5" />
    : <span className="text-[14px] leading-none px-0.5">{value}</span>;
}

/**
 * Icon oder Titelbild als Eigenschaft: der Knopf zeigt nur die Vorschau (ohne
 * Chevron), leer „+ Hinzufügen". Ein Klick öffnet ein Menü — Bild wählen,
 * beim Icon Emoji, und Entfernen. Ein leeres Titelbild hat nur den einen Weg
 * und öffnet gleich die Dateiauswahl.
 *
 * Mit `fallback` setzt „Entfernen" auf dieses Icon zurück statt auf nichts und
 * fehlt, solange es schon gilt — ein eigener Block und eine Vorlage tragen
 * immer ein Icon.
 */
export function MediaPropertyRow({ rowIcon, label, kind, value, onChange, onRemove, fallback }: {
  rowIcon: ReactNode;
  label: string;
  kind: 'icon' | 'cover';
  value?: string | null;
  onChange: (value: string) => void;
  onRemove?: () => void;
  /** Das Standard-Icon, auf das „Entfernen" zurücksetzt (statt `onRemove`). */
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
      // `null`: ein Icon in einem abgelehnten Format (auch SVG) — wie beim Titelbild sagen.
      if (next) onChange(next);
      else showNotice(t('common.unsupportedImageFormat'));
    } catch (err) {
      // Lieber nichts setzen als ein leeres Bild: der bisherige Wert ist besser als keiner.
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

  // Emoji nur beim Icon: nur dort gibt es einen Picker, der es aufklappt.
  const actions = (toggleEmoji?: () => void): ContextMenuAction[] => [
    { label: t('properties.chooseImage'), icon: <ImagePlus size={12} />, onClick: pickFile },
    ...(toggleEmoji ? [{ label: t('properties.emoji'), icon: <Smile size={12} />, onClick: toggleEmoji }] : []),
    ...(remove ? [{ label: t('properties.remove'), icon: <X size={12} />, onClick: remove, danger: true }] : []),
  ];

  // Ein leeres Titelbild öffnet gleich die Dateiauswahl, kein Menü.
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
          <Plus size={13} />
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
