// The standalone 燒味 page (site/stations/roast.html) in a real headless browser. A 叉燒飯 is made end to end with real
// pointer gestures (Playwright mouse): the base, the roast, 斬料 by slicing down each dashed guide, the plate, the
// soy and the serve; the board is screenshot at phone size before and after the cuts. The top tier's long roast is
// checked to fit the board with its numbers. Silent: headless, --mute-audio, the page's sound stays off.
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
const px = (page, x, y) => page.evaluate(([x, y]) => { const d = document.querySelector('#shop canvas.pxl').getContext('2d').getImageData(Math.round(x), Math.round(y), 1, 1).data; return '#' + [d[0], d[1], d[2]].map(v => v.toString(16).padStart(2, '0')).join(''); }, [x, y]);

function finger(page, g) {
  const at = (x, y) => [g.c.left + x * g.S, g.c.top + y * g.S];
  return {
    async tap(x, y) { await page.mouse.move(...at(x, y)); await page.mouse.down(); await page.waitForTimeout(60); await page.mouse.up(); await page.waitForTimeout(120); },
    async drag(x0, y0, x1, y1, steps = 10) { await page.mouse.move(...at(x0, y0)); await page.mouse.down(); for (let i = 1; i <= steps; i++) { await page.mouse.move(...at(x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps)); await page.waitForTimeout(16); } await page.mouse.up(); await page.waitForTimeout(150); },
  };
}
const guides = b => Array.from({ length: b.n }, (_, i) => b.x0 + (i + 1) * b.w);

