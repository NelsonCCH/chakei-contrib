// Single player, long sessions: many shifts in a row through the real menus (next / again / home), and one very long
// shift. Nothing may throw, the invariants (no NaN money, no negative counts, every group in a valid state, timers
// advance) hold every few seconds, and DOM nodes / memory / bookkeeping do not grow without bound.
import { go } from './helpers/intro.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers/server.js';
import { launch, realErrors } from './helpers/browser.js';
import { openSingle, startShift, run, runToEnd, state, assertClean, endless, ALL_RECIPES } from './helpers/single.js';

let srv, browser;
before(async () => { srv = await startServer(); browser = await launch(); });
after(async () => { await browser?.close(); await srv?.stop(); });

const footprint = page => page.evaluate(() => ({
  nodes: document.querySelectorAll('*').length,
  fx: document.getElementById('fx').children.length,
  grp: grpEls.size,
  tickets: document.querySelectorAll('.ticket').length,
  float: document.querySelectorAll('.float').length,
  body: document.body.children.length,
  heap: performance.memory ? performance.memory.usedJSHeapSize : 0,
  errLog: (G.errLog || []).length,
  groups: G.groups.length, payQ: G.payQ.length,
}));

test('a long run of shifts through next / again / home with the computer players slipping up as usual: no errors, no leaks', async () => {
  const page = await openSingle(browser, srv.url, { shop: { stars: 60, recipes: ALL_RECIPES } });
  const plan = [
    ['waiter', 'breakfast', 'pro'], ['kitchen', 'lunch', 'ace'], ['bar', 'dinner', 'rookie'], ['till', 'lunch', 'pro'],
    ['waiter', 'dinner', 'ace'], ['kitchen', 'breakfast', 'rookie'], ['bar', 'lunch', 'ace'], ['till', 'dinner', 'rookie'],
    ['waiter', 'lunch', 'rookie'], ['kitchen', 'dinner', 'pro'], ['bar', 'breakfast', 'pro'], ['till', 'breakfast', 'ace'],
  ];
  const fp = [];
  let first = true;
  for (const [station, slot, diff] of plan) {
    await page.evaluate(() => Bot.reset());
    if (first) { await startShift(page, { station, slot, diff }); first = false; }
    else {
      await page.click('#homeBtn');
      await startShift(page, { station, slot, diff });
    }
    await page.evaluate(() => { CFG.aiErr = .12; CFG.aiBarErr = .05; CFG.aiKitErr = .04; });   // the real, imperfect computer players
    await runToEnd(page);
    assert.equal(await page.evaluate(() => !G.running && document.getElementById('endView').hidden === false), true, `${station}/${slot} ended with the end card`);
    fp.push({ station, slot, ...(await footprint(page)), v: await page.evaluate(() => Bot.violations.length) });
    await assertClean(assert, page, `${station}/${slot}/${diff}`);
  }
  // the same shift again several times ("again") and the day chain ("next")
  for (let i = 0; i < 3; i++) {
    await go(page, '#againBtn'); await page.evaluate(() => { Bot.reset(); CFG.aiErr = .12; });
    await runToEnd(page);
    fp.push({ station: 'again', slot: i, ...(await footprint(page)) });
  }
  for (let i = 0; i < 3; i++) {
    await go(page, '#nextBtn'); await page.evaluate(() => { Bot.reset(); CFG.aiErr = .12; });
    await runToEnd(page);
    fp.push({ station: 'next', slot: i, ...(await footprint(page)) });
  }
  const bodies = fp.map(f => f.body);
  assert.ok(Math.max(...bodies) - Math.min(...bodies) <= 2, 'elements added to <body> keep piling up: ' + bodies);
  const base = fp[3], last = fp[fp.length - 1];
  // DOM nodes at the end of a shift stay in the same range however many shifts came before
  const nodes = fp.map(f => f.nodes), spread = Math.max(...nodes) - Math.min(...nodes);
  assert.ok(Math.max(...nodes.slice(6)) <= Math.max(...nodes.slice(0, 6)) * 1.15 + 50, 'DOM nodes keep growing: ' + nodes.join(','));
  // (the little floating words clean themselves up with a timer, which cannot fire while a lock-step run holds the page: they are checked below)
  for (const f of fp) { assert.ok(f.errLog <= 12); assert.ok(f.grp <= 12, 'queue elements kept: ' + f.grp); assert.ok(f.tickets <= 60, 'tickets ' + f.tickets); }
  if (base.heap) assert.ok(last.heap < base.heap * 3 + 30e6, `heap ${base.heap} -> ${last.heap}`);
  assert.ok(spread < 2500, 'node counts vary a lot: ' + nodes.join(','));
  await page.waitForTimeout(1600);
  assert.deepEqual(await page.evaluate(() => [document.getElementById('fx').children.length, document.querySelectorAll('.float').length]), [0, 0], 'floating labels are removed after their animation');
  // bank and stars only ever went up over these shifts (rent never pays out more than revenue)
  assert.ok(await page.evaluate(() => SHOP.bank > 0 && SHOP.stars >= 60));
  await page.context().close();
});

test('one very long shift (40 game-minutes, endless) with the waiter bot: invariants hold, nothing accumulates', async () => {
  const page = await openSingle(browser, srv.url, { shop: { stars: 60 } });
  await startShift(page, { station: 'waiter', slot: 'lunch', diff: 'pro' });
  await page.evaluate(() => { CFG.aiErr = .12; CFG.aiBarErr = .05; CFG.aiKitErr = .04; });
  await endless(page);
  const samples = [];
  for (let i = 0; i < 8; i++) {
    await run(page, 300);
    samples.push(await footprint(page));
    assert.ok(await page.evaluate(() => G.running));
  }
  const st = await state(page);
  assert.ok(st.t > 2300 && st.served > 300, JSON.stringify(st));
  assert.ok(samples.every(s => s.groups <= 14 && s.payQ <= 12 && s.errLog <= 12), JSON.stringify(samples.map(s => [s.groups, s.payQ])));
  const nodes = samples.map(s => s.nodes);
  assert.ok(Math.max(...nodes) - Math.min(...nodes) < 400, 'DOM nodes: ' + nodes);
  assert.ok(Number.isFinite(st.revenue) && st.mistakes === st.mistakes);
  await assertClean(assert, page, 'long shift');
  await page.context().close();
});

test('every station for 40 game-minutes with the computer on the other seats (all stations, endless): no violation, no stuck customers', async () => {
  const page = await openSingle(browser, srv.url, { shop: { stars: 60, recipes: ALL_RECIPES } });
  for (const station of ['kitchen', 'bar', 'till']) {
    await page.evaluate(() => Bot.reset());
    await startShift(page, { station, slot: 'lunch', diff: 'pro' });
    await page.evaluate(() => { CFG.aiErr = .12; CFG.aiBarErr = .05; CFG.aiKitErr = .04; });
    await endless(page);
    for (let i = 0; i < 4; i++) await run(page, 300);
    const st = await state(page), fp = await footprint(page);
    assert.ok(st.t > 1100 && st.served > 100, station + JSON.stringify(st));
    assert.ok(fp.groups <= 14 && fp.payQ <= 12 && fp.tickets <= 40, station + JSON.stringify(fp));
    assert.equal(await page.evaluate(() => Bot.age().worst < 150), true, station + ' a group parked for ' + await page.evaluate(() => Bot.age().worst));
    await assertClean(assert, page, station + ' long');
    await page.evaluate(() => { G.running = false; });
    await page.evaluate(() => { document.getElementById('startView').hidden = false; });
  }
  await page.context().close();
});
