import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import i18n from '../i18n';
import { useCategoryStore } from '../store/categoryStore';
import { groupByCategory } from './groupBy';
import {
  defaultFilename, documentTitle, entryAnchor, exportArticle, exportDisplayDate, exportIcon, htmlEscape, typographyStyle, withEnding,
  type ExportFile, type ExportItem,
} from './export';
import type { ExportData } from './exportData';
import { exportDefaultPath } from './vaultManager';
import { HTML_CSS } from './exportStyle';
import { formatDateRange, formatEntryDate } from './formatDate';

// ── Interactive HTML export ─────────────────────────────────────────────────
//
// One self-contained `.html` file that opens in any browser: pictures and an
// app font are embedded, nothing is fetched from the network, and a small
// inline script adds navigation between the entries (hash based, so the
// browser's back/forward work), a search over titles and text, an outline of
// the open entry's headings, sorting by date, light/dark and print. The file
// is opened by the user's browser, not the app webview, so the app CSP's ban
// on inline scripts does not apply; the file carries its own CSP instead,
// which blocks loading anything from the network and submitting forms. Entry
// content is DOMPurify-sanitised (`exportArticle`), so it cannot add scripts
// of its own; the buttons it holds (a cover's switch) get their behaviour from
// the file's script. The blocks are asked for their HTML (`exportRender.ts`):
// what read mode hides with the eye is not in the file, and what a block
// conceals (a loaded sigil's parts) is in it, covered, with a switch to
// uncover it.

/** The toolbar's icons (lucide): the theme switch shows the one it switches to. */
const ICON_MOON = '<svg class="icon-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>';
const ICON_SUN = '<svg class="icon-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
const ICON_PRINT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>';

/** Where "Emerald App" in the export's footer links to. */
const EMERALD_URL = 'https://the-emerald-app.com/';

/** The texts of the file's own controls, in the app language. */
function labels(count: number) {
  const t = i18n.t;
  return {
    search: t('exportMenu.html.search'),
    noResults: t('search.noResultsShort'),
    linkedFrom: t('exportMenu.html.linkedFrom'),
    linksTo: t('exportMenu.html.linksTo'),
    outline: t('exportMenu.html.outline'),
    print: t('exportMenu.html.print'),
    toggleTheme: t('exportMenu.html.toggleTheme'),
    toggleSidebar: t('exportMenu.html.toggleSidebar'),
    sortOldest: t('exportMenu.order.asc'),
    sortNewest: t('exportMenu.order.desc'),
    entryCount: t('exportMenu.count', { count }),
    // `{{app}}` passes through untouched (`escapeValue: false`) and becomes the link after `htmlEscape` in the footer.
    exportedOn: t('exportMenu.html.exportedOn', { date: exportDisplayDate(new Date()), app: '{{app}}' }),
    uncategorized: t('categories.uncategorized'),
  };
}
type Labels = ReturnType<typeof labels>;

function navIcon(data: ExportData): string {
  const icon = exportIcon(data);
  return icon.image ? `<img src="${icon.image}" class="nav-icon-img" alt="">` : htmlEscape(icon.emoji);
}

/** The entries and tasks `data` links to (`ExportData.linkedIds`), itself left out; only entries of the file are shown. */
function outgoingIds(data: ExportData): Set<string> {
  const ids = new Set(data.linkedIds);
  ids.delete(data.id);
  return ids;
}

function refList(entries: ExportData[]): string {
  return entries.map((e) =>
    `<a class="ref" href="#${entryAnchor(e.id)}"><span class="ref-icon">${navIcon(e)}</span><span>${htmlEscape(e.title)}</span></a>`,
  ).join('');
}

/** "Links to" and "Linked from", among the entries of the file. */
function buildRefs(data: ExportData, entries: ExportData[], outgoing: ReadonlyMap<string, Set<string>>, text: Labels): string {
  const linksTo = entries.filter((e) => outgoing.get(data.id)?.has(e.id));
  const linkedFrom = entries.filter((e) => e.id !== data.id && outgoing.get(e.id)?.has(data.id));
  if (!linksTo.length && !linkedFrom.length) return '';
  const block = (title: string, list: ExportData[]) => list.length
    ? `<div class="refs-block"><h2>${htmlEscape(title)}</h2><div class="refs-list">${refList(list)}</div></div>`
    : '';
  return `<section class="refs">${block(text.linksTo, linksTo)}${block(text.linkedFrom, linkedFrom)}</section>`;
}

/** A marker for the entries with pictures, so a list of similar titles shows where they are. */
function mediaMarks(data: ExportData): string {
  return /<img\b/.test(data.content) ? '<span class="nav-media">🖼</span>' : '';
}

