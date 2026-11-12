// The shop map's view (once a fit-whole-shop view) on 375x667,
// 390x666 and 430x932 phones, headless and muted: on every main-ladder level (1-7 and 地獄午市) the map opens at one
// fixed scale showing 70% of the shop's fitted width (scale = fitted scale / 0.7), never under MIN_S, on the entrance and
// the waiting party outside; every table's tap target is at least 44 pt square and a tap on an on-screen table's middle
// picks it; with every table calling plus a party queueing, no two bubbles' tap discs overlap and every bubble is either
// on screen or counted by an edge marker; the generated art is the default (code art until the atlas is in), and the
// preview's 試玩 panel switch says what it toggles (樓面畫風：新畫／舊畫).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { startServer, ROOT } from './helpers/server.js';
import { launch, openGame, veteran, ROLES_LEARNED, PHONE, realErrors } from './helpers/browser.js';

const BOTS = readFileSync(join(ROOT, 'tests', 'helpers', 'bots.browser.js'), 'utf8');
const P666 = { ...PHONE, viewport: { width: 390, height: 666 } };
const PHONES = [[375, 667], [390, 666], [430, 932]].map(([width, height]) => ({ ...PHONE, viewport: { width, height } }));
const LEVELS = ['estate', 'central', 'mongkok', 'airport', 'typhoon', 'newyear', 'latenight', 'hell'];
// The generated floor art (site/art/floor.json + floor_0.webp) is not part of this repo: the tests that need it run only
// when it is present (without it the map draws in code art).
const NO_ATLAS = !existsSync(join(ROOT, 'site', 'art', 'floor.json')) && 'needs the art atlas in site/art/';
let srv, browser;
before(async () => { srv = await startServer({ vars: { PLAYTEST: '1' } }); browser = await launch(); });
after(async () => { await browser?.close(); await srv?.stop(); });

async function shift(id, device = P666) {
  const page = await openGame(browser, srv.url, { device, storage: veteran('測試員', { ...ROLES_LEARNED }) });
  await page.addScriptTag({ content: BOTS });
  await page.evaluate(() => { setPtAllRoles(true); buildMenus(); });
  await page.click('#levelBtn');
  await page.click('#lvSt [data-st="waiter"]');
  if (id === 'hell') await page.click('[data-lvt="hell"]');
  await page.click(`#book [data-lv="${id}"]`);
  await page.waitForFunction(lv => G && G.running && G.level === lv && mapNow() !== null, id);
  await page.evaluate(() => { Bot.stop?.(); Bot.scale = 0; });
  return page;
}

