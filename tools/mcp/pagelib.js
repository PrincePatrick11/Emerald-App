// Runs inside the WebView. cdp.py wraps this file in a function and calls one
// entry of `api` per tool call, so nothing here survives between calls except
// what is parked on window.__emcp: the element refs a snapshot hands out.

const S = (window.__emcp ||= { refs: new Map(), ids: new WeakMap(), n: 0, last: null, probe: 0 });

const norm = (s) => (s == null ? '' : String(s)).replace(/\s+/g, ' ').trim();
const cut = (s, n) => (s.length > n ? s.slice(0, Math.max(1, n - 1)) + '…' : s);
const quote = (s) => JSON.stringify(s);

// -- visibility ---------------------------------------------------------------

function cssVisible(el) {
  return typeof el.checkVisibility !== 'function'
    || el.checkVisibility({ checkVisibilityCSS: true, visibilityProperty: true });
}

function visible(el) {
  if (!el.isConnected || !cssVisible(el)) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

// -- locating -----------------------------------------------------------------

function refOf(el) {
  let id = S.ids.get(el);
  if (!id) {
    id = 'e' + (++S.n);
    S.ids.set(el, id);
    S.refs.set(id, new WeakRef(el));
  }
  return id;
}

const TEXT_ATTRS = ['aria-label', 'title', 'placeholder', 'alt'];

function byText(raw) {
  const needle = norm(raw);
  if (!needle) throw new Error('text= needs some text');
  const lower = needle.toLowerCase();
  const exact = [], partial = [], seen = new Set();
  const add = (el, text) => {
    if (!el || seen.has(el)) return;
    if (text === needle) { seen.add(el); exact.push(el); }
    else if (text.toLowerCase().includes(lower)) { seen.add(el); partial.push(el); }
  };

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node; (node = walker.nextNode());) {
    const parent = node.parentElement;
    if (!parent || parent.closest('script,style,noscript,template')) continue;
    add(parent, norm(node.textContent));
  }
  for (const el of document.querySelectorAll('[aria-label],[title],[placeholder],[alt]')) {
    for (const attr of TEXT_ATTRS) add(el, norm(el.getAttribute(attr)));
  }
  if (!exact.length && !partial.length) {
    // The text may be spread over several nodes ("Save <b>now</b>"): take the
    // innermost elements whose whole text contains it.
    for (const el of document.body.querySelectorAll('*')) {
      if (el.closest('script,style,noscript,template')) continue;
      if (!norm(el.textContent).toLowerCase().includes(lower)) continue;
      if ([...el.children].some((c) => norm(c.textContent).toLowerCase().includes(lower))) continue;
      partial.push(el);
    }
  }
  return exact.concat(partial);
}

// Text usually sits in a span inside the thing that is meant: the button, the
// menu item. A few levels up is enough to find it, and stops a page-wide
// click handler from claiming every text on the page.
function actionable(el) {
  let node = el;
  for (let i = 0; i < 4 && node && node !== document.body; i++, node = node.parentElement) {
    if (isInteractive(node)) return node;
  }
  return el;
}

function find(sel) {
  if (typeof sel !== 'string' || !sel.trim()) throw new Error('empty selector');
  if (sel[0] === '@') {
    const el = S.refs.get(sel.slice(1))?.deref();
    if (!el || !el.isConnected) throw new Error(`${sel} is unknown or no longer in the page - take a new snapshot`);
    return [el];
  }
  if (sel.startsWith('text=')) return [...new Set(byText(sel.slice(5)).map(actionable))];
  try {
    return [...document.querySelectorAll(sel)];
  } catch {
    throw new Error(`not a valid selector: ${quote(sel)}`);
  }
}

// The first match that can actually be seen, and how many there were: a
// selector that matches five things is worth knowing about.
function pick(sel) {
  const all = find(sel);
  if (!all.length) throw new Error(`nothing matches ${quote(sel)}`);
  const shown = all.filter(visible);
  return { el: shown[0] || all[0], count: all.length, shown: shown.length };
}