test('燒味 page: a 叉燒飯 cut by slicing down each dashed guide; no rhythm, no calibration; even pieces on screen', async () => {
  const page = await openStation(browser, srv.url, { path: '/stations/roast.html' });
  // the rhythm's calibration and sound offer are gone
  for (const id of ['#bCal', '#bCal2', '#ovCal', '#sndAsk']) assert.equal(await page.$(id), null, `${id} removed`);
  assert.match(await page.textContent('#ovStart'), /虛線/);
  await page.click('#segDiff button[data-v="rookie"]');
  assert.match(await page.textContent('#diffHelp'), /虛線成條/);
  await page.click('#bGo');
  await page.waitForFunction(() => window.__station.s && window.__station.s.q.length > 0);
  let g = await st(page);
  assert.equal(g.s.diff, 'rookie'); assert.equal(g.s.tier, 0);
  assert.equal(g.s.q[0].ord.name, '叉燒飯', 'the first order is always a plain 叉燒飯');
  assert.deepEqual([g.s.view.LW, g.s.view.LH, g.s.view.S], [g.L.LW, g.L.LH, g.S], 'the core lays out the screen the page shows');
  assert.equal(await page.evaluate(() => window.__station.sound), false, 'sound stays off');
  const f = finger(page, g), L = g.L, mid = r => [r.x + r.w / 2, r.y + r.h / 2];
  // the green header is slim and the board has the room
  const hud = await page.evaluate(() => document.getElementById('hud').getBoundingClientRect().height);
  assert.ok(hud <= 34, `header ${hud} px`);
  assert.ok(L.board.h >= 68, `board ${L.board.h} logical px`);

  await f.tap(...mid(L.bases.rice));
  const hook = L.hooks.find(h => h.k === 'char');
  await f.drag(hook.x, L.rail.y + L.rail.h / 2, ...mid(L.board));
  await page.waitForFunction(() => window.__station.s.board && window.__station.s.board.drop <= 0);
  g = await st(page);
  const b = g.s.board, gs = guides(b), top = L.meatCy - b.h / 2, bot = L.meatCy + b.h / 2;
  assert.equal(b.k, 'char'); assert.equal(b.n, 6);
  await page.waitForTimeout(250);
  await page.screenshot({ path: join(OUT, 'stations-roast-cut-before.png') });
  // slice each guide from the top, the knife a pixel off the line (inside the snap): every cut lands on its guide
  for (const [i, x] of gs.entries()) await f.drag(x + (i % 2 ? 0.8 : -0.8), top + 2, x + (i % 2 ? 0.8 : -0.8), bot + 3, 16);
  g = await st(page);
  assert.deepEqual(g.s.board.cuts, gs, `cuts ${g.s.board.cuts}`);
  assert.equal(g.s.board.x0, b.x0, 'the roast has not moved');
  assert.equal(g.s.cleanCuts, 6);
  await page.waitForTimeout(250);
  await page.screenshot({ path: join(OUT, 'stations-roast-cut-after.png') });
  // the cut pieces lie on the board where they were cut: most of the row through piece 3 is not the bare board colour
  const row = [];
  for (let k = 0; k < 9; k++) row.push(await px(page, (gs[1] + gs[2]) / 2, L.meatCy - 4 + k * b.h * 0.12));
  assert.ok(row.filter(c => c !== '#d9a866').length >= 5, `the roast lies on the board: ${row}`);

  // the pieces onto the plate
  await f.drag((b.x0 + gs[5]) / 2, L.meatCy + b.h * 0.3, L.plate.cx, L.plate.cy, 12);
  g = await st(page);
  assert.equal(g.s.board, null);
  assert.equal(g.s.plate.items[0].widths.length, 6);
  // soy, held into the green band (the gauge shows above the plate, clear of the finger), then swipe up
  await page.mouse.move(g.c.left + (L.soy.x + L.soy.w / 2) * g.S, g.c.top + (L.soy.y + L.soy.h / 2) * g.S); await page.mouse.down(); await page.waitForTimeout(700);
  await page.screenshot({ path: join(OUT, 'stations-roast-soy.png') });
  await page.waitForTimeout(300); await page.mouse.up(); await page.waitForTimeout(100);
  g = await st(page);
  assert.ok(g.s.plate.soy >= 0.42 && g.s.plate.soy <= 0.85, `soy ${g.s.plate.soy}`);
  await f.drag(L.plate.cx, L.plate.cy, L.plate.cx, L.plate.cy - 25, 6);
  await page.waitForFunction(() => window.__station.s.served === 1);
  g = await st(page);
  assert.equal(g.s.starsSum, 3, `stars ${g.s.starsSum}: ${JSON.stringify(g.s.orders)}`);

  await page.evaluate(() => window.__station.ff(200));
  await page.waitForSelector('#ovCard:not([hidden])');
  const card = await page.textContent('#cardBody');
  assert.match(card, /收檔/); assert.match(card, /出咗 1 碟/); assert.match(card, /靚刀 6\/6/); assert.doesNotMatch(card, /拍子/);
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

test('燒味 page: the top tier\'s 10-piece 叉燒 fits the board, with no guides and no numbers', async () => {
  const page = await openStation(browser, srv.url, { path: '/stations/roast.html' });
  await page.click('#segDiff button[data-v="ace"]');
  await page.click('#segTier button[data-v="3"]');
  await page.click('#bGo');
  await page.waitForFunction(() => window.__station.s && window.__station.s.q.length > 0);
  const g = await st(page), f = finger(page, g), L = g.L;
  assert.equal(g.s.tier, 3);
  await f.drag(L.hooks.find(h => h.k === 'char').x, L.rail.y + L.rail.h / 2, L.board.x + 60, L.board.y + 20);
  await page.waitForFunction(() => window.__station.s.board && window.__station.s.board.drop <= 0);
  const b = (await st(page)).s.board;
  assert.equal(b.n, 10);
  assert.ok(b.x1 <= L.board.x + L.board.w - 2, `the roast fits the board: ${b.x0}..${b.x1} in ${L.board.x}..${L.board.x + L.board.w}`);
  await page.waitForTimeout(250);
  await page.screenshot({ path: join(OUT, 'stations-roast-cut-top.png') });
  assert.deepEqual(page.errors, []);
  await page.context().close();
});
