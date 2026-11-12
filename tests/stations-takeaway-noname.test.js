// The knot's pattern / family name (川, 塗鴉, ...) is never shown to the player. The 外賣 screen
// (the standalone page and, through ?seat, the game's seat view) draws on canvases: every text drawn while knots are
// introduced and traced is recorded and must not hold the knot's name.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { launch, OUT } from './helpers/browser.js';
import { startStatic, openStation } from './helpers/static.js';

let srv, browser;
before(async () => { srv = await startStatic(); browser = await launch(); });
after(async () => { await browser?.close(); await srv?.stop(); });

test('外賣 screen: the knot\'s name is not drawn, at the intro or while tracing', async () => {
  const page = await openStation(browser, srv.url, { path: '/stations/takeaway.html' });
  await page.evaluate(() => {
    window.__drawn = new Set();
    for (const f of ['fillText', 'strokeText']) {
      const real = CanvasRenderingContext2D.prototype[f];
      CanvasRenderingContext2D.prototype[f] = function (t, ...a) { window.__drawn.add(String(t)); return real.call(this, t, ...a); };
    }
  });
  await page.click('#segDiff button[data-v="rookie"]');
  await page.click('#bDrill');
  const names = new Set(), fams = new Set();
  for (let k = 0; k < 3; k++) {
    await page.waitForFunction(n => window.__station.s && window.__station.s.phase === 'tie' && window.__station.s.drillN === n && window.__station.s.tie, k);
    // the intro, then the trace
    if (k === 0) await page.screenshot({ path: join(OUT, 'stations-takeaway-intro-noname.png') });
    await page.waitForFunction(() => window.__station.s.t > window.__station.s.tie.readyAt + .3);
    const t = await page.evaluate(() => ({ name: window.__station.s.tie.name, fam: window.__station.s.tie.fam }));
    names.add(t.name); fams.add(t.fam);
    // tie it by state so the drill brings the next knot
    await page.evaluate(() => { const s = window.__station.s; s.tie.i = s.tie.n - 1; });
    await page.waitForFunction(n => window.__station.s.ties.length > n, k, { timeout: 8000 }).catch(() => {});
    if (await page.evaluate(n => window.__station.s.ties.length <= n, k)) break;
  }
  const drawn = await page.evaluate(() => [...window.__drawn]);
  assert.ok(drawn.length > 0, 'the screen draws text');
  assert.ok(drawn.some(t => /綁袋|第 \d+ 條/.test(t)), `the intro is drawn: ${drawn.slice(0, 20)}`);
  for (const n of names) assert.ok(!drawn.some(t => t.includes(n)), `the knot's name ${n} was drawn: ${drawn.filter(t => t.includes(n))}`);
  for (const f of fams) assert.ok(!drawn.some(t => t.includes(f)), `the knot's family ${f} was drawn`);
  assert.deepEqual(page.errors, []);
  await page.context().close();
});
