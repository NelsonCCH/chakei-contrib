// The standalone 外賣 page (site/stations/takeaway.html) in a real headless browser, played with real pointer gestures
// (mouse down / move / up through Playwright, so the page's own pointer handlers run): the first slip of a shift is
// packed, tied by tracing the dashed path and handed to its customer at the door; after each step the screen (canvas
// pixels, HUD text) is checked against the state. Silent: headless, --mute-audio, the page's sound stays off.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, OUT } from './helpers/browser.js';
import { startStatic, openStation } from './helpers/static.js';
import { join } from 'node:path';

let srv, browser;
before(async () => { srv = await startStatic(); browser = await launch(); });
after(async () => { await browser?.close(); await srv?.stop(); });

const st = page => page.evaluate(() => JSON.parse(JSON.stringify({ s: window.__station.s, L: window.__station.layout, S: window.__station.S, c: window.__station.canvas() })));
/** The colour of one pixel of the low-res layer, at logical px (x, y). */
const px = (page, x, y) => page.evaluate(([x, y]) => { const d = document.querySelector('#sc canvas.pxl').getContext('2d').getImageData(Math.round(x), Math.round(y), 1, 1).data; return '#' + [d[0], d[1], d[2]].map(v => v.toString(16).padStart(2, '0')).join(''); }, [x, y]);

function finger(page, g) {
  const at = (x, y) => [g.c.left + x * g.S, g.c.top + y * g.S];
  return {
    async tap(x, y) { await page.mouse.move(...at(x, y)); await page.mouse.down(); await page.waitForTimeout(60); await page.mouse.up(); await page.waitForTimeout(120); },
    async drag(x0, y0, x1, y1, steps = 10) { await page.mouse.move(...at(x0, y0)); await page.mouse.down(); for (let i = 1; i <= steps; i++) { await page.mouse.move(...at(x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps)); await page.waitForTimeout(16); } await page.waitForTimeout(80); await page.mouse.up(); await page.waitForTimeout(150); },
    /** Trace css px points (the path's own units) with the button held. */
    async trace(pts, every = 4) { await page.mouse.move(g.c.left + pts[0][0], g.c.top + pts[0][1]); await page.mouse.down(); for (let i = every; i < pts.length; i += every) await page.mouse.move(g.c.left + pts[i][0], g.c.top + pts[i][1]); const e = pts[pts.length - 1]; await page.mouse.move(g.c.left + e[0], g.c.top + e[1]); await page.mouse.up(); },
  };
}
const mid = r => [r.x + r.w / 2, r.y + r.h / 2];
/** Waits for the page to draw the state as it is now (ff() moves the state on between frames). */
const drawn = page => page.evaluate(() => new Promise(r => { requestAnimationFrame(() => { requestAnimationFrame(r); }); }));

