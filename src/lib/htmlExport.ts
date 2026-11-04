import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { format } from 'date-fns';
import { internalLinksIn, type ExportData, type ExportEntryType } from './exportData';
import {
  DEFAULT_EXPORT_OPTIONS, defaultFilename, documentTitle, entryAnchor, htmlEscape, renderEntryArticle,
  sanitizeDataImageUrl, type ExportOptions,
} from './export';

// ── Interactive HTML export ─────────────────────────────────────────────────
//
// Produces one self-contained `.html` file that opens in any browser: all
// images are embedded, there are no external requests, and a small inline
// script adds navigation between bundled entries (hash-based, so the
// browser's back/forward buttons work), a search over titles and text,
// an outline of the open entry's headings, a light/dark toggle and print.
// The file is opened by the user's browser, not the app webview, so the
// app CSP's ban on inline scripts doesn't apply here; the file carries its
// own CSP instead, which blocks loading anything from the network and
// submitting forms. Entry content is DOMPurify-sanitised, so it can't add
// scripts of its own.

export interface HtmlExportLabels {
  search: string;
  noResults: string;
  linkedFrom: string;
  linksTo: string;
  outline: string;
  print: string;
  toggleTheme: string;
  toggleSidebar: string;
  entryCount: string;      // already interpolated, e.g. "4 entries"
  exportedOn: string;      // date interpolated, `{{app}}` left in: "Exported from {{app}} on …"
  groups: Record<ExportEntryType, string>;
}

const GROUP_ORDER: ExportEntryType[] = ['journal', 'wiki', 'operations'];

/** Where "Emerald App" in the export's footer links to. */
const EMERALD_URL = 'https://the-emerald-app.com/';

function navIcon(data: ExportData): string {
  const safe = sanitizeDataImageUrl(data.entryIcon);
  if (safe) return `<img src="${safe}" class="nav-icon-img" alt="">`;
  if (data.entryIcon) return htmlEscape(data.entryIcon);
  if (data.type === 'journal') return htmlEscape(data.moonPhase?.split(' ')[0] || '📓');
  if (data.type === 'wiki') return htmlEscape(data.wikiCategory?.icon || '📖');
  return htmlEscape(data.opCategory?.icon || '⚡');
}

/** IDs of all entries `data` links to — inline content links and property links. */
function outgoingIds(data: ExportData): Set<string> {
  const ids = new Set(internalLinksIn(data.content).map(t => t.id));
  const chips = [data.paradigma, data.bannung, data.meditation, ...(data.linkedOps ?? []), ...(data.linkedWiki ?? [])];
  for (const c of chips) {
    if (c?.id) ids.add(c.id);
  }
  ids.delete(data.id);
  return ids;
}

function refList(entries: ExportData[]): string {
  return entries.map(e =>
    `<a class="ref" href="#${entryAnchor(e.id)}"><span class="ref-icon">${navIcon(e)}</span><span>${htmlEscape(e.title)}</span></a>`
  ).join('');
}

function buildRefs(
  data: ExportData,
  entries: ExportData[],
  outgoing: ReadonlyMap<string, Set<string>>,
  labels: HtmlExportLabels,
): string {
  const linksTo = entries.filter(e => outgoing.get(data.id)?.has(e.id));
  const linkedFrom = entries.filter(e => e.id !== data.id && outgoing.get(e.id)?.has(data.id));
  if (!linksTo.length && !linkedFrom.length) return '';
  const block = (title: string, list: ExportData[]) => list.length
    ? `<div class="refs-block"><h2>${htmlEscape(title)}</h2><div class="refs-list">${refList(list)}</div></div>`
    : '';
  return `<section class="refs">${block(labels.linksTo, linksTo)}${block(labels.linkedFrom, linkedFrom)}</section>`;
}

/**
 * Small markers for the entries that carry images or sound files — embedded
 * or as placeholders — so a bundle of many similar titles shows where they are.
 */