// -- describing ---------------------------------------------------------------

const TAG_ROLE = { BUTTON: 'button', SELECT: 'combobox', TEXTAREA: 'textbox', SUMMARY: 'button', IMG: 'img' };
const INPUT_ROLE = {
  checkbox: 'checkbox', radio: 'radio', button: 'button', submit: 'button', reset: 'button',
  range: 'slider', file: 'file',
};
const ACTIVE_ROLES = new Set([
  'button', 'link', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'checkbox',
  'radio', 'switch', 'textbox', 'combobox', 'slider', 'treeitem', 'searchbox', 'spinbutton',
]);
const FIELD_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

// The outermost contenteditable element - Tiptap's editor root, for one.
function isEditor(el) {
  return el.isContentEditable && !(el.parentElement && el.parentElement.isContentEditable);
}

function role(el) {
  const explicit = el.getAttribute('role');
  if (explicit) return explicit;
  if (el.tagName === 'INPUT') return INPUT_ROLE[el.type] || 'textbox';
  if (el.tagName === 'A' && el.hasAttribute('href')) return 'link';
  if (isEditor(el)) return 'textbox';
  return TAG_ROLE[el.tagName] || el.tagName.toLowerCase();
}

function isInteractive(el) {
  const tag = el.tagName;
  if (tag === 'BUTTON' || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'SUMMARY') return true;
  if (tag === 'INPUT') return el.type !== 'hidden';
  if (tag === 'A') return el.hasAttribute('href');
  if (ACTIVE_ROLES.has(el.getAttribute('role')) || isEditor(el)) return true;
  if (el.hasAttribute('onclick') || (el.hasAttribute('tabindex') && el.tabIndex >= 0)) return true;
  // React attaches handlers out of sight, so a clickable div shows only in its
  // cursor. The parent check keeps the children it passes that on to out.
  const parent = el.parentElement;
  return getComputedStyle(el).cursor === 'pointer'
    && !(parent && getComputedStyle(parent).cursor === 'pointer');
}

function valueOf(el) {
  if (el.tagName === 'SELECT') return el.selectedOptions[0] ? norm(el.selectedOptions[0].text) : '';
  if (FIELD_TAGS.has(el.tagName)) return el.value;
  return el.innerText || '';
}

function iconOf(el) {
  const svg = el.matches('svg') ? el : el.querySelector('svg[class*="lucide-"]');
  const cls = svg && (svg.getAttribute('class') || '').split(/\s+/).find((c) => c.startsWith('lucide-'));
  return cls ? cls.slice(7) : '';
}

function nameOf(el, max) {
  let name = el.getAttribute('aria-label');
  if (!name && FIELD_TAGS.has(el.tagName)) {
    const isButton = el.type === 'button' || el.type === 'submit' || el.type === 'reset';
    name = (isButton && el.value) || (el.labels && el.labels[0] && el.labels[0].innerText)
      || el.placeholder || el.getAttribute('title') || el.name;
  } else if (!name && isEditor(el)) {
    name = el.getAttribute('data-placeholder') || el.getAttribute('title');
  } else if (!name) {
    name = el.innerText || el.getAttribute('title') || el.getAttribute('alt');
  }
  return cut(norm(name), max);
}

function statesOf(el) {
  const on = (attr) => el.getAttribute(attr) === 'true';
  const states = [];
  if (el.disabled || on('aria-disabled')) states.push('disabled');
  if ((el.type === 'checkbox' || el.type === 'radio') ? el.checked : on('aria-checked')) states.push('checked');
  const current = el.getAttribute('aria-current');
  // Apps mark the current item in a class at least as often as in ARIA:
  // `active`, `is-active`, `editor-toolbar-btn-active`.
  const marked = [...el.classList].some((c) => /(^|-)(active|selected)$/.test(c));
  if (on('aria-selected') || on('aria-pressed') || (current && current !== 'false') || marked) states.push('active');
  if (on('aria-expanded')) states.push('expanded');
  if (el.readOnly && FIELD_TAGS.has(el.tagName)) states.push('readonly');
  if (document.activeElement === el) states.push('focused');
  return states;
}

