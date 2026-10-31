import { useMemo, type MouseEvent } from 'react';
import DOMPurify from 'dompurify';
import { openUrl } from '@tauri-apps/plugin-opener';
import type { BlockInstance } from '../../lib/blocks/types';

/**
 * What a fallback may display: the text structure that TipTap also knows,
 * plus the lists that a block writes as a readable summary. No
 * `style`, no `class`, no `<style>`, no forms: the content may come from
 * an import, and until here everything has gone through TipTap's schema,
 * which discards all of that. Without this list an imported block could cover the
 * window with a fake interface (`position: fixed`, the
 * app's own Tailwind classes) or send a form to a foreign server.
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
 * A block that this app version cannot display: a type from a
 * missing extension or a data format from a newer version. What is shown
 * is the readable fallback that every block stores along in its section.
 * It cannot be edited, only moved or removed; on
 * saving, the stack writes it back unchanged.
 */
export default function UnknownBlock({ block }: { block: BlockInstance }) {
  const html = useMemo(() => DOMPurify.sanitize(block.html, FALLBACK_SANITIZE), [block.html]);

  // A link in the fallback must not navigate the app window away itself:
  // http(s) goes to the system browser, as with external links in the editor,
  // everything else stays without effect.
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