function mediaMarks(data: ExportData): string {
  const marks = [/<img\b/.test(data.content) ? '🖼' : '', /<audio\b/.test(data.content) ? '🔊' : ''].join('');
  return marks ? `<span class="nav-media">${marks}</span>` : '';
}

function buildNav(entries: ExportData[], labels: HtmlExportLabels): string {
  return GROUP_ORDER.map(type => {
    const group = entries.filter(e => e.type === type);
    if (!group.length) return '';
    const items = group.map(e => {
      const date = format(new Date(e.createdAt), 'dd.MM.yyyy');
      return `<a class="nav-item" href="#${entryAnchor(e.id)}" data-target="${entryAnchor(e.id)}">
        <span class="nav-icon">${navIcon(e)}</span>
        <span class="nav-text"><span class="nav-title">${htmlEscape(e.title)}</span>${type === 'journal' ? `<span class="nav-sub">${date}</span>` : ''}</span>
        ${mediaMarks(e)}
        <span class="nav-hits" hidden></span>
      </a>`;
    }).join('');
    return `<div class="nav-group"><div class="nav-group-title">${htmlEscape(labels.groups[type])}</div>${items}</div>`;
  }).join('');
}

export async function buildInteractiveHtml(
  entries: ExportData[],
  labels: HtmlExportLabels,
  lang: string,
  opts: ExportOptions = DEFAULT_EXPORT_OPTIONS,
): Promise<string> {
  const [main] = entries;
  const bundleIds = new Set(entries.map(e => e.id));
  const multi = entries.length > 1;
  const title = documentTitle(main, opts);

  const outgoing = new Map(entries.map(e => [e.id, outgoingIds(e)]));
  // The references section goes inside the article so it's shown / hidden with it.
  const articles = await Promise.all(entries.map(e =>
    renderEntryArticle(e, {
      bundleIds,
      images: opts.images,
      audio: opts.audio,
      footerHtml: buildRefs(e, entries, outgoing, labels),
    })
  ));

  return `<!DOCTYPE html>
<html lang="${htmlEscape(lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; media-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; form-action 'none'; base-uri 'none'">
<meta name="generator" content="Emerald">
<title>${htmlEscape(title)}</title>
<style>${HTML_CSS}</style>
</head>
<body class="${multi ? 'has-sidebar' : 'single'}">
<div class="app">
  ${multi ? `<aside class="sidebar" id="sidebar">
    <div class="sidebar-head">
      <div class="bundle-title">${htmlEscape(title)}</div>
      <div class="bundle-sub">${htmlEscape(labels.entryCount)}</div>
      <input type="search" id="search" class="search" placeholder="${htmlEscape(labels.search)}" autocomplete="off" spellcheck="false">
    </div>
    <nav class="nav" id="nav">${buildNav(entries, labels)}</nav>
    <div class="no-results" id="no-results" hidden>${htmlEscape(labels.noResults)}</div>
  </aside>` : ''}
  <div class="main">
    <header class="toolbar">
      ${multi ? `<button class="tb-btn" id="sidebar-btn" title="${htmlEscape(labels.toggleSidebar)}" aria-label="${htmlEscape(labels.toggleSidebar)}">☰</button>` : ''}
      <span class="crumb" id="crumb"></span>
      <button class="tb-btn" id="theme-btn" title="${htmlEscape(labels.toggleTheme)}" aria-label="${htmlEscape(labels.toggleTheme)}">◐</button>
      <button class="tb-btn tb-primary" id="print-btn">${htmlEscape(labels.print)}</button>
    </header>
    <div class="content-wrap">
      <div class="doc" id="doc">
        ${articles.join('\n')}
        <footer class="footer">${htmlEscape(labels.exportedOn).replace('{{app}}', `<a href="${EMERALD_URL}" target="_blank" rel="noopener noreferrer">Emerald App</a>`)}</footer>
      </div>
      <aside class="outline" id="outline" hidden>
        <div class="outline-title">${htmlEscape(labels.outline)}</div>
        <div id="outline-list"></div>
      </aside>
    </div>
  </div>
</div>
<script>${HTML_JS}</script>
</body>
</html>`;
}