/** The sidebar, grouped by category in the app's order; entries without one last. */
function buildNav(entries: ExportData[], text: Labels): string {
  const categoryLabels = new Map(entries.flatMap((e) => (e.category?.id ? [[e.category.id, e.category.label] as const] : [])));
  const groups = groupByCategory(
    entries, useCategoryStore.getState().categories, (e) => e.category?.id ?? null,
    (c) => categoryLabels.get(c.id) ?? '', text.uncategorized,
  ).filter((group) => group.items.length > 0);
  return groups.map((group) => {
    const items = group.items.map((e) => `<a class="nav-item" href="#${entryAnchor(e.id)}" data-target="${entryAnchor(e.id)}" data-ts="${new Date(e.createdAt).getTime() || 0}">
        <span class="nav-icon">${navIcon(e)}</span>
        <span class="nav-text"><span class="nav-title">${htmlEscape(e.title)}</span><span class="nav-sub">${htmlEscape(formatEntryDate(e.createdAt))}</span></span>
        ${mediaMarks(e)}
        <span class="nav-hits" hidden></span>
      </a>`).join('');
    return `<div class="nav-group"><div class="nav-group-title">${htmlEscape(group.label)}</div>${items}</div>`;
  }).join('');
}

/** "5 entries · 1 Sep – 28 Nov 2026": how many, from the first day to the last, as short as the app language puts a range. */
function bundleSubtitle(entries: ExportData[], countText: string): string {
  const days = entries.map((e) => new Date(e.createdAt).getTime()).filter((t) => !Number.isNaN(t));
  if (!days.length) return countText;
  return `${countText} · ${formatDateRange(Math.min(...days), Math.max(...days))}`;
}

/** The entries as one interactive HTML document. */
export async function buildInteractiveHtml(items: readonly ExportItem[], file: ExportFile): Promise<string> {
  const entries = items.map((item) => item.data);
  const text = labels(entries.length);
  const multi = entries.length > 1;
  const title = documentTitle(items, file);
  const bundleIds = new Set(entries.map((e) => e.id));
  const outgoing = new Map(entries.map((e) => [e.id, outgoingIds(e)]));

  const articles: string[] = [];
  for (const item of items) {
    // The references go inside the article, so they are shown and hidden with it.
    articles.push(await exportArticle(item, { bundleIds, footerHtml: buildRefs(item.data, entries, outgoing, text) }));
  }

  return `<!DOCTYPE html>
<html lang="${htmlEscape(i18n.language)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; form-action 'none'; base-uri 'none'">
<meta name="generator" content="Emerald">
<title>${htmlEscape(title)}</title>
<style>${HTML_CSS}</style>
<style>${await typographyStyle(file)}</style>
</head>
<body class="${multi ? 'has-sidebar' : 'single'}">
<div class="app">
  ${multi ? `<aside class="sidebar" id="sidebar">
    <div class="sidebar-head">
      <div class="bundle-title">${htmlEscape(title)}</div>
      <div class="bundle-sub">
        <span>${htmlEscape(bundleSubtitle(entries, text.entryCount))}</span>
        <button class="sort-btn" id="sort-btn" aria-label="${htmlEscape(text.sortOldest)} / ${htmlEscape(text.sortNewest)}" data-order="${file.order ?? 'asc'}"
          data-label-asc="${htmlEscape(text.sortOldest)}" data-label-desc="${htmlEscape(text.sortNewest)}">⇅</button>
      </div>
      <input type="search" id="search" class="search" placeholder="${htmlEscape(text.search)}" autocomplete="off" spellcheck="false">
    </div>
    <nav class="nav" id="nav">${buildNav(entries, text)}</nav>
    <div class="no-results" id="no-results" hidden>${htmlEscape(text.noResults)}</div>
  </aside>` : ''}
  <div class="main">
    <header class="toolbar">
      ${multi ? `<button class="tb-btn" id="sidebar-btn" title="${htmlEscape(text.toggleSidebar)}" aria-label="${htmlEscape(text.toggleSidebar)}">☰</button>` : ''}
      <span class="crumb" id="crumb"></span>
      <button class="tb-btn" id="theme-btn" title="${htmlEscape(text.toggleTheme)}" aria-label="${htmlEscape(text.toggleTheme)}">${ICON_MOON}${ICON_SUN}</button>
      <button class="tb-btn tb-primary" id="print-btn">${ICON_PRINT}${htmlEscape(text.print)}</button>
    </header>
    <div class="content-wrap">
      <div class="doc" id="doc">
        ${articles.join('\n')}
        <footer class="footer">${htmlEscape(text.exportedOn).replace('{{app}}', `<a href="${EMERALD_URL}" target="_blank" rel="noopener noreferrer">Emerald App</a>`)}</footer>
      </div>
      <aside class="outline" id="outline" hidden>
        <div class="outline-title">${htmlEscape(text.outline)}</div>
        <div id="outline-list"></div>
      </aside>
    </div>
  </div>
</div>
<script>${HTML_JS}</script>
</body>
</html>`;
}

