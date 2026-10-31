// Run in the page while `test-garish` is active. Returns every visible colour
// outside that theme's hues, grouped by the class that most likely set it.
// Allowed: blue (surfaces), yellow (text), cyan (edges), magenta (accent),
// pink (danger), lime (warning). Everything else bypasses the tokens.
(() => {
  const ALLOWED = [[225, 255], [55, 65], [180, 200], [290, 310], [325, 345], [80, 100]];
  const parse = (value) => {
    const m = value.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const [r, g, b, a = 1] = m[1].split(/[ ,/]+/).map(Number);
    return { r: r / 255, g: g / 255, b: b / 255, a };
  };
  const bypasses = (value) => {
    const c = parse(value);
    if (!c || c.a < 0.03) return false;
    const max = Math.max(c.r, c.g, c.b);
    const d = max - Math.min(c.r, c.g, c.b);
    if (d < 0.06) return true;
    const hue = max === c.r ? ((c.g - c.b) / d + 6) % 6 : max === c.g ? (c.b - c.r) / d + 2 : (c.r - c.g) / d + 4;
    return !ALLOWED.some(([lo, hi]) => hue * 60 >= lo && hue * 60 <= hi);
  };
  const isShown = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight;
  };
  const found = {};
  for (const el of document.querySelectorAll('body *')) {
    if (el.closest('.emerald-mark, img, canvas') || !isShown(el)) continue;
    const s = getComputedStyle(el);
    if (s.visibility === 'hidden' || s.opacity === '0') continue;
    const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    const hits = [];
    if (hasText && bypasses(s.color)) hits.push('text');
    if (bypasses(s.backgroundColor)) hits.push('bg');
    if (parseFloat(s.borderTopWidth) > 0 && s.borderTopStyle !== 'none' && bypasses(s.borderTopColor)) hits.push('border');
    for (const kind of hits) {
      const classes = typeof el.className === 'string' ? el.className : '';
      const raw = classes.match(/(?:^|\s)((?:hover:)?(?:bg|text|border)-(?:stone|jade|red|amber|parchment)-[\w/]+)/g);
      const key = `${kind} ${raw ? raw.map((c) => c.trim()).join(' ') : classes.split(/\s+/).filter(Boolean).slice(0, 3).join(' ') || el.tagName.toLowerCase()}`;
      found[key] = (found[key] || 0) + 1;
    }
  }
  return JSON.stringify(found);
})();