test('the map opens at 70% of the shop width on the entrance at 375, 390 and 430 wide; markers count every bubble off screen', { timeout: 420000, skip: NO_ATLAS }, async () => {
  for (const device of PHONES) for (const id of LEVELS) {
    const at = `${id} ${device.viewport.width}x${device.viewport.height}`;
    const page = await shift(id, device);
    assert.equal(await page.evaluate(() => floorArt()), 'all', `${at}: the generated art is the default`);
    // until a party waits outside (the computer's floor seat may seat the first ones)
    await page.evaluate(() => { for (let i = 0; i < 1200 && G.running; i++) { if (!G.paused) shiftStep(.05); coopFrame(performance.now() + i * 50); floorFrame(); if (G.groups.some(g => g.state === 'queue' && !g.take)) break; } });
    await page.waitForFunction(() => { drawFloorIso(performance.now()); return floorArtShown(); }, null, { timeout: 10000 });
    const r = await page.evaluate(() => {
      drawFloorIso(performance.now());
      const L = mapNow(), W = FSC.W, H = FSC.H, on = b => b.x >= 0 && b.x <= W && b.y >= 0 && b.y <= H;
      const door = mapToScreen(L.W, (L.door[0] + L.door[1]) / 2, 40);
      const hits = FSC.hits.filter(b => b.x >= 0 && b.y >= 0 && b.x + b.w <= W && b.y + b.h <= H).map(b => b.tid);
      return {
        S: FSC.S, fit: fitScale(L, W, H), view: viewScale(L, W, H), min: MIN_S, fits: mapFits(), tables: L.tables.length, hits: FSC.hits.length,
        small: FSC.hits.filter(b => b.w < TAP - 0.5 || b.h < TAP - 0.5).map(b => b.tid),
        queue: G.groups.filter(g => g.state === 'queue' && !g.take).length,
        qOut: mapBubbles().filter(b => b.act.k === 'group' && !on(b)).length,
        qShown: mapBubbles().filter(b => b.act.k === 'group').length,
        doorIn: door.x > 0 && door.x < W && door.y > 0 && door.y < H,
        doorList: !!document.getElementById('doorWrap').offsetParent,   // the queue list under the map is gone
        // each on-screen table's middle taps that table
        taps: L.tables.filter(t => hits.includes(t.tid)).filter(t => { const p = mapToScreen(t.u, t.v, 20), a = mapHit(p.x, p.y); return !(a && (a.k !== 'table' || a.tid === t.tid)); }).map(t => t.tid),
      };
    });
    assert.ok(Math.abs(r.S - r.view) < 1e-9 && Math.abs(r.S * 0.7 - r.fit) < 1e-6, `${at}: the scale is the fitted scale / 0.7 (S ${r.S}, fit ${r.fit})`);
    assert.equal(r.fits, false, `${at}: 30% of the shop is off screen, a swipe away`);
    assert.ok(r.S >= r.min, `${at}: never under the minimum scale`);
    assert.equal(r.hits, r.tables, `${at}: a hit box per table`);
    assert.ok(r.tables <= 8, `${at}: at most 8 tables`);
    assert.equal(r.doorList, false, `${at}: no queue list under the map`);
    assert.ok(r.doorIn, `${at}: the map opens on the entrance`);
    assert.deepEqual(r.small, [], `${at}: every table's tap target at least 44 pt`);
    assert.deepEqual(r.taps, [], `${at}: a tap on a table's middle picks that table (or its bubble)`);
    if (r.queue) { assert.ok(r.qShown > 0, `${at}: the queue outside has its bubbles`); assert.equal(r.qOut, 0, `${at}: the queue outside is on screen`); }
    // every table calling at once plus a party queueing: discs apart, every bubble on screen or on a marker
    const c = await page.evaluate(() => {
      G.groups.length = 0; for (const t of G.tables) t.dirty = 0;
      for (const tb of G.tables) { const g = byId(Bot.inject(tb.cap)); g.state = 'order'; g.table = tb.id; g.until = G.t + 60; g.max = 60; g.taken = false; }
      Bot.inject(2);
      drawFloorIso(performance.now());
      const W = FSC.W, H = FSC.H, bs = mapBubbles(), ms = mapMarkers(), key = a => JSON.stringify(a);
      const marked = new Set(ms.flatMap(m => m.acts.map(key)));
      let overlaps = 0;
      for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) if (Math.hypot(bs[i].x - bs[j].x, bs[i].y - bs[j].y) < bs[i].r + bs[j].r - 0.5) overlaps++;
      let mOver = 0;
      for (let i = 0; i < ms.length; i++) for (let j = i + 1; j < ms.length; j++) { const a = ms[i], b = ms[j]; if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) mOver++; }
      return { bubbles: bs.length, calls: G.tables.length + 1, overlaps, mOver, minDisc: Math.min(...bs.map(b => 2 * b.r)), lost: bs.filter(b => !(b.x >= 0 && b.x <= W && b.y >= 0 && b.y <= H) && !marked.has(key(b.act))).map(b => key(b.act)) };
    });
    assert.ok(c.bubbles >= c.calls, `${at}: a bubble for every calling table and the queue (${c.bubbles} of ${c.calls})`);
    assert.equal(c.overlaps, 0, `${at}: no two tap discs overlap with every party calling`);
    assert.ok(c.minDisc >= 48, `${at}: tap discs at least 48 pt`);
    assert.deepEqual(c.lost, [], `${at}: every bubble off screen has an edge marker`);
    assert.equal(c.mOver, 0, `${at}: markers do not overlap`);
    assert.deepEqual(realErrors(page), [], `${at}: no page errors`);
    await page.context().close();
  }
});

test('the first frame draws in code art before the atlas is in; the 試玩 switch reads 樓面畫風：新畫／舊畫', { timeout: 60000, skip: NO_ATLAS }, async () => {
  const page = await openGame(browser, srv.url, { device: P666, storage: veteran('測試員', { ...ROLES_LEARNED }), init: () => {
    // hold the atlas back until the test lets it through
    const real = window.fetch; window.__atlasGo = null;
    window.fetch = (u, o) => String(u).includes('art/floor.json') ? new Promise(ok => { window.__atlasGo = () => ok(real(u, o)); }) : real(u, o);
  } });
  await page.addScriptTag({ content: BOTS });
  await page.evaluate(() => { setPtAllRoles(true); buildMenus(); });
  await page.click('#levelBtn');
  await page.click('#lvSt [data-st="waiter"]');
  await page.click('#book [data-lv="central"]');
  await page.waitForFunction(() => G && G.running && mapNow() !== null);
  const first = await page.evaluate(() => { drawFloorIso(performance.now()); return { art: floorArt(), shown: floorArtShown(), hits: FSC.hits.length, asked: typeof window.__atlasGo === 'function' }; });
  assert.deepEqual(first, { art: 'all', shown: false, hits: 8, asked: true }, 'code art draws (with its tap targets) while the atlas loads');
  await page.evaluate(() => window.__atlasGo());
  await page.waitForFunction(() => { drawFloorIso(performance.now()); return floorArtShown(); }, null, { timeout: 10000 });
  // the preview's switch
  await page.click('#ptBtn');
  const sw = page.locator('#ptPanel [data-pt="floorart"]');
  assert.match(await sw.textContent(), /^樓面畫風：新畫/);
  await sw.click();
  assert.equal(await page.evaluate(() => floorArt()), 'code');
  assert.match(await page.locator('#ptPanel [data-pt="floorart"]').textContent(), /^樓面畫風：舊畫/);
  assert.equal(await page.evaluate(() => { drawFloorIso(performance.now()); return floorArtShown(); }), false, 'old art on the switch');
  assert.equal(await page.evaluate(() => localStorage.getItem('ckf_pt_floorart2')), 'code');
  assert.deepEqual(realErrors(page), []);
  await page.context().close();
});
