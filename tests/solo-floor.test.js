// 樓面 solo on a phone (390x844, headless, muted): 伙記 on 打風前夕 (typhoon) is the floor's first
// player, the computer has the other two floor seats. One journey per floor mini-game: a dirty table's 執 bubble on the
// shop map is cleared in 執枱 (its pieces tapped off on the station screen), and a bag at the door is ridden out in 送外賣 (lane
// swipes and the gear on the road) until the rider is back; each changes the shop the way the floor says.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { startServer, ROOT } from './helpers/server.js';
import { launch, openGame, veteran, ROLES_LEARNED, ROLES_REACHED, realErrors, shot } from './helpers/browser.js';
import { mapTap } from './helpers/map.js';

const BOTS = readFileSync(join(ROOT, 'tests', 'helpers', 'bots.browser.js'), 'utf8');
let srv, browser;
before(async () => { srv = await startServer(); browser = await launch(); });
after(async () => { await browser?.close(); await srv?.stop(); });

async function floorShift() {
  const page = await openGame(browser, srv.url, { storage: veteran('測試員', { ...ROLES_LEARNED, ...ROLES_REACHED }) });
  await page.addScriptTag({ content: BOTS });
  await page.click('#levelBtn');
  await page.click('#lvSt [data-st="waiter"]');
  await page.click('#book [data-lv="typhoon"]');
  await page.waitForFunction(() => G && G.running && G.level === 'typhoon' && G.floor);
  // the shift's clock moves only inside run() (lock-step): the page's own frame loop runs at frame time 0 (Bot.scale), so
  // no game time passes between run() and a tap, and a computer floor seat (COVER_S) cannot take the item meanwhile
  await page.evaluate(() => { Bot.stop?.(); Bot.scale = 0; });
  return page;
}
/** Lock-step: up to `sec` game seconds, or until `until` (a page function's source) says yes; `press` each 3rd step. */
const run = (page, sec, until, press = '') => page.evaluate(([sec, until, press]) => {
  const done = new Function('return (' + until + ')()'), pr = press ? new Function('return ' + press)() : null;
  let now = performance.now();
  for (let i = 0; i < sec / .05 && G.running; i++) {
    if (!G.paused) shiftStep(.05);
    now += 50; coopFrame(now); floorFrame();
    if (pr && i % 3 === 0) pr();
    if (done()) return { ok: true, t: G.t };
  }
  return { ok: false, t: G.t };
}, [sec, until, press]);

test('solo 樓面: 伙記 on typhoon is floor1; the 執 bubble of a dirty table on the map opens 執枱', { timeout: 120000 }, async () => {
  const page = await floorShift();
  const seats = await page.evaluate(() => Object.values(referee().seats).filter(s => s.kind === 'floor').map(s => [s.id, s.driver.type]));
  assert.deepEqual(seats, [['floor1', 'player'], ['floor2', 'computer'], ['floor3', 'computer']]);
  assert.equal(await page.evaluate(() => G.roles.floor), 'me');
  assert.equal(await page.isVisible('#floorWrap'), true);
  // a dirty table shows up as a bubble (claim it before the computer does: it waits COVER_S)
  // (still dirty: a worker that just cleaned one lets its task go a frame before the list drops it)
  // (and no party ordering at that table: a shared table's tap takes the order first, core/stations/waiter.ts tapTable)
  const open = "t => t.k === 'clear' && t.by === null && G.tables[Number(t.id.split(':')[1])]?.dirty && !G.groups.some(g => !g.take && g.table === Number(t.id.split(':')[1]) && g.state === 'order')";
  const r = await run(page, 240, `() => G.floor.tasks.some(t => (${open})(t) && G.t - t.free < 2)`);
  assert.ok(r.ok, 'a dirty table came up');
  await run(page, 0.2, '() => false');
  const id = await page.evaluate(`G.floor.tasks.find(${open}).id`);
  const table = Number(id.split(':')[1]);
  // its 執 bubble on the shop map
  const tap = await mapTap(page, { k: 'table', tid: table });
  assert.ok(tap.ok, tap.why);
  await page.waitForSelector('#floorGame iframe', { state: 'visible' });
  assert.equal(await page.evaluate(() => document.getElementById('floorFrame').getAttribute('src')), 'stations/clear.html?seat');
  const f = page.frameLocator('#floorFrame');
  await f.locator('canvas').first().waitFor();
  await run(page, 0.5, '() => false');
  await shot(page, 'solo-floor-clear');
  const mess = await page.evaluate(() => clearState().tables[0]?.items.length ?? 0);
  assert.ok(mess > 0, 'the table is laid out on the station');
  // the player's taps (the station's bot pressing through the same commands) clear it
  const res = await run(page, 60, `() => !G.tables[${table}].dirty`, 'clearBotPress');
  assert.ok(res.ok, 'the table is clean');
  await run(page, 0.5, '() => false');
  assert.equal(await page.evaluate(() => floorJob()), null, 'the job ended with its task');
  assert.equal(await page.isVisible('#floorWrap'), true, 'back on the floor');
  assert.ok(await page.evaluate(() => clearState().sess.tables) >= 1);
  assert.deepEqual(realErrors(page), []);
  await page.context().close();
});

test('solo 樓面: a bag at the door is ridden out in 送外賣; the rider is away, drops it hot, comes back', { timeout: 150000 }, async () => {
  const page = await floorShift();
  const r = await run(page, 300, "() => G.floor.tasks.some(t => t.k === 'deliver' && t.by === null)");
  assert.ok(r.ok, 'a bag came to the door');
  const id = await page.evaluate(() => G.floor.tasks.find(t => t.k === 'deliver' && t.by === null).id);
  const drops0 = await page.evaluate(() => G.floor.stats.drops);
  // the 「送」 bubble at the rider exit: the bags at the door, up to a run
  const tap = await mapTap(page, { k: 'spot', spot: 'deliver' });
  assert.ok(tap.ok, tap.why);
  await page.waitForSelector('#floorGame iframe', { state: 'visible' });
  assert.ok((await page.evaluate(() => floorJob().ids)).includes(id), 'the oldest bag is in the run');
  assert.equal(await page.evaluate(() => document.getElementById('floorFrame').getAttribute('src')), 'stations/deliver.html?seat');
  await page.frameLocator('#floorFrame').locator('canvas').first().waitFor();
  await run(page, 1, '() => false');
  assert.equal(await page.evaluate(() => G.floor.away.me !== undefined), true, 'the rider is out of the shop');
  assert.equal(await page.evaluate(() => referee().seats.floor1.driver.type), 'player', 'no cover while riding');
  assert.equal(await page.isHidden('#floorBack'), true, 'no 返樓面 on the road');
  await run(page, 6, '() => false', 'deliverBotPress');
  await shot(page, 'solo-floor-deliver');
  const res = await run(page, 90, '() => floorJob() === null', 'deliverBotPress');
  assert.ok(res.ok, `the rider came back (bag at ${r.t.toFixed(1)} s, now ${res.t.toFixed(1)} s)`);
  assert.equal(await page.evaluate(() => G.floor.away.me !== undefined), false);
  assert.ok(await page.evaluate(() => G.floor.stats.drops) > drops0, 'the order was dropped off');
  assert.equal(await page.isVisible('#floorWrap'), true);
  assert.deepEqual(realErrors(page), []);
  await page.context().close();
});
