// 送外賣 multi-bag run on the game page, solo 打風前夕 on a phone (390x844, headless, muted): two bags
// at the door are claimed through the floor (floorWant, the claim path ts-map's 送 bubble will batch), and the run starts
// from that list of claimed bag ids (deliverSetOff); the rider is away with both, drops both and comes back.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { startServer, ROOT } from './helpers/server.js';
import { launch, openGame, veteran, ROLES_LEARNED, ROLES_REACHED, realErrors, shot } from './helpers/browser.js';

const BOTS = readFileSync(join(ROOT, 'tests', 'helpers', 'bots.browser.js'), 'utf8');
let srv, browser;
before(async () => { srv = await startServer(); browser = await launch(); });
after(async () => { await browser?.close(); await srv?.stop(); });

/** Lock-step: up to `sec` game seconds, or until `until` (a page function's source) says yes; `ride` drives the run. */
const run = (page, sec, until, ride = false) => page.evaluate(([sec, until, ride]) => {
  const done = new Function('return (' + until + ')()');
  let now = performance.now();
  for (let i = 0; i < sec / .05 && G.running; i++) {
    if (!G.paused) shiftStep(.05);
    now += 50; coopFrame(now); floorFrame();
    if (ride){ if (i % 3 === 0) deliverBotPress(); deliverDrive(.05); }
    if (done()) return { ok: true, t: G.t };
  }
  return { ok: false, t: G.t };
}, [sec, until, ride]);

test('solo 樓面: two bags claimed at the door ride out in one run, both dropped, the rider back', { timeout: 150000 }, async () => {
  const page = await openGame(browser, srv.url, { storage: veteran('測試員', { ...ROLES_LEARNED, ...ROLES_REACHED }) });
  await page.addScriptTag({ content: BOTS });
  await page.click('#levelBtn');
  await page.click('#lvSt [data-st="waiter"]');
  await page.click('#book [data-lv="typhoon"]');
  await page.waitForFunction(() => G && G.running && G.level === 'typhoon' && G.floor);
  // the shift's clock moves only inside run() (lock-step, Bot.scale 0): the computer's floor seats cannot cover the two
  // bags (COVER_S) between run() and the claims
  await page.evaluate(() => { Bot.stop?.(); Bot.scale = 0; });
  await run(page, 5, '() => false');
  // two bags at the door (the bagging that makes them is the solo-floor journey's)
  await page.evaluate(() => { for (const k of [1, 2]) G.floor.out.push({ gid: 90000 + k, no: 60 + k, cold: G.t + 120, items: 2, rider: null }); });
  const up = await run(page, 2, "() => ['deliver:90001', 'deliver:90002'].every(id => G.floor.tasks.some(t => t.id === id && t.by === null))");
  assert.ok(up.ok, 'both bags show at the door');
  const drops0 = await page.evaluate(() => G.floor.stats.drops);
  const go = await page.evaluate(() => {
    const claimed = [90001, 90002].filter(g => floorWant('deliver:' + g));
    return { claimed, r: deliverSetOff(claimed) };
  });
  assert.deepEqual(go.claimed, [90001, 90002], 'both claims granted (solo: the referee is here)');
  assert.deepEqual(go.r, { st: 'go', gids: [90001, 90002], lost: [] }, 'the run sets off with both bags');
  assert.deepEqual(await page.evaluate(() => G.floor.out.filter(o => o.gid > 90000).map(o => o.rider)), ['me', 'me'], 'both on this rider');
  assert.equal(await page.evaluate(() => deliverState().run.orders.length), 2, 'the station rides a 2-bag run');
  assert.equal(await page.evaluate(() => deliverSetOff([90001, 90002]).st), 'none', 'no second run with bags already on the road');
  await run(page, 1, '() => false', true);
  assert.equal(await page.evaluate(() => G.floor.away.me !== undefined), true, 'the rider is out of the shop');
  assert.equal(await page.evaluate(() => referee().seats.floor1.driver.type), 'player', 'no cover while riding');
  const res = await run(page, 120, '() => deliverHome()', true);
  assert.ok(res.ok, 'the rider came back');
  await run(page, 1, '() => false');
  assert.equal(await page.evaluate(() => G.floor.away.me !== undefined), false, 'back at the shop');
  assert.equal(await page.evaluate(() => G.floor.stats.drops) - drops0, 2, 'both bags dropped off');
  assert.deepEqual(await page.evaluate(() => G.floor.out.filter(o => o.gid > 90000)), [], 'nothing of the run left at the door');
  await shot(page, 'floor-deliver-bags');
  assert.deepEqual(realErrors(page), []);
  await page.context().close();
});