function describe(el, o) {
  const opts = o || { maxText: 60 };
  let line = role(el);
  if (el.id) line += '#' + el.id;
  const testId = el.getAttribute('data-testid');
  if (testId) line += `[data-testid=${testId}]`;
  if (opts.classes && typeof el.className === 'string' && el.className.trim()) {
    line += '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.');
  }
  const active = isInteractive(el);
  const name = active ? nameOf(el, opts.maxText) : norm(el.getAttribute('aria-label') || el.getAttribute('alt'));
  if (name) line += ' ' + quote(name);
  if (active) {
    if (!norm(el.innerText)) {
      const icon = iconOf(el);
      if (icon) line += ' icon=' + icon;
    }
    const plain = el.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'submit', 'reset', 'file'].includes(el.type);
    if (plain || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || isEditor(el)) {
      const value = el.type === 'password' && el.value ? '•••' : norm(valueOf(el));
      if (value) line += ' = ' + quote(cut(value, opts.maxText));
    }
    const states = statesOf(el);
    if (states.length) line += ' [' + states.join(' ') + ']';
    line += ' @' + refOf(el);
  }
  return line;
}

// -- snapshot -----------------------------------------------------------------

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'HEAD', 'META', 'LINK', 'BR', 'WBR']);
const STRUCT_TAGS = new Set([
  'NAV', 'MAIN', 'HEADER', 'FOOTER', 'ASIDE', 'SECTION', 'ARTICLE', 'FORM', 'DIALOG', 'FIELDSET',
  'UL', 'OL', 'LI', 'TABLE', 'TR', 'TD', 'TH', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'P', 'LABEL',
  'LEGEND', 'PRE', 'BLOCKQUOTE', 'IMG', 'DETAILS',
]);

function isStruct(el) {
  return STRUCT_TAGS.has(el.tagName) || el.id !== '' || el.hasAttribute('role')
    || el.hasAttribute('data-testid') || el.hasAttribute('aria-label');
}

function mergeText(kids) {
  const out = [];
  for (const kid of kids) {
    const last = out[out.length - 1];
    if (kid.line == null && last && last.line == null) last.text += ' ' + kid.text;
    else out.push(kid);
  }
  return out;
}

// One node per element worth a line. Anonymous wrappers (the divs and spans a
// React tree is mostly made of) return their children instead of themselves,
// which is where most of the saving over a raw DOM dump comes from.
function build(el, o) {
  if (SKIP_TAGS.has(el.tagName) || !cssVisible(el)) return [];
  if (el.tagName.toLowerCase() === 'svg') return [];

  const active = isInteractive(el);
  let kids = [];
  if (el.tagName !== 'SELECT' && !isEditor(el)) {
    for (const child of el.childNodes) {
      if (child.nodeType === 3) {
        const text = norm(child.textContent);
        if (text) kids.push({ line: null, text });
      } else if (child.nodeType === 1) {
        kids.push(...build(child, o));
      }
    }
    kids = mergeText(kids);
  }

  if (active) {
    // Its text is already its name; only what can be acted on inside it stays.
    return [{ line: describe(el, o), act: true, kids: kids.filter((k) => k.line != null) }];
  }
  if (!isStruct(el)) return kids;

  const onlyText = kids.every((k) => k.line == null);
  if (onlyText) {
    const text = kids.map((k) => k.text).join(' ');
    if (!text && el.tagName !== 'IMG') return [];
    return [{ line: describe(el, o) + (text ? ' ' + quote(cut(text, o.maxText)) : ''), kids: [] }];
  }
  return [{ line: describe(el, o), kids }];
}

