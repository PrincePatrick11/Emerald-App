import { useTranslation } from 'react-i18next';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useIsMaximized } from './useIsMaximized';

/*
 * Glyphs are inline SVG rather than lucide icons: Windows' window controls use
 * a 10x10 grid with a hairline stroke, and lucide has no correct "restore"
 * glyph (two offset squares with the rear one clipped).
 */
const GLYPH = {
  viewBox: '0 0 10 10',
  width: 10,
  height: 10,
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1,
  shapeRendering: 'crispEdges' as const,
};

function MinimizeGlyph() {
  return <svg {...GLYPH}><path d="M0 5h10" /></svg>;
}

function MaximizeGlyph() {
  return <svg {...GLYPH}><rect x="0.5" y="0.5" width="9" height="9" /></svg>;
}

function RestoreGlyph() {
  return (
    <svg {...GLYPH}>
      {/* front window */}
      <rect x="0.5" y="2.5" width="7" height="7" />
      {/* rear window, drawn as an open corner so it reads as "behind" */}
      <path d="M2.5 2.5V0.5h7v7h-2" />
    </svg>
  );
}

function CloseGlyph() {
  return <svg {...GLYPH}><path d="M0.5 0.5l9 9M9.5 0.5l-9 9" /></svg>;
}

/**
 * Minimise / maximise / close for the undecorated window on Windows and Linux.
 * macOS never renders these — it keeps its native traffic lights, positioned
 * over the webview via `titleBarStyle: "Overlay"`.
 *
 * 46x40 px per button with square corners and no gap is the Windows Fluent
 * geometry; matching it is what makes the bar read as a real title bar.
 */
export default function WindowControls() {
  const { t } = useTranslation();
  const maximized = useIsMaximized();
  const appWindow = getCurrentWindow();

  const ignore = () => {/* desktop-only, ignore in browser preview */};

  return (
    <div className="flex items-stretch h-full flex-shrink-0">
      <button
        type="button"
        className="window-control"
        onClick={() => appWindow.minimize().catch(ignore)}
        title={t('titlebar.minimize')}
        aria-label={t('titlebar.minimize')}
      >
        <MinimizeGlyph />
      </button>
      <button
        type="button"
        className="window-control"
        onClick={() => appWindow.toggleMaximize().catch(ignore)}
        title={maximized ? t('titlebar.restore') : t('titlebar.maximize')}
        aria-label={maximized ? t('titlebar.restore') : t('titlebar.maximize')}
      >
        {maximized ? <RestoreGlyph /> : <MaximizeGlyph />}
      </button>
      <button
        type="button"
        className="window-control window-control-close"
        onClick={() => appWindow.close().catch(ignore)}
        title={t('titlebar.close')}
        aria-label={t('titlebar.close')}
      >
        <CloseGlyph />
      </button>
    </div>
  );
}
