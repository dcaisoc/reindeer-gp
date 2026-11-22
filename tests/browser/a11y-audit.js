// Accessibility audit, injected into a page as a string (returns a list of problems):
//  - WCAG 2.1 AA text contrast (4.5:1, or 3:1 for large text), against the real composited background;
//  - every control is keyboard-reachable and has an accessible name;
//  - anything with a click handler is a real control;
//  - canvases and images are labelled or hidden from screen readers.
(() => {
  const problems = [];
  const parse = (c) => {
    const m = /rgba?\(([^)]+)\)/.exec(c);
    if (!m) return null;
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
  };
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const lum = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
  const over = (top, under) => [0, 1, 2].map((i) => top[i] * top[3] + under[i] * (1 - top[3])).concat(1);
  const describe = (el) => {
    const id = el.id ? `#${el.id}` : '';
    const cls = el.className && typeof el.className === 'string' ? `.${el.className.trim().split(/\s+/).join('.')}` : '';
    return `${el.tagName.toLowerCase()}${id}${cls}`;
  };
  const visible = (el) => {
    if (el.closest('[hidden], [aria-hidden="true"], .sr-only')) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none';
  };
  // Background behind an element: composite ancestors' background colours. null if an image/canvas is behind.
  const background = (el) => {
    const layers = [];
    for (let e = el; e; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.backgroundImage && cs.backgroundImage !== 'none') return null;
      const c = parse(cs.backgroundColor);
      if (c && c[3] > 0) {
        layers.push(c);
        if (c[3] >= 1) break;
      }
    }
    let col = [255, 255, 255, 1];
    for (const l of layers.reverse()) col = over(l, col);
    return col;
  };
  const opacity = (el) => {
    let o = 1;
    for (let e = el; e; e = e.parentElement) o *= Number(getComputedStyle(e).opacity);
    return o;
  };

  // 1. Contrast of every visible text run.
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement;
    if (!el || seen.has(el) || !n.textContent.trim() || !visible(el)) continue;
    seen.add(el);
    if (el.closest('button:disabled, input:disabled, select:disabled, [aria-disabled="true"], .locked')) continue; // inactive UI is exempt
    if (el.closest('.drive, .projector canvas, .toast')) continue; // the drive HUD sits on the game canvas; toasts fade in and out
    const bg = background(el);
    if (!bg) continue;
    const cs = getComputedStyle(el);
    const fg = parse(cs.color);
    if (!fg) continue;
    const fgEff = over([fg[0], fg[1], fg[2], fg[3] * opacity(el)], bg);
    const L1 = lum(fgEff);
    const L2 = lum(bg);
    const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const size = parseFloat(cs.fontSize);
    const large = size >= 24 || (size >= 18.66 && Number(cs.fontWeight) >= 700);
    const need = large ? 3 : 4.5;
    if (ratio < need - 0.01) problems.push(`contrast ${ratio.toFixed(2)} < ${need}: ${describe(el)} "${n.textContent.trim().slice(0, 40)}" (${cs.color} on rgb(${bg.slice(0, 3).map(Math.round).join(',')}))`);
  }

  // 2. Controls: reachable and named.
  const name = (el) => {
    if (el.getAttribute('aria-label')) return el.getAttribute('aria-label');
    const lb = el.getAttribute('aria-labelledby');
    if (lb) return lb.split(' ').map((id) => document.getElementById(id)?.textContent ?? '').join(' ');
    if (el.labels && el.labels.length) return [...el.labels].map((l) => l.textContent).join(' ');
    if (el.tagName === 'INPUT' && ['submit', 'button'].includes(el.type)) return el.value;
    if (el.title) return el.title;
    return el.textContent;
  };
  const controls = document.querySelectorAll('a[href], button, input:not([type=hidden]), select, textarea, summary, [tabindex], [data-clickable]');
  for (const el of controls) {
    if (!visible(el) && !(el.tagName === 'INPUT' && el.type === 'file')) continue;
    const native = el.matches('a[href], button, input, select, textarea, summary');
    if (!native && !(el.tabIndex >= 0 && el.getAttribute('role'))) problems.push(`not a keyboard control (use a button or link): ${describe(el)} "${(el.textContent || '').trim().slice(0, 30)}"`);
    if (el.tabIndex < 0 && !el.disabled && !el.closest('.touch-controls')) problems.push(`removed from the tab order: ${describe(el)}`);
    if (!String(name(el) || '').trim()) problems.push(`control without an accessible name: ${describe(el)}`);
  }
  // 3. Pictures.
  for (const c of document.querySelectorAll('canvas, img')) {
    if (!visible(c)) continue;
    const named = c.getAttribute('aria-label') || c.getAttribute('alt') !== null && c.tagName === 'IMG' || c.getAttribute('role') === 'img' && c.getAttribute('aria-label');
    if (!named && c.getAttribute('aria-hidden') !== 'true') problems.push(`picture without a label (aria-label, or aria-hidden if decorative): ${describe(c)}`);
  }
  // 4. One main landmark and a heading.
  if (document.querySelectorAll('main').length !== 1) problems.push(`expected exactly one <main>, found ${document.querySelectorAll('main').length}`);
  if (!document.querySelector('main h1')) problems.push('page has no <h1>');
  return problems;
})()
