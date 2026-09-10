import { useMemo, type MouseEvent } from 'react';
import DOMPurify from 'dompurify';
import { openUrl } from '@tauri-apps/plugin-opener';
import type { BlockInstance } from '../../lib/blocks/types';

/**
 * Was ein Fallback darstellen darf: die Textstruktur, die auch TipTap kennt,
 * plus die Listen, die ein Block als lesbare Zusammenfassung schreibt. Kein
 * `style`, keine `class`, kein `<style>`, keine Formulare — der Inhalt kann aus
 * einem Import stammen, und bis hierher lief bisher alles durch TipTaps Schema,
 * das all das verwirft. Ohne diese Liste könnte ein importierter Block das
 * Fenster mit einer gefälschten Oberfläche überdecken (`position: fixed`, die
 * App-eigenen Tailwind-Klassen) oder ein Formular an einen fremden Server
 * schicken.
 */
const FALLBACK_SANITIZE = {
  ALLOWED_TAGS: [
    'p', 'br', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code',
    'strong', 'em', 's', 'u', 'mark', 'a', 'img', 'hr', 'span', 'div', 'dl', 'dt', 'dd',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
  ],
  ALLOWED_ATTR: ['href', 'src', 'alt', 'title'],
  ALLOW_DATA_ATTR: false,
};

/**
 * Ein Block, den diese App-Version nicht darstellen kann — ein Typ aus einer
 * fehlenden Erweiterung oder ein Datenformat aus einer neueren Version. Gezeigt
 * wird der lesbare Fallback, den jeder Block in seiner Section mitspeichert.
 * Bearbeiten lässt er sich nicht, nur verschieben oder entfernen; beim
 * Speichern schreibt der Stapel ihn unverändert zurück.
 */
export default function UnknownBlock({ block }: { block: BlockInstance }) {
  const html = useMemo(() => DOMPurify.sanitize(block.html, FALLBACK_SANITIZE), [block.html]);

  // Ein Link im Fallback darf das App-Fenster nicht selbst wegnavigieren —
  // http(s) geht in den System-Browser, wie bei externen Links im Editor,
  // alles andere bleibt wirkungslos.
  const handleClick = (e: MouseEvent<HTMLDivElement>) => {
    const anchor = (e.target as HTMLElement).closest('a');
    if (!anchor) return;
    e.preventDefault();
    const href = anchor.getAttribute('href');
    if (href && (href.startsWith('http://') || href.startsWith('https://'))) {
      openUrl(href).catch((err: unknown) => console.error('[link] open failed:', err));
    }
  };

  return <div className="block-unknown" onClick={handleClick} dangerouslySetInnerHTML={{ __html: html }} />;
}