/** Bundles `entries` (main entry first) into one interactive HTML file and asks where to save it. */
export async function exportAsHTML(
  entries: ExportData[],
  labels: HtmlExportLabels,
  lang: string,
  opts: ExportOptions = DEFAULT_EXPORT_OPTIONS,
): Promise<boolean> {
  const [main] = entries;
  if (!main) return false;
  const html = await buildInteractiveHtml(entries, labels, lang, opts);
  const path = await save({
    defaultPath: defaultFilename(main, opts, 'html'),
    filters: [{ name: 'HTML', extensions: ['html'] }],
  });
  if (!path) return false;
  await invoke('write_file', { path, content: html });
  return true;
}

// ── Embedded stylesheet ─────────────────────────────────────────────────────

const HTML_CSS = `
:root {
  --bg: #f6f5f1; --surface: #ffffff; --sidebar: #efede7; --text: #1f1e1b; --muted: #6d6b64;
  --faint: #9a978e; --border: #e3e0d8; --accent: #00a066; --accent-hover: #00b874;
  --accent-soft: #e4f7ef; --accent-border: #9bdcc0; --accent-text: #00663f; --chip: #f1efea;
  --mark: #fff0a8; --shadow: 0 1px 2px rgba(0,0,0,.04), 0 4px 18px rgba(0,0,0,.05);
  color-scheme: light;
}
:root[data-theme="dark"] {
  --bg: #131312; --surface: #1b1b19; --sidebar: #171716; --text: #e9e7e1; --muted: #a09d94;
  --faint: #6f6c65; --border: #2c2b28; --accent: #00c47a; --accent-hover: #1fd68e;
  --accent-soft: rgba(0,196,122,.12); --accent-border: rgba(0,196,122,.35); --accent-text: #5fe3ae;
  --chip: #252522; --mark: rgba(255,214,10,.32); --shadow: none;
  color-scheme: dark;
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  background: var(--bg); color: var(--text);
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; font-size: 15px;
  -webkit-font-smoothing: antialiased;
}
a { color: inherit; }
.app { display: flex; min-height: 100vh; }

/* Sidebar */
.sidebar {
  width: 280px; flex-shrink: 0; background: var(--sidebar); border-right: 1px solid var(--border);
  position: sticky; top: 0; height: 100vh; display: flex; flex-direction: column;
}
.sidebar-head { padding: 20px 16px 12px; border-bottom: 1px solid var(--border); }
.bundle-title { font-weight: 600; font-size: 15px; line-height: 1.3; overflow-wrap: anywhere; }
.bundle-sub { color: var(--muted); font-size: 12px; margin: 2px 0 12px; }
.search {
  width: 100%; padding: 8px 10px; border-radius: 8px; border: 1px solid var(--border);
  background: var(--surface); color: var(--text); font: inherit; font-size: 13px; outline: none;
}
.search:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.nav { overflow-y: auto; padding: 8px 8px 24px; flex: 1; }
.nav-group { margin-top: 10px; }
.nav-group-title {
  font-size: 11px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase;
  color: var(--faint); padding: 4px 8px;
}
.nav-item {
  display: flex; align-items: center; gap: 10px; padding: 7px 8px; border-radius: 7px;
  text-decoration: none; color: var(--text); font-size: 13px;
}
.nav-item:hover { background: var(--chip); }
.nav-item.active { background: var(--accent-soft); color: var(--accent-text); }
.nav-item[hidden] { display: none; }
.nav-icon { width: 20px; text-align: center; flex-shrink: 0; line-height: 1; }
.nav-icon-img, .ref-icon img { width: 18px; height: 18px; border-radius: 4px; object-fit: cover; vertical-align: middle; }
.nav-text { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.nav-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nav-sub { font-size: 11px; color: var(--faint); }
.nav-media { font-size: 11px; flex-shrink: 0; opacity: .8; letter-spacing: 1px; }
.nav-hits {
  font-size: 11px; background: var(--accent); color: #fff; border-radius: 10px; padding: 0 7px; line-height: 18px;
}
.no-results { color: var(--muted); font-size: 13px; padding: 16px; text-align: center; }

/* Main */
.main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.toolbar {
  position: sticky; top: 0; z-index: 10; display: flex; align-items: center; gap: 8px;
  padding: 10px 20px; background: var(--bg); background: color-mix(in srgb, var(--bg) 88%, transparent);
  backdrop-filter: blur(8px); border-bottom: 1px solid var(--border);
}
.crumb { flex: 1; min-width: 0; color: var(--muted); font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tb-btn {
  font: inherit; font-size: 13px; color: var(--text); background: transparent; border: 1px solid var(--border);
  border-radius: 8px; padding: 6px 12px; cursor: pointer; line-height: 1.2;
}
.tb-btn:hover { background: var(--chip); }
.tb-primary { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 600; }
.tb-primary:hover { background: var(--accent-hover); }
#sidebar-btn { display: none; }
.content-wrap { display: flex; justify-content: center; gap: 32px; padding: 32px 24px 64px; }
.doc { width: 100%; max-width: 780px; min-width: 0; }

/* Entry */
.entry-article {
  background: var(--surface); border: 1px solid var(--border); border-radius: 14px;
  padding: 40px 48px; box-shadow: var(--shadow);
}
body.has-sidebar .entry-article:not(.active) { display: none; }
.entry-topbar { display: flex; align-items: baseline; gap: 6px; color: var(--muted); font-size: 13px; margin-bottom: 6px; }
.topbar-icon { font-size: 1.1em; line-height: 1; }
.topbar-icon-img { width: 1.2em; height: 1.2em; object-fit: cover; border-radius: 3px; align-self: center; }
h1.entry-title {
  font-family: Georgia, "Times New Roman", serif; font-size: 2.1em; line-height: 1.2; font-weight: 700;
  margin: 0 0 16px; overflow-wrap: anywhere;
}
.entry-number { font-family: system-ui, sans-serif; font-size: .45em; font-weight: 400; color: var(--faint); margin-left: .5em; vertical-align: middle; }
.meta-section { padding-bottom: 14px; margin-bottom: 22px; border-bottom: 1px solid var(--border); }
.meta-row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-bottom: 6px; }
.chip {
  display: inline-flex; align-items: center; gap: 5px; font-size: 12px; background: var(--chip);
  border: 1px solid var(--border); border-radius: 7px; padding: 2px 9px; color: var(--text);
  white-space: nowrap; text-decoration: none;
}
a.chip-link { border-color: var(--accent-border); background: var(--accent-soft); color: var(--accent-text); }
a.chip-link:hover { border-color: var(--accent); }
.chip-img { width: 14px; height: 14px; object-fit: cover; border-radius: 3px; }
.chip-active { background: var(--accent-soft); border-color: var(--accent-border); color: var(--accent-text); }
.chip-badge { font-size: 11px; background: var(--border); border-radius: 4px; padding: 0 5px; }
.tag { display: inline-block; font-size: 12px; background: var(--chip); border-radius: 12px; padding: 2px 10px; color: var(--muted); }
.prop-badge { display: inline-flex; font-size: 12px; border: 1px solid var(--border); border-radius: 7px; overflow: hidden; }
.prop-name { background: var(--chip); padding: 2px 8px; color: var(--muted); border-right: 1px solid var(--border); }
.prop-val { padding: 2px 8px; }

.entry-content { font-family: Georgia, "Times New Roman", serif; font-size: 17px; line-height: 1.75; overflow-wrap: break-word; }
.entry-content h1, .entry-content h2, .entry-content h3 { line-height: 1.3; margin: 1.5em 0 .5em; scroll-margin-top: 72px; }
.entry-content p { margin: 0 0 .9em; }
.entry-content img { display: block; max-width: 100%; height: auto; margin: .8em 0; border-radius: 6px; }
.entry-content pre { background: var(--chip); padding: .9em 1.1em; border-radius: 8px; white-space: pre-wrap; font-size: .85em; }
.entry-content code { background: var(--chip); padding: .12em .35em; border-radius: 4px; font-size: .88em; }
.entry-content pre code { background: none; padding: 0; }
.entry-content blockquote { border-left: 3px solid var(--accent-border); margin: 1em 0; padding: .1em 0 .1em 1em; color: var(--muted); }
.entry-content table { border-collapse: collapse; width: 100%; margin: 1em 0; font-size: .92em; }
.entry-content td, .entry-content th { border: 1px solid var(--border); padding: .45em .65em; text-align: left; }
.entry-content ul, .entry-content ol { padding-left: 1.6em; }
.entry-content a { color: var(--accent-text); }
.entry-content hr { border: none; border-top: 1px solid var(--border); margin: 2em 0; }
.entry-content [data-type="internalLink"] {
  display: inline-flex; align-items: center; gap: 4px; font-family: system-ui, sans-serif; font-size: .8em;
  font-weight: 500; background: var(--accent-soft); border: 1px solid var(--accent-border); border-radius: 6px;
  padding: 0 7px; color: var(--accent-text); vertical-align: baseline; text-decoration: none;
}
.entry-content a[data-type="internalLink"]:hover { border-color: var(--accent); }
.entry-content [data-type="internalLink"].il-external { background: var(--chip); border-color: var(--border); color: var(--muted); border-style: dashed; }
.il-icon-img { width: 13px; height: 13px; object-fit: cover; border-radius: 2px; }
mark.hit { background: var(--mark); color: inherit; border-radius: 2px; padding: 0 1px; }

/* References */
.refs { margin-top: 36px; padding-top: 18px; border-top: 1px solid var(--border); display: grid; gap: 16px; }
.refs h2 { font-size: 11px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--faint); margin: 0 0 8px; }
.refs-list { display: flex; flex-wrap: wrap; gap: 6px; }
.ref {
  display: inline-flex; align-items: center; gap: 6px; padding: 5px 10px; border-radius: 8px; font-size: 13px;
  border: 1px solid var(--border); text-decoration: none; background: var(--bg);
}
.ref:hover { border-color: var(--accent); color: var(--accent-text); }
.footer { text-align: center; color: var(--faint); font-size: 12px; margin-top: 24px; }
.footer a { color: var(--accent-text); text-decoration: none; }
.footer a:hover { text-decoration: underline; }
.entry-content figure.audio-embed {
  max-width: 100%; margin: 1em 0; padding: 10px 12px; border: 1px solid var(--border); border-radius: 10px; background: var(--bg);
  font-family: system-ui, sans-serif;
}
.entry-content figure.image-placeholder,
.entry-content figure.audio-placeholder {
  margin: 1em 0; padding: 10px 14px; border: 1px dashed var(--accent-border); border-radius: 8px;
  background: var(--accent-soft); font-family: system-ui, sans-serif; font-size: 13px; color: var(--text);
}
.entry-content figure.audio-placeholder figcaption { margin: 0; }
.entry-content figure.audio-embed figcaption { font-size: 13px; color: var(--muted); margin-bottom: 6px; }
.entry-content figure.audio-embed audio { display: block; width: 100%; }

/* Outline */
.outline { width: 220px; flex-shrink: 0; position: sticky; top: 76px; align-self: flex-start; max-height: calc(100vh - 100px); overflow-y: auto; }
.outline-title { font-size: 11px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--faint); margin-bottom: 8px; }
.outline a { display: block; font-size: 13px; color: var(--muted); text-decoration: none; padding: 3px 0 3px 10px; border-left: 2px solid var(--border); }
.outline a:hover { color: var(--text); }
.outline a.active { color: var(--accent-text); border-left-color: var(--accent); }
.outline a.lvl-2 { padding-left: 20px; }
.outline a.lvl-3 { padding-left: 30px; }
@media (max-width: 1180px) { .outline { display: none !important; } }

/* Narrow screens: sidebar becomes a drawer */
@media (max-width: 820px) {
  #sidebar-btn { display: inline-block; }
  .sidebar { position: fixed; left: 0; top: 0; z-index: 20; transform: translateX(-100%); transition: transform .2s ease; }
  body.sidebar-open .sidebar { transform: none; box-shadow: 0 0 40px rgba(0,0,0,.25); }
  .content-wrap { padding: 16px 12px 48px; }
  .entry-article { padding: 24px 20px; border-radius: 10px; }
  h1.entry-title { font-size: 1.7em; }
}

@media print {
  body { background: #fff; color: #111; }
  .sidebar, .toolbar, .outline, .footer, .refs { display: none !important; }
  .content-wrap { padding: 0; display: block; }
  .doc { max-width: none; }
  body.has-sidebar .entry-article:not(.active) { display: block; }
  .entry-article { border: none; box-shadow: none; padding: 0; border-radius: 0; background: #fff; }
  .entry-article + .entry-article { break-before: page; }
  mark.hit { background: none; }
}
`;

