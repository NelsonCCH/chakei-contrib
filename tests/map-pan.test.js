// Panning the shop map and its edge markers (replaces an older zoom test) on a 390x666 phone,
// headless and muted: the level opens at the fixed 70% view on the entrance; a one-finger swipe pans (clamped to the
// shop) and never fires a tap, even when it starts on a bubble; a second finger neither zooms nor taps; with every table
// calling, a tap on an edge marker pans its bubbles onto the screen; a party and a table are tapped with the real pointer
// after a pan; a new shift opens at the opening view again.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { startServer, ROOT } from './helpers/server.js';
import { launch, openGame, veteran, ROLES_LEARNED, ROLES_REACHED, realErrors, shot } from './helpers/browser.js';
import { mapTap } from './helpers/map.js';
import { go } from './helpers/intro.js';

const BOTS = readFileSync(join(ROOT, 'tests', 'helpers', 'bots.browser.js'), 'utf8');
const PHONE = { viewport: { width: 390, height: 666 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
let srv, browser;
before(async () => { srv = await startServer(); browser = await launch(); });
after(async () => { await browser?.close(); await srv?.stop(); });

/** Lock-step up to `sec` game seconds or until `until` (a page function's source) says yes. */
const run = (page, sec, until) => page.evaluate(([sec, until]) => {
  const done = new Function('return (' + until + ')()');
  let now = performance.now();
  for (let i = 0; i < sec / .05 && G.running; i++) {
    if (!G.paused) shiftStep(.05);
    now += 50; coopFrame(now); floorFrame();
    if (done()) return true;
  }
  return false;
}, [sec, until]);
/** The view now: scale, the scale rule's value, and the entrance's and the first table's canvas points. */
const view = page => page.evaluate(() => {
  drawFloorIso(performance.now());
  const L = mapNow(), t = L.tables[0];
  return { S: FSC.S, want: viewScale(L, FSC.W, FSC.H), fits: mapFits(), door: mapToScreen(L.W, (L.door[0] + L.door[1]) / 2, 40), t0: mapToScreen(t.u, t.v), W: FSC.W, H: FSC.H };
});
/** A one-finger swipe with the real pointer from page point (x, y) by (dx, dy). */
async function swipe(page, x, y, dx, dy) {
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 8 }); await page.mouse.up();
}
const canvasMid = page => page.evaluate(() => { const b = FSC.tv.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, left: b.left, top: b.top }; });

