// Visuals: a screenshot of every screen / overlay / station view at phone (390x844), desktop (1280x900) and
// portrait-monitor (1080x1920) size, plus automatic layout checks on each: nothing wider than the screen,
// no clipped button text, tap targets >= 40 px on the phone, canvases actually drawn, readable headings,
// no control covered by something else. Builds tests/out/contact-sheet.html to look at them all.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { OUT, realErrors } from './helpers/browser.js';
import { world, open, sleep } from './helpers/ui.js';
import { SCREENS, DEVICES } from './helpers/screens.js';
import { auditPage, problems } from './helpers/audit.js';

let w;
const results = [];   // { device, id, shot, problems }
before(async () => { w = await world(); });
after(async () => { await w.stop(); contactSheet(); });

// Known exceptions, each with its reason. Everything else must pass.
const EXEMPT = [
  [/.*/, /^small: a "私隱"/, 'inline text link inside a sentence'],
  [/^shift-kitchen/, /^small: button\.tk-l/, 'order-ticket lines are 38 px high in a fixed-height rail (2 px short)'],
  [/^shift-till$/, /^small: button "(?!價錢牌)/, 'receipt lines are tappable rows (tap to strike out), 28 px high'],
];
const exempt = (id, p) => EXEMPT.some(([a, b]) => a.test(id) && b.test(p));

for (const [dev, device] of Object.entries(DEVICES)) {
  test(`${dev} (${device.viewport.width}x${device.viewport.height}): every screen renders, layout checks pass`, { timeout: 280000 }, async () => {
    const failures = [];
    for (const s of SCREENS) {
      let p, found = [];
      try {
        p = await open(w, { ...s.storage, ...(s.seed || {}) }, { device });
        await s.setup(p);
        await sleep(350);
        const shot = join(OUT, `${dev}-${s.id}.png`);
        await p.screenshot({ path: shot });                       // shoot first: the audit scrolls things around
        const a = await auditPage(p, s.root, { phone: dev === 'phone' });
        found = problems(a).filter(x => !exempt(s.id, x));
        const errs = realErrors(p); if (errs.length) found.push(...errs.map(e => 'ERROR ' + e));
        results.push({ device: dev, id: s.id, shot: `${dev}-${s.id}.png`, problems: found });
      } catch (e) {
        found = ['SETUP FAILED: ' + e.message.split('\n')[0]];
        results.push({ device: dev, id: s.id, shot: null, problems: found });
      }
      if (p) await p.context().close();
      if (found.length) failures.push(`${s.id}\n    ` + found.slice(0, 8).join('\n    ') + (found.length > 8 ? `\n    ...and ${found.length - 8} more` : ''));
    }
    assert.equal(failures.length, 0, `${failures.length} screen(s) with problems on ${dev}:\n  ` + failures.join('\n  '));
  });
}

test('the game has no colour-scheme / theme switch (nothing to screenshot per scheme)', async () => {
  const p = await open(w, {});
  assert.equal(await p.evaluate(() => document.querySelectorAll('[data-scheme],[data-theme]').length), 0);
  assert.equal(await p.evaluate(() => matchMedia('(prefers-color-scheme: dark)').media !== 'not all'), true);
  // dark preference must not break the layout either: same home screen, no overflow
  await p.emulateMedia({ colorScheme: 'dark' });
  assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  await p.context().close();
});

function contactSheet() {
  const ids = [...new Set(results.map(r => r.id))];
  const devs = Object.keys(DEVICES);
  const row = id => `<section><h2>${id}</h2><div class="row">${devs.map(d => { const r = results.find(x => x.device === d && x.id === id); if (!r) return `<figure><figcaption>${d}: not run</figcaption></figure>`; return `<figure class="${r.problems.length ? 'bad' : ''}"><a href="${r.shot}"><img loading="lazy" src="${r.shot}"></a><figcaption>${d}${r.problems.length ? ' — ' + r.problems.length + ' problem(s)<br><small>' + r.problems.slice(0, 4).map(x => x.replace(/</g, '&lt;')).join('<br>') + '</small>' : ' — ok'}</figcaption></figure>`; }).join('')}</div></section>`;
  const html = `<!doctype html><meta charset="utf-8"><title>香城茶餐廳 contact sheet</title><style>body{font:14px system-ui;background:#16211c;color:#e8efe9;margin:0;padding:16px}h1{margin:0 0 12px}h2{font-size:15px;margin:18px 0 6px;color:#ffd25a}.row{display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap}figure{margin:0;background:#22362e;padding:6px}figure.bad{outline:3px solid #c8323c}figure img{display:block;max-height:560px;max-width:420px;height:auto;width:auto;object-fit:contain}figcaption{font-size:12px;margin-top:4px;max-width:420px}small{color:#f4a0a0}nav{position:sticky;top:0;background:#16211c;padding:6px 0}</style><h1>香城茶餐廳 — all screens (phone 390x844 | desktop 1280x900 | portrait 1080x1920)</h1><p>${results.filter(r => r.problems.length).length} of ${results.length} screenshots have automatic-check problems (red outline). Click an image for full size.</p>${ids.map(row).join('')}`;
  writeFileSync(join(OUT, 'contact-sheet.html'), html);
}