// ── Embedded script ─────────────────────────────────────────────────────────
//
// Plain ES2017, no dependencies. Reads everything it needs from the DOM, so
// no entry data is ever interpolated into script source.

const HTML_JS = `
(function () {
  var root = document.documentElement;
  var body = document.body;
  var articles = Array.prototype.slice.call(document.querySelectorAll('.entry-article'));
  var navItems = Array.prototype.slice.call(document.querySelectorAll('.nav-item'));
  var multi = body.classList.contains('has-sidebar');
  var crumb = document.getElementById('crumb');
  var search = document.getElementById('search');
  var outline = document.getElementById('outline');
  var outlineList = document.getElementById('outline-list');
  var current = null;
  var query = '';

  // Theme: follow the OS unless the reader picked one.
  function storedTheme() { try { return localStorage.getItem('emerald-export-theme'); } catch (e) { return null; } }
  function applyTheme(theme) {
    var t = theme || (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    root.setAttribute('data-theme', t);
  }
  applyTheme(storedTheme());
  document.getElementById('theme-btn').addEventListener('click', function () {
    var next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('emerald-export-theme', next); } catch (e) {}
    applyTheme(next);
  });
  document.getElementById('print-btn').addEventListener('click', function () { window.print(); });

  var sidebarBtn = document.getElementById('sidebar-btn');
  if (sidebarBtn) sidebarBtn.addEventListener('click', function () { body.classList.toggle('sidebar-open'); });

  // External links open in a new tab; they never point back into the bundle.
  Array.prototype.forEach.call(document.querySelectorAll('.entry-content a[href^="http"]'), function (a) {
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener noreferrer');
  });

  // From the attribute, not the heading: search highlighting splits the heading's text nodes.
  function titleOf(article) { return article.getAttribute('data-title') || ''; }

  // ── Search highlighting ──
  function clearMarks(el) {
    Array.prototype.forEach.call(el.querySelectorAll('mark.hit'), function (m) {
      var parent = m.parentNode;
      parent.replaceChild(document.createTextNode(m.textContent), m);
      parent.normalize();
    });
  }
  function markHits(el, q) {
    clearMarks(el);
    if (!q) return null;
    var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    var nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    var first = null;
    nodes.forEach(function (node) {
      var text = node.nodeValue;
      var lower = text.toLowerCase();
      var idx = lower.indexOf(q);
      if (idx < 0) return;
      var frag = document.createDocumentFragment();
      var pos = 0;
      while (idx >= 0) {
        frag.appendChild(document.createTextNode(text.slice(pos, idx)));
        var m = document.createElement('mark');
        m.className = 'hit';
        m.textContent = text.slice(idx, idx + q.length);
        frag.appendChild(m);
        if (!first) first = m;
        pos = idx + q.length;
        idx = lower.indexOf(q, pos);
      }
      frag.appendChild(document.createTextNode(text.slice(pos)));
      node.parentNode.replaceChild(frag, node);
    });
    return first;
  }

  // ── Outline of the open entry's headings ──
  var headingObserver = null;
  function buildOutline(article) {
    if (!outline) return;
    outlineList.innerHTML = '';
    if (headingObserver) headingObserver.disconnect();
    var heads = article.querySelectorAll('.entry-content h1, .entry-content h2, .entry-content h3');
    if (heads.length < 2) { outline.hidden = true; return; }
    outline.hidden = false;
    var links = [];
    Array.prototype.forEach.call(heads, function (h, i) {
      var a = document.createElement('a');
      a.href = '#';
      a.textContent = h.textContent;
      a.className = 'lvl-' + h.tagName.charAt(1);
      a.addEventListener('click', function (e) { e.preventDefault(); h.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
      outlineList.appendChild(a);
      links.push(a);
      h.setAttribute('data-outline-index', String(i));
    });
    if ('IntersectionObserver' in window) {
      headingObserver = new IntersectionObserver(function (obs) {
        obs.forEach(function (o) {
          if (!o.isIntersecting) return;
          var i = Number(o.target.getAttribute('data-outline-index'));
          links.forEach(function (l, j) { l.classList.toggle('active', i === j); });
        });
      }, { rootMargin: '-72px 0px -70% 0px' });
      Array.prototype.forEach.call(heads, function (h) { headingObserver.observe(h); });
    }
  }

  // ── Navigation (hash based, so back / forward work) ──
  function show(id, scroll) {
    var target = null;
    articles.forEach(function (a) { if (a.id === id) target = a; });
    if (!target) target = articles[0];
    if (!target) return;
    var changed = current !== target;
    articles.forEach(function (a) { a.classList.toggle('active', a === target); });
    navItems.forEach(function (n) { n.classList.toggle('active', n.getAttribute('data-target') === target.id); });
    current = target;
    crumb.textContent = titleOf(target);
    document.title = titleOf(target);
    buildOutline(target);
    var hit = markHits(target, query);
    body.classList.remove('sidebar-open');
    if (scroll !== false && changed) {
      if (hit && multi) hit.scrollIntoView({ block: 'center' });
      else window.scrollTo(0, 0);
    }
  }
  window.addEventListener('hashchange', function () { show(location.hash.slice(1)); });
  show(location.hash.slice(1), false);

  // ── Sidebar search over titles and full text ──
  if (search) {
    var texts = {};
    articles.forEach(function (a) { texts[a.id] = a.textContent.toLowerCase(); });
    var noResults = document.getElementById('no-results');
    search.addEventListener('input', function () {
      query = search.value.trim().toLowerCase();
      var visible = 0;
      navItems.forEach(function (n) {
        var text = texts[n.getAttribute('data-target')] || '';
        var hits = query ? text.split(query).length - 1 : 0;
        var match = !query || hits > 0;
        n.hidden = !match;
        var badge = n.querySelector('.nav-hits');
        badge.hidden = !query || !match;
        badge.textContent = String(hits);
        if (match) visible++;
      });
      Array.prototype.forEach.call(document.querySelectorAll('.nav-group'), function (g) {
        g.hidden = !g.querySelector('.nav-item:not([hidden])');
      });
      noResults.hidden = visible > 0;
      if (current) markHits(current, query);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === '/' && document.activeElement !== search) { e.preventDefault(); search.focus(); }
      if (e.key === 'Escape' && document.activeElement === search) { search.value = ''; search.dispatchEvent(new Event('input')); search.blur(); }
    });
  }
})();
`;