test('shop map: opens on the entrance at the 70% view, swipes pan without tapping, markers pan to their bubbles, a new shift resets', { timeout: 240000 }, async () => {
  const page = await openGame(browser, srv.url, { device: PHONE, storage: veteran('測試員', { ...ROLES_LEARNED, ...ROLES_REACHED }) });
  await page.addScriptTag({ content: BOTS });
  await page.click('#levelBtn');
  await page.click('#lvSt [data-st="waiter"]');
  await go(page, '#book [data-lv="typhoon"]');
  await page.waitForFunction(() => G && G.running && G.level === 'typhoon' && mapNow() !== null);
  await page.evaluate(() => { Bot.stop?.(); Bot.scale = 0; });

  // the opening view
  const v0 = await view(page);
  assert.ok(Math.abs(v0.S - v0.want) < 1e-9, 'the fixed view scale');
  assert.equal(v0.fits, false, 'part of the shop is off screen');
  assert.ok(v0.door.x > 0 && v0.door.x < v0.W && v0.door.y > 0 && v0.door.y < v0.H, `the map opens on the entrance (${JSON.stringify(v0.door)})`);
  assert.equal(await page.evaluate(() => getComputedStyle(FSC.tv).touchAction), 'none', 'the page does not pinch-zoom or scroll from the map');

  // a swipe pans, clamped to the shop: right (toward the booths) moves the floor right, a long one stops at the edge
  const m = await canvasMid(page);
  await swipe(page, m.x, m.y, 40, 0);
  let v = await view(page);
  assert.ok(Math.abs(v.t0.x - v0.t0.x - 40) < 1, `a swipe pans the map with the finger (${v0.t0.x} -> ${v.t0.x})`);
  assert.ok(Math.abs(v.S - v0.S) < 1e-9, 'a swipe does not change the scale');
  await swipe(page, m.x - 150, m.y, 300, 0);
  const vEdge = await view(page);
  await swipe(page, m.x - 150, m.y, 300, 0);
  v = await view(page);
  assert.ok(Math.abs(v.t0.x - vEdge.t0.x) < 0.5, 'the pan stops at the shop\'s edge');
  await shot(page, 'map-pan-left-edge');

  // a party waits outside: back to the opening side, then a swipe that starts on its bubble does not pick it
  assert.ok(await run(page, 60, "() => G.groups.some(g => g.state === 'queue' && !g.take) && G.tables.some(t => !t.g && !t.dirty)"), 'a party waits outside');
  await swipe(page, m.x + 150, m.y, -300, 0);
  const gid = await page.evaluate(() => G.groups.find(g => g.state === 'queue' && !g.take).id);
  const qb = await page.evaluate(id => { drawFloorIso(performance.now()); const b = mapBubbles().find(x => x.act.k === 'group' && x.act.gid === id), r = FSC.tv.getBoundingClientRect(); return b && { x: r.left + b.x, y: r.top + b.y }; }, gid);
  assert.ok(qb, 'the party outside has its bubble on screen');
  await swipe(page, qb.x, qb.y, -40, 0);
  assert.equal(await page.evaluate(() => G.selected), null, 'a swipe that starts on a bubble does not tap it');

  // a second finger neither zooms nor taps
  const S1 = (await view(page)).S;
  await page.evaluate(() => {
    const r = FSC.tv.getBoundingClientRect(), cy = r.top + r.height / 2;
    const ev = (type, id, x, primary) => FSC.tv.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', isPrimary: primary, clientX: x, clientY: cy, bubbles: true, cancelable: true }));
    ev('pointerdown', 31, r.left + 150, true); ev('pointerdown', 32, r.left + 200, false);
    for (let i = 1; i <= 5; i++) { ev('pointermove', 31, r.left + 150 - i * 2, true); ev('pointermove', 32, r.left + 200 + i * 20, false); }
    ev('pointerup', 32, r.left + 300, false); ev('pointerup', 31, r.left + 140, true);
  });
  assert.equal((await view(page)).S, S1, 'two fingers do not zoom');
  assert.equal(await page.evaluate(() => G.selected), null, 'two fingers do not tap');

  // after the pans: tap the party outside, then a table, with the real pointer
  let tap = await mapTap(page, { k: 'group', gid });
  assert.ok(tap.ok, tap.why);
  assert.equal(await page.evaluate(() => G.selected), gid, 'tapping the party outside picks it');
  const tid = await page.evaluate(g => bestTable(byId(g))?.id ?? -1, gid);
  tap = await mapTap(page, { k: 'table', tid });
  assert.ok(tap.ok, tap.why);
  assert.equal(await page.evaluate(g => byId(g)?.state !== 'queue', gid), true, 'tapping a table seats the party');

  // every table calling: from the opening side the far booths are off screen; a marker tap brings them on
  await swipe(page, m.x + 150, m.y, -300, 0);
  const mk = await page.evaluate(() => {
    G.groups.length = 0; for (const t of G.tables) t.dirty = 0;
    for (const tb of G.tables) { const g = byId(Bot.inject(tb.cap)); g.state = 'order'; g.table = tb.id; g.until = G.t + 60; g.max = 60; g.taken = false; }
    drawFloorIso(performance.now());
    const W = FSC.W, H = FSC.H, ms = mapMarkers(), r = FSC.tv.getBoundingClientRect();
    const off = mapBubbles().filter(b => !(b.x >= 0 && b.x <= W && b.y >= 0 && b.y <= H)).map(b => JSON.stringify(b.act));
    const m0 = ms[0];
    return { off, marks: ms.map(x => x.acts.map(a => JSON.stringify(a))), at: m0 && { x: r.left + m0.x + m0.w / 2, y: r.top + m0.y + m0.h / 2 }, acts: m0 ? m0.acts.map(a => JSON.stringify(a)) : [] };
  });
  assert.ok(mk.off.length > 0 && mk.at, `bubbles off screen and a marker for them (${JSON.stringify(mk)})`);
  assert.deepEqual(mk.marks.flat().sort(), [...mk.off].sort(), 'the markers stand for exactly the bubbles off screen');
  await shot(page, 'map-pan-markers');
  const sel0 = await page.evaluate(() => G.selected);
  await page.mouse.click(mk.at.x, mk.at.y);
  const after = await page.evaluate(acts => {
    drawFloorIso(performance.now());
    const W = FSC.W, H = FSC.H;
    return acts.map(a => { const b = mapBubbles().find(x => JSON.stringify(x.act) === a); return !!b && b.x >= 0 && b.x <= W && b.y >= 0 && b.y <= H; });
  }, mk.acts);
  assert.ok(after.every(Boolean), `a marker tap pans its bubbles onto the screen (${JSON.stringify(after)})`);
  assert.equal(await page.evaluate(() => G.selected), sel0, 'a marker tap only pans');
  await shot(page, 'map-pan-after-marker');

  // a new shift opens at the opening view again
  await page.evaluate(() => { for (let i = 0; i < 6000 && G.running; i++) { if (!G.paused) shiftStep(.05); coopFrame(performance.now() + i * 50); floorFrame(); } });
  await go(page, '#againBtn');
  await page.waitForFunction(() => G && G.running && mapNow() !== null);
  await page.evaluate(() => { Bot.stop?.(); Bot.scale = 0; });
  const v2 = await view(page);
  // the same view (vertically about the canvas middle: the canvas may be a little taller or shorter on the next shift)
  assert.ok(Math.abs(v2.door.x - v0.door.x) < 1 && Math.abs(v2.door.y - v2.H / 2 - (v0.door.y - v0.H / 2)) < 1, `a new shift opens at the opening view (${JSON.stringify(v0)} vs ${JSON.stringify(v2)})`);

  assert.deepEqual(realErrors(page), []);
  await page.context().close();
});
