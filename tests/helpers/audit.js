// Layout audit run inside the page: overflow, clipped button text, small tap targets, blank canvases, controls covered by something else.
export function auditPage(page, root, { phone = false } = {}) {
  return page.evaluate(({ root, phone }) => {
    const R = document.querySelector(root);
    const out = { overflowX: [], clipped: [], small: [], blank: [], covered: [], lowContrast: [], notes: [] };
    if (!R) { out.notes.push('root not found: ' + root); return out; }
    const vw = innerWidth, vh = innerHeight;
    const desc = e => (e.id ? '#' + e.id : e.tagName.toLowerCase() + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : '')) + (e.textContent && e.tagName !== 'CANVAS' ? ' "' + e.textContent.trim().replace(/\s+/g, ' ').slice(0, 14) + '"' : '');
    const shown = e => { const r = e.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false; const cs = getComputedStyle(e); if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) return false; for (let p = e; p && p !== document.body; p = p.parentElement) { if (p.hidden || p.classList.contains('sr-only')) return false; } return true; };
    // 1. horizontal overflow of the page and of the overlay itself
    if (document.documentElement.scrollWidth > vw + 1) out.overflowX.push(`page scrollWidth ${document.documentElement.scrollWidth} > viewport ${vw}`);
    if (R.scrollWidth > R.clientWidth + 1) out.overflowX.push(`${root} scrollWidth ${R.scrollWidth} > clientWidth ${R.clientWidth}`);
    const clippedAbove = e => { for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if (o !== 'visible' && p.getBoundingClientRect().right <= vw + 1 && p.getBoundingClientRect().left >= -1) return true; } return false; };
    for (const e of R.querySelectorAll('*')) {
      if (!shown(e)) continue;
      const r = e.getBoundingClientRect();
      if ((r.right > vw + 1.5 || r.left < -1.5) && !clippedAbove(e) && !e.closest('#fx, canvas, .float')) out.overflowX.push(`${desc(e)} spans ${Math.round(r.left)}..${Math.round(r.right)} of ${vw}`);
    }
    // 2. clipped text inside buttons
    const controls = [...R.querySelectorAll('button, a[href], input:not([type=hidden]), select, summary, [role=button]')].filter(shown);
    for (const b of controls) {
      if (b.tagName === 'INPUT') continue;
      if (b.scrollWidth > b.clientWidth + 1) out.clipped.push(`${desc(b)} scrollWidth ${b.scrollWidth} > clientWidth ${b.clientWidth}`);
      else if (b.scrollHeight > b.clientHeight + 2 && getComputedStyle(b).overflowY !== 'visible') out.clipped.push(`${desc(b)} scrollHeight ${b.scrollHeight} > clientHeight ${b.clientHeight}`);
    }
    // 3. tap targets (phone only)
    if (phone) for (const b of controls) { if (b.disabled) continue; const r = b.getBoundingClientRect(); if (Math.min(r.width, r.height) < 40) out.small.push(`${desc(b)} ${Math.round(r.width)}x${Math.round(r.height)}`); }
    // 4. canvases that are visible but empty
    for (const c of R.querySelectorAll('canvas')) {
      if (!shown(c) || c.width * c.height < 400 || c.matches('.txl, #ktv')) continue;   // .txl / #ktv are transparent tap-and-label layers on top of the drawn scene
      try {
        const ctx = c.getContext('2d'); const w = Math.min(c.width, 400), h = Math.min(c.height, 400);
        const d = ctx.getImageData(Math.floor((c.width - w) / 2), Math.floor((c.height - h) / 2), w, h).data;
        let first = null, varies = false, opaque = 0;
        for (let i = 0; i < d.length; i += 4) { if (d[i + 3] > 0) opaque++; const k = d[i] + ',' + d[i + 1] + ',' + d[i + 2] + ',' + d[i + 3]; if (first === null) first = k; else if (k !== first) { varies = true; } }
        if (!opaque) out.blank.push(`${desc(c)} ${c.width}x${c.height} fully transparent`); else if (!varies) out.blank.push(`${desc(c)} ${c.width}x${c.height} one flat colour`);
      } catch (e) { out.notes.push('canvas unreadable ' + desc(c)); }
    }
    // 4b. headings must be readable against what is behind them (contrast >= 3:1)
    const rgb = s => { const m = s.match(/[\d.]+/g); return m ? m.map(Number) : [0, 0, 0, 0]; };
    const lum = ([r, g, b]) => { const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }; return .2126 * f(r) + .7152 * f(g) + .0722 * f(b); };
    const bgOf = e => { for (let p = e; p; p = p.parentElement) { const c = rgb(getComputedStyle(p).backgroundColor); if (c[3] === undefined || c[3] > .5) return c; } return [255, 255, 255]; };
    for (const e of R.querySelectorAll('.sh-head *, h1, h2, h3')) {
      if (!shown(e) || !e.textContent.trim()) continue;
      const fg = rgb(getComputedStyle(e).color), bg = bgOf(e), a = lum(fg), b = lum(bg), ratio = (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
      if (ratio < 3) out.lowContrast = (out.lowContrast || []).concat(`${desc(e)} contrast ${ratio.toFixed(1)}:1`);
    }
    // 5. controls that something else covers (checked after scrolling each into view)
    for (const b of controls) {
      if (b.disabled) continue;
      b.scrollIntoView({ block: 'center', inline: 'center' });
      const r = b.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
      if (x < 0 || y < 0 || x > vw || y > vh) { out.covered.push(`${desc(b)} centre is off screen (${Math.round(x)},${Math.round(y)})`); continue; }
      const t = document.elementFromPoint(x, y);
      if (t && !b.contains(t)) out.covered.push(`${desc(b)} is covered by ${desc(t)}`);
    }
    R.scrollTo && R.scrollTo(0, 0); window.scrollTo(0, 0);
    return out;
  }, { root, phone });
}
export const problems = a => Object.entries(a).flatMap(([k, v]) => v.map(x => `${k}: ${x}`));
