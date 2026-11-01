import { invoke } from '@tauri-apps/api/core';
import { isMacOS, isTauri } from '../lib/platform';
import type { CustomTheme } from './customTheme';

/**
 * The macOS Dock icon in a custom theme's colours, from the same logo and plate
 * as `src-tauri/icons/source/emerald-macos.svg`, with the mixes of
 * `.emerald-mark-*` in `src/index.css`. An SVG drawn into a canvas sees no
 * stylesheet, so the colours are mixed here. macOS shows this icon only while
 * the app runs; before launch and after quitting the Dock has the bundle's.
 */
const ICON_SIZE = 512;

/** Share of the accent, and what it is mixed with. */
const CUT: Array<[string, number, '#000000' | '#ffffff']> = [
  ['<path d="M60 4 L60 14 L70.33 45.79 L103.75 45.79 L113.26 42.7 A56 56 0 0 0 60 4 Z"', 70, '#000000'],
  ['<path d="M113.26 42.7 L103.75 45.79 L76.71 65.43 L87.04 97.21 L92.92 105.3 A56 56 0 0 0 113.26 42.7 Z"', 48, '#000000'],
  ['<path d="M92.92 105.3 L87.04 97.21 L60 77.57 L32.96 97.21 L27.08 105.3 A56 56 0 0 0 92.92 105.3 Z"', 39, '#000000'],
  ['<path d="M27.08 105.3 L32.96 97.21 L43.29 65.43 L16.25 45.79 L6.74 42.7 A56 56 0 0 0 27.08 105.3 Z"', 50, '#000000'],
  ['<path d="M6.74 42.7 L16.25 45.79 L49.67 45.79 L60 14 L60 4 A56 56 0 0 0 6.74 42.7 Z"', 82, '#000000'],
  ['<polygon points="60,14 49.67,45.79 70.33,45.79"', 82, '#ffffff'],
  ['<polygon points="103.75,45.79 70.33,45.79 76.71,65.43"', 90, '#000000'],
  ['<polygon points="87.04,97.21 76.71,65.43 60,77.57"', 70, '#000000'],
  ['<polygon points="32.96,97.21 60,77.57 43.29,65.43"', 77, '#000000'],
  ['<polygon points="16.25,45.79 43.29,65.43 49.67,45.79"', 75, '#ffffff'],
  ['<polygon points="60,77.57 43.29,65.43 49.67,45.79 70.33,45.79 76.71,65.43"', 100, '#000000'],
];

function channels(hex: string): number[] {
  const full = hex.length === 4 ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}` : hex;
  return [1, 3, 5].map((i) => parseInt(full.slice(i, i + 2), 16));
}

function mix(a: string, percent: number, b: string): string {
  const other = channels(b);
  const mixed = channels(a).map((value, i) => Math.round((value * percent + other[i] * (100 - percent)) / 100));
  return `#${mixed.map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}

function iconSvg({ colors: c }: CustomTheme): string {
  const line = mix(c.accent, 20, '#ffffff');
  const facets = CUT.map(([shape, percent, other]) => `${shape} fill="${mix(c.accent, percent, other)}"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="${ICON_SIZE}" height="${ICON_SIZE}">`
    + `<defs><linearGradient id="plate" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${mix(c.frame, 88, c.text)}"/><stop offset="1" stop-color="${c.frame}"/></linearGradient></defs>`
    + '<rect x="100" y="100" width="824" height="824" rx="185" fill="url(#plate)"/>'
    + '<g transform="translate(170 170) scale(5.7)">'
    + `<circle cx="60" cy="60" r="56" fill="${mix(c.accent, 56, '#000000')}"/>${facets}`
    + `<polygon points="60,14 87.04,97.21 16.25,45.79 103.75,45.79 32.96,97.21" fill="none" stroke="${line}" stroke-width="3.4" stroke-linejoin="round"/>`
    + `<circle cx="60" cy="60" r="52.5" fill="none" stroke="${line}" stroke-width="1.9"/>`
    + '</g></svg>';
}

async function renderPng(svg: string): Promise<number[]> {
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = ICON_SIZE;
  canvas.getContext('2d')?.drawImage(image, 0, 0, ICON_SIZE, ICON_SIZE);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('canvas gave no image');
  return [...new Uint8Array(await blob.arrayBuffer())];
}

/** What the Dock shows now: a theme's id and colours, or null for the bundle's icon. */
let shown: string | null = null;

/** Follows the active theme; a built-in theme gets the bundle's icon back. */
export function syncDockIcon(theme: CustomTheme | null): void {
  if (!isTauri || !isMacOS) return;
  const wanted = theme && JSON.stringify([theme.id, theme.colors]);
  if (wanted === shown) return;
  shown = wanted;
  void (async () => {
    const png = theme ? await renderPng(iconSvg(theme)) : null;
    // A later switch has taken over while this one was drawing.
    if (wanted === shown) await invoke('set_dock_icon', { png });
  })().catch((err: unknown) => {
    console.warn('[theme] could not set the dock icon', err);
  });
}