test('外賣 page: a slip packed, tied and handed over with real gestures, screen matches state, end card', async () => {
  const page = await openStation(browser, srv.url, { path: '/stations/takeaway.html' });
  await page.click('#segDiff button[data-v="rookie"]');
  await page.click('#bGo');
  await page.waitForFunction(() => window.__station.s);
  assert.equal(await page.evaluate(() => window.__station.sound), false, 'sound stays off');
  // the first slip and all its things on the counter
  await page.evaluate(() => window.__station.ff(8));
  await page.waitForFunction(() => { const s = window.__station.s, o = s.orders[0]; return o && o.items.every(it => s.counter.some(c => c && c.id === it.id && c.enter === 0)); });
  await drawn(page);
  let g = await st(page);
  assert.deepEqual([g.s.view.LW, g.s.view.LH, g.s.view.S], [g.L.LW, g.L.LH, g.S], 'the core lays out the screen the page shows');
  assert.equal(g.s.diff, 'rookie');
  const f = finger(page, g), L = g.L, lift = 30 / g.S, o = g.s.orders[0];
  assert.match(await page.textContent('#hs'), /交咗 0/);

  // the things into the bag, boxes first: each leaves the counter on screen as it goes into the bag in state
  const items = [...o.items].sort((a, b) => (a.kind === 'box' ? 0 : 1) - (b.kind === 'box' ? 0 : 1));
  for (const it of items) {
    g = await st(page);
    const slot = g.s.counter.findIndex(c => c && c.id === it.id), p = L.slots[slot], before = await px(page, p.x, p.y);
    await f.drag(p.x, p.y, L.bag.x + L.bag.w / 2, L.bag.y + L.bag.h / 2 + lift);
    g = await st(page);
    assert.equal(g.s.counter[slot], null, `${it.name} left the counter`);
    assert.ok(g.s.orders[0].items.find(x => x.id === it.id).packed, `${it.name} packed`);
    assert.notEqual(await px(page, p.x, p.y), before, `${it.name} is gone from its place on screen (slot ${slot} at ${p.x},${p.y}; counter ${JSON.stringify(g.s.counter)})`);
  }
  assert.equal(g.s.bag.spills, 0);
  // the extras the slip asks for, tapped from the trays
  const need = { cut: o.people, nap: o.people, str: o.items.filter(i => i.kind === 'drink' && !i.hot).length, sug: o.items.filter(i => i.kind === 'drink' && i.hot && i.mod !== '走甜').length, syr: o.items.filter(i => i.syrup).length };
  for (const [k, n] of Object.entries(need)) for (let i = 0; i < n; i++) await f.tap(...mid(L.trays[k]));
  g = await st(page);
  assert.deepEqual(g.s.bag.ex, need);
  // 綁袋: the tie screen covers the counter
  const counterPx = await px(page, L.counter.x + 4, L.counter.y + 4);
  await f.tap(...mid(L.tieBtn));
  await page.waitForFunction(() => window.__station.s.phase === 'tie' && window.__station.s.t > window.__station.s.tie.readyAt);
  g = await st(page);
  assert.notEqual(await px(page, L.counter.x + 4, L.counter.y + 4), counterPx, 'the tie overlay is up');
  await page.screenshot({ path: join(OUT, 'stations-takeaway-tie.png') });
  // trace the dashed path end to end
  await f.trace(g.L.pts);
  await page.waitForFunction(() => window.__station.s.phase === 'hand', null, { timeout: 5000 });
  g = await st(page);
  assert.equal(g.s.ties.length, 1); assert.ok(g.s.ties[0].time > 0);
  assert.equal(g.s.tie.i, g.s.tie.n - 1);
  // the tied bag to its customer at the door
  const ci = g.L.door.findIndex(c => c.no === o.no);
  await f.drag(...mid(L.bag), g.L.door[ci].cx, L.cust.y + L.cust.h / 2 + lift, 12);
  await page.waitForFunction(() => window.__station.s.results.length === 1);
  g = await st(page);
  assert.equal(g.s.results[0].no, o.no);
  assert.ok(g.s.results[0].stars >= 2, JSON.stringify(g.s.results[0]));
  assert.match(await page.textContent('#hs'), /交咗 1 /, 'the HUD shows the bag handed over');
  await page.screenshot({ path: join(OUT, 'stations-takeaway-handed.png') });

  // the clock to the end: the end card
  await page.evaluate(() => window.__station.ff(200));
  await page.waitForSelector('#ovCard:not([hidden])');
  const card = await page.textContent('#cardBody');
  assert.match(card, /收工！/); assert.match(card, /交咗 1 單/);
  await page.screenshot({ path: join(OUT, 'stations-takeaway-end.png') });
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

test('外賣 page: sloppy traces are refused on screen as in the prototype; the drill mode', async () => {
  const page = await openStation(browser, srv.url, { path: '/stations/takeaway.html' });
  await page.click('#segDiff button[data-v="ace"]');
  await page.click('#bDrill');
  await page.waitForFunction(() => window.__station.s && window.__station.s.phase === 'tie' && window.__station.s.t > window.__station.s.tie.readyAt);
  assert.match(await page.textContent('#hs'), /練綁袋 · 阿姐 · 0 條/);
  let g = await st(page);
  const f = finger(page, g), P = g.L.pts, n = P.length;
  // a press away from 起 starts nothing
  const far = P[Math.floor(n / 2)];
  await page.mouse.move(g.c.left + far[0], g.c.top + far[1]); await page.mouse.down(); await page.mouse.up();
  g = await st(page);
  assert.equal(g.s.tie.i, 0); assert.ok(g.s.msgs.some(m => m.text === '由「起」嗰點開始'));
  // a straight swipe from the start to the end does not tie it
  await f.trace([P[0], P[n - 1]], 1);
  g = await st(page);
  assert.equal(g.s.phase, 'tie'); assert.ok(g.s.tie.i < n - 1);
  // the rest of the path, from the glowing head on, ties it; the drill counts it and brings the next one
  await f.trace(P.slice(g.s.tie.i));
  await page.waitForFunction(() => window.__station.s.ties.length === 1);
  await page.waitForFunction(() => window.__station.s.phase === 'tie' && window.__station.s.drillN === 1, null, { timeout: 5000 });
  assert.match(await page.textContent('#hs'), /練綁袋 · 阿姐 · 1 條/);
  await page.screenshot({ path: join(OUT, 'stations-takeaway-drill.png') });
  assert.deepEqual(page.errors, []);
  await page.context().close();
});