function render(kids, depth, out, o) {
  for (const kid of kids) {
    const pad = '  '.repeat(depth);
    if (depth > o.maxDepth) {
      out.push(pad + '- …');
      return;
    }
    out.push(pad + '- ' + (kid.line != null ? kid.line : quote(cut(kid.text, o.maxText))));
    if (kid.kids && kid.kids.length) render(kid.kids, depth + 1, out, o);
  }
}

function collectActive(kids, out) {
  for (const kid of kids) {
    if (kid.act) out.push('- ' + kid.line);
    if (kid.kids) collectActive(kid.kids, out);
  }
}

function snapshot(o) {
  for (const [id, weak] of S.refs) {
    const el = weak.deref();
    if (!el || !el.isConnected) S.refs.delete(id);
  }
  const root = o.selector ? pick(o.selector).el : document.body;
  const tree = build(root, o);
  const lines = [];
  if (o.interactive) collectActive(tree, lines);
  else render(tree, 0, lines, o);

  const head = `${location.href} | ${document.title}` + (o.selector ? ` | within ${o.selector}` : '');
  const out = [head];
  let used = head.length;
  for (let i = 0; i < lines.length; i++) {
    used += lines[i].length + 1;
    if (used > o.maxChars) {
      out.push(`… ${lines.length - i} more lines cut at ${o.maxChars} chars - narrow it with selector, or interactive: true`);
      break;
    }
    out.push(lines[i]);
  }
  if (!lines.length) out.push('(nothing visible)');
  return out.join('\n');
}

// -- pointer ------------------------------------------------------------------

// Null when hovering took the element away, which a hover may well do.
function hovered(sel) {
  const el = find(sel)[0];
  return el ? el.matches(':hover') : null;
}

// Where to press, and whether a real press there would reach the element.
function aim(sel, force, probe) {
  const found = pick(sel);
  const el = found.el;
  if (!force && (el.disabled || el.getAttribute('aria-disabled') === 'true')) {
    throw new Error(`${describe(el)} is disabled`);
  }
  if (!force && !visible(el)) {
    throw new Error(`${describe(el)} is not visible` + (found.count > 1 ? ` (nor are the other ${found.count - 1} matches)` : '') + ' - pass force to click it anyway');
  }
  el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
  const r = el.getBoundingClientRect();
  const x = Math.min(Math.max(r.left + r.width / 2, 1), window.innerWidth - 1);
  const y = Math.min(Math.max(r.top + r.height / 2, 1), window.innerHeight - 1);
  const hit = document.elementFromPoint(x, y);
  const onTarget = !!hit && (el.contains(hit) || (hit.closest('label') && hit.closest('label').control === el));
  const related = !!hit && hit.contains(el);
  if (!force && hit && !onTarget && !related) {
    throw new Error(`${describe(el)} is covered by ${describe(hit)} - deal with that first, or pass force`);
  }
  S.last = el;
  S.probe = 0;
  if (probe) {
    document.addEventListener(probe, () => { S.probe = 1; }, { capture: true, once: true });
  }
  return {
    x, y, real: onTarget && !force, target: describe(el),
    count: found.count, shown: found.shown,
  };
}

function landed() {
  return S.probe === 1;
}

