// The shop map on a 390x666 phone (headless, muted): 伙記 on 打風前夕
// (typhoon, solo: 傳菜 and 外賣 on the floor). Every tap goes through the map with the real pointer: a party waiting
// outside on the pavement is seated by tapping it, then a table; and each kind of work bubble is tapped once at its
// place (「執」 on a dirty table, 「傳」 at the kitchen pass, 「包」 in the takeaway bay, 「送」 at the rider exit), each
// opening its mini-game with that station's work.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { startServer, ROOT } from './helpers/server.js';
import { launch, openGame, veteran, ROLES_LEARNED, ROLES_REACHED, realErrors, shot } from './helpers/browser.js';
import { mapTap } from './helpers/map.js';

const BOTS = readFileSync(join(ROOT, 'tests', 'helpers', 'bots.browser.js'), 'utf8');
const PHONE = { viewport: { width: 390, height: 666 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
let srv, browser;
before(async () => { srv = await startServer(); browser = await launch(); });
after(async () => { await browser?.close(); await srv?.stop(); });

/** Lock-step up to `sec` game seconds or until `until` (a page function's source) says yes; each step keeps the held bags. */
const run = (page, sec, until) => page.evaluate(([sec, until]) => {
  const done = new Function('return (' + until + ')()');
  let now = performance.now();
  for (let i = 0; i < sec / .05 && G.running; i++) {
    if (!G.paused) shiftStep(.05);
    now += 50; coopFrame(now); floorFrame();
    window.holdBag?.();
    if (done()) return true;
  }
  return false;
}, [sec, until]);
/** The test's hand on the referee (core/work/floor.ts claims): it keeps the player's first bags for the 包 and 送 steps. */
const HOLD = '#test:hold';

test('shop map: seat a party from the queue outside, and tap each work bubble once (執 傳 包 送)', { timeout: 180000 }, async () => {
  const page = await openGame(browser, srv.url, { device: PHONE, storage: veteran('測試員', { ...ROLES_LEARNED, ...ROLES_REACHED }) });
  await page.addScriptTag({ content: BOTS });
  await page.click('#levelBtn');
  await page.click('#lvSt [data-st="waiter"]');
  await page.click('#book [data-lv="typhoon"]');
  await page.waitForFunction(() => G && G.running && G.level === 'typhoon' && G.floor);
  // the shift's clock moves only inside run() (lock-step): the page's own frame loop runs at frame time 0 (Bot.scale), so
  // between run() and a tap no game time passes and a computer floor seat (COVER_S) cannot take the item first
  await page.evaluate(() => { Bot.stop?.(); Bot.scale = 0; });
  await page.waitForFunction(() => mapNow() !== null, null, { timeout: 5000 });
  assert.equal(await page.isVisible('#floorJobs button[data-task]:not(.on)'), false, 'no job bar of bubbles while the map is on');

  // the queue is outside, on the pavement past the front wall
  assert.ok(await run(page, 60, "() => G.groups.some(g => g.state === 'queue' && !g.take) && G.tables.some(t => !t.g && !t.dirty)"), 'a party waits outside');
  const gid = await page.evaluate(() => G.groups.find(g => g.state === 'queue' && !g.take).id);
  await page.evaluate(() => { drawFloorIso(performance.now()); });
  const seen = await page.evaluate(g => { const b = mapBubbles().find(x => x.act.k === 'group' && x.act.gid === g), r = FSC.tv.getBoundingClientRect(); return !!b && b.x > 0 && b.x < r.width && b.y > 0 && b.y < r.height; }, gid);
  assert.ok(seen, 'the first view shows the party outside');
  await shot(page, 'map-queue-outside');
  let tap = await mapTap(page, { k: 'group', gid });
  assert.ok(tap.ok, tap.why);
  assert.equal(await page.evaluate(() => G.selected), gid, 'tapping the party outside picks it');
  const tid = await page.evaluate(g => bestTable(byId(g))?.id ?? -1, gid);
  assert.ok(tid >= 0, 'a table fits');
  tap = await mapTap(page, { k: 'table', tid });
  assert.ok(tap.ok, tap.why);
  assert.equal(await page.evaluate(g => byId(g)?.table, gid), tid, 'tapping the table seats the party there');

  // each work bubble once, at its place; the computer's floor seats wait COVER_S, so a fresh one is free to tap.
  // 包 and 送: the floor budget gives the player only part of the bags (per kind, the shift's first, then their share ~0.3:
  // a shift has 3-4 deliveries and ~9 bags, so the first is often the player's only one, or one of two), and the first
  // comes up while the test waits on an earlier step, where the computer covers it after COVER_S. So the test's hand holds
  // the first bag to pack and the first bag to ride that are open to the player, and lets each go at its own step.
  await page.evaluate(h => {
    window.held = {};
    window.holdBag = () => {
      const F = G.floor; if (!F) return;
      window.holdLog ??= {};
      for (const x of F.tasks) if (x.k === 'deliver' && !window.holdLog[x.id]) window.holdLog[x.id] = [+G.t.toFixed(1), x.by];
      for (const kind of ['bag', 'deliver']) {
        const id = window.held[kind];
        if (id === null) continue;   // its step came: no more holding
        if (id !== undefined && taskOf(id)?.by === h) { taskTouch(h, [id]); continue; }   // (gone, a walk-out: hold the next)
        const x = F.tasks.find(y => y.k === kind && y.by === null);
        if (x && taskClaim(h, x.id)) window.held[kind] = x.id;
      }
    };
  }, HOLD);
  // 執: a dirty table with no party ordering at it (a shared table's tap takes the order first: core/stations/waiter.ts
  // tapTable; that table's 執 bubble taps the order, a known flake)
  const CLEAR = "t => t.k === 'clear' && t.by === null && G.tables[Number(t.id.split(':')[1])]?.dirty && !G.groups.some(g => !g.take && g.table === Number(t.id.split(':')[1]) && g.state === 'order')";
  const KINDS = [
    { name: '執', want: { k: 'table' }, game: 'clear', until: `() => G.floor.tasks.some(${CLEAR})` },
    { name: '傳', want: { k: 'spot', spot: 'pass' }, game: 'runner', until: "() => stationCount('carry') > 0" },
    { name: '包', want: { k: 'spot', spot: 'bag' }, game: 'takeaway', until: "() => stationCount('bag') > 0" },
    { name: '送', want: { k: 'spot', spot: 'deliver' }, game: 'deliver', until: "() => stationCount('deliver') > 0" },
  ];
  for (const k of KINDS) {
    const kind = { 包: 'bag', 送: 'deliver' }[k.name];
    if (kind) {
      // the held bag is open to the player again, as it was when it came up
      const held = await page.evaluate(([h, kind]) => { const id = window.held[kind]; window.held[kind] = null; return id && taskRelease(h, id) ? id : null; }, [HOLD, kind]);
      if (held) assert.ok(await page.evaluate(kind => stationCount(kind) > 0, kind), `${k.name}: the held bag is there`);
    }
    const DBG = await page.evaluate(() => JSON.stringify({ t: G.t, held: window.held, tasks: G.floor.tasks.filter(x => x.k === 'bag' || x.k === 'deliver').map(x => [x.id, x.by, +x.at.toFixed(1)]), out: G.floor.out.map(o => [o.gid, o.rider]), acc: G.floor.acc, log: window.holdLog }));
    if (!await run(page, 300, k.until)) assert.fail(`${k.name}: work came up; before ${DBG}; after ${await page.evaluate(() => JSON.stringify({ t: G.t, running: G.running, held: window.held, out: G.floor.out.map(o => [o.gid, o.rider]), acc: G.floor.acc, stats: G.floor.stats, log: window.holdLog }))}`);
    const want = k.want.k === 'table' ? { k: 'table', tid: await page.evaluate(`Number(G.floor.tasks.find(${CLEAR}).id.split(':')[1])`) } : k.want;
    if (k.name === '傳') await shot(page, 'map-pass-bubble');
    tap = await mapTap(page, want);
    assert.ok(tap.ok, `${k.name}: ${tap.why}`);
    // the first tap opens the game: the item is the player's and nothing else ran meanwhile (no retries)
    await page.waitForSelector('#floorGame iframe', { state: 'visible', timeout: 10000 });
    assert.equal(await page.evaluate(() => floorJob()?.game), k.game, `${k.name} opens ${k.game}`);
    assert.equal(await page.evaluate(() => document.getElementById('floorFrame').getAttribute('src')), `stations/${k.game}.html?seat`);
    if (k.game === 'deliver') break;   // out on the road: no 返樓面 (solo-floor plays the run)
    await page.click('#floorBack');
    await page.waitForSelector('#floorWrap', { state: 'visible', timeout: 3000 });
  }
  assert.deepEqual(realErrors(page), []);
  await page.context().close();
});