/**
 * The entries as one interactive HTML file, saved where the user chooses.
 * Resolves to `false` when the save dialog was cancelled.
 */
export async function exportAsHTML(items: readonly ExportItem[], file: ExportFile = {}): Promise<boolean> {
  if (items.length === 0) throw new Error(i18n.t('emeraldExport.nothing'));
  const chosen = await save({
    defaultPath: await exportDefaultPath(defaultFilename(items, file, 'html')),
    filters: [{ name: 'HTML', extensions: ['html'] }],
  });
  if (!chosen) return false;
  const html = await buildInteractiveHtml(items, file);
  await invoke('write_file', { path: withEnding(chosen, 'html'), content: html });
  return true;
}

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

  // Theme: follow the system unless the reader picked one.
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

  // External links open in a new tab; they never point back into the file.
  Array.prototype.forEach.call(document.querySelectorAll('.entry-content a[href^="http"]'), function (a) {
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener noreferrer');
  });

  var refreshSearch = null; // set by the sidebar search, if the file has one

  // ── Covered content: the switch uncovers and covers again; the search sees only what is uncovered ──
  function isCovered(node) {
    var el = node.nodeType === 1 ? node : node.parentNode;
    // The switch's own label is not content.
    if (el && el.closest('.export-concealed-toggle')) return true;
    // Covered if any box around it is (a covered part inside a covered block).
    for (var body = el && el.closest('.export-concealed-body'); body; body = body.parentNode.closest('.export-concealed-body')) {
      if (!body.parentNode.classList.contains('revealed')) return true;
    }
    return false;
  }
  function searchableText(el) {
    var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    var out = '';
    while (walker.nextNode()) if (!isCovered(walker.currentNode)) out += walker.currentNode.nodeValue;
    return out.toLowerCase();
  }
  Array.prototype.forEach.call(document.querySelectorAll('.export-concealed-toggle'), function (button) {
    button.addEventListener('click', function () {
      var box = button.closest('.export-concealed');
      var open = box.classList.toggle('revealed');
      button.textContent = button.getAttribute(open ? 'data-conceal' : 'data-reveal');
      button.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (refreshSearch) refreshSearch(box.closest('.entry-article'));
    });
  });

  // From the attribute, not the heading: search highlighting splits the heading's text nodes.
  function titleOf(article) { return article.getAttribute('data-title') || ''; }
  function crumbOf(article) {
    var category = article.getAttribute('data-category');
    return category ? category + ' › ' + titleOf(article) : titleOf(article);
  }

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
    var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    var nodes = [];
    while (walker.nextNode()) if (!isCovered(walker.currentNode)) nodes.push(walker.currentNode);
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
    crumb.textContent = crumbOf(target);
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

  // ── Sidebar order by date: within each category ──
  var sortBtn = document.getElementById('sort-btn');
  if (sortBtn) {
    var order = sortBtn.getAttribute('data-order') === 'desc' ? 'desc' : 'asc';
    var label = function () {
      // The tooltip names the order a click switches to.
      sortBtn.title = sortBtn.getAttribute(order === 'asc' ? 'data-label-desc' : 'data-label-asc');
    };
    var sort = function () {
      Array.prototype.forEach.call(document.querySelectorAll('.nav-group'), function (g) {
        var items = Array.prototype.slice.call(g.querySelectorAll('.nav-item'));
        items.sort(function (a, b) {
          var d = Number(a.getAttribute('data-ts')) - Number(b.getAttribute('data-ts'));
          return order === 'asc' ? d : -d;
        });
        items.forEach(function (it) { g.appendChild(it); });
      });
      label();
    };
    sort();
    sortBtn.addEventListener('click', function () {
      order = order === 'asc' ? 'desc' : 'asc';
      sort();
    });
  }

  // Without a hash the file opens on the first entry of the sidebar, once it is sorted.
  var firstNav = document.querySelector('.nav-item');
  show(location.hash.slice(1) || (firstNav ? firstNav.getAttribute('data-target') : ''), false);

  // ── Sidebar search over titles and full text ──
  if (search) {
    var texts = {};
    articles.forEach(function (a) { texts[a.id] = searchableText(a); });
    var noResults = document.getElementById('no-results');
    // Uncovering or covering changes what there is to find in that entry.
    refreshSearch = function (article) {
      if (!article) return;
      clearMarks(article);
      texts[article.id] = searchableText(article);
      if (query) search.dispatchEvent(new Event('input'));
    };
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