// The fallback when a real press cannot reach the element or did not arrive:
// events dispatched straight at it.
function synthetic(button, clicks) {
  const el = S.last;
  if (!el || !el.isConnected) throw new Error('the element went away before it could be clicked');
  const r = el.getBoundingClientRect();
  const at = { bubbles: true, cancelable: true, view: window, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
  if (button === 'right') {
    el.dispatchEvent(new MouseEvent('contextmenu', { ...at, button: 2, buttons: 2 }));
    return true;
  }
  for (let i = 0; i < clicks; i++) el.click();
  if (clicks > 1) el.dispatchEvent(new MouseEvent('dblclick', { ...at, detail: clicks }));
  return true;
}

// -- typing -------------------------------------------------------------------

function editableWithin(el) {
  const ok = (e) => (FIELD_TAGS.has(e.tagName) && e.type !== 'hidden') || e.isContentEditable;
  if (ok(el)) return el;
  const inner = [...el.querySelectorAll('input:not([type=hidden]),textarea,select,[contenteditable]')].filter(ok);
  return inner.length === 1 ? inner[0] : null;
}

function selectAll(el) {
  if (typeof el.select === 'function') {
    el.select();
    return;
  }
  const range = document.createRange();
  range.selectNodeContents(el);
  const selection = getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

function caretToEnd(el) {
  if (FIELD_TAGS.has(el.tagName)) {
    // Not every input type has a selection (number, email, date).
    try { el.setSelectionRange(el.value.length, el.value.length); } catch { /* keeps its caret */ }
    return;
  }
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  const selection = getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

function focusForTyping(sel, clear) {
  const found = pick(sel);
  const el = editableWithin(found.el);
  if (!el) throw new Error(`${describe(found.el)} is not something text can be typed into`);
  if (el.disabled || el.readOnly) throw new Error(`${describe(el)} is ${el.disabled ? 'disabled' : 'read-only'}`);
  el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
  el.focus();
  if (clear) {
    if (valueOf(el)) {
      selectAll(el);
      document.execCommand('delete');
    }
  } else {
    caretToEnd(el);
  }
  S.last = el;
  return { target: describe(el), before: valueOf(el), field: FIELD_TAGS.has(el.tagName), count: found.count };
}

// Whether the text arrived, and for plain fields a second way in if it did
// not: writing the value through the prototype's setter, which is what React
// listens for.
function confirmTyped(text, before) {
  const el = S.last;
  if (!el || !el.isConnected) throw new Error('the field went away while typing');
  const squash = (s) => String(s).replace(/\s+/g, '');
  const wanted = before + text;
  let method = 'keyboard';
  let ok = squash(valueOf(el)) === squash(wanted);
  if (!ok && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, wanted);
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    method = 'setter';
    ok = squash(valueOf(el)) === squash(wanted);
  }
  return { ok, method, value: cut(norm(valueOf(el)), 120), field: FIELD_TAGS.has(el.tagName) };
}

function focus(sel) {
  const el = pick(sel).el;
  el.focus();
  return describe(el);
}

// -- waiting and measuring ----------------------------------------------------

function stateOf(sel) {
  let all;
  try {
    all = find(sel);
  } catch (e) {
    if (sel[0] === '@') return 'detached';
    throw e;
  }
  if (!all.length) return 'detached';
  return all.some(visible) ? 'visible' : 'hidden';
}

function rectOf(sel) {
  const el = pick(sel).el;
  el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) throw new Error(`${describe(el)} has no size to capture`);
  const view = window.visualViewport;
  return {
    x: r.left + (view ? view.pageLeft : window.scrollX),
    y: r.top + (view ? view.pageTop : window.scrollY),
    width: r.width, height: r.height, target: describe(el),
  };
}

// What `eval` hands back for things JSON has no shape for.
function plain(value) {
  const one = (v) => {
    if (v instanceof Element) return cut(v.outerHTML, 2000);
    if (v instanceof Node) return v.textContent;
    if (v instanceof Error) return String(v.stack || v);
    if (v instanceof Map) return Object.fromEntries(v);
    if (v instanceof Set) return [...v];
    return v;
  };
  if (value instanceof NodeList || value instanceof HTMLCollection || Array.isArray(value)) {
    return [...value].map(one);
  }
  return one(value);
}

const api = { snapshot, aim, hovered, landed, synthetic, focusForTyping, confirmTyped, focus, stateOf, rectOf, plain };
