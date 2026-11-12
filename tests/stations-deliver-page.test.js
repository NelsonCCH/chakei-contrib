// 送外賣 deliver: the standalone page (site/stations/deliver.html) in a headless, muted browser on a 390 x 844 phone.
// One journey: the start card, a 2-order run, real presses of 加速 and real taps on the road halves, then the core's
// bot drives through the page's own command path (gear cap 5: the rocket) until a drop and the run summary.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, PHONE, WEBKIT, OUT } from './helpers/browser.js';
import { staticServer, loadStation } from './helpers/stations-sim.js';
import { join } from 'node:path';

let srv, browser;
const VIEW = (await loadStation('deliver')).TUNE.reach.view;   // the safe-lane guard's sight
before(async () => { srv = await staticServer(); browser = await launch(); });
after(async () => { await browser?.close(); await srv?.stop(); });

const shot = (page, name) => page.screenshot({ path: join(OUT, `stations-deliver-${name}${WEBKIT ? '-webkit' : ''}.png`) });

test('a 2-order run: 加速 steps gears, road taps change lane, the rocket, a drop, the summary card', async () => {
  const ctx = await browser.newContext({ ...PHONE, locale: 'zh-HK', serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(srv.url + '/stations/deliver.html');
  assert.equal(await page.isVisible('#ovStart'), true, 'the start card shows');
  await shot(page, 'start');
  await page.click('#segN button[data-v="2"]');
  await page.click('#segDiff button[data-v="pro"]');
  await page.click('#bStart');
  await page.waitForFunction(() => window.__st.s && window.__st.s.st === 'ride');
  assert.equal(await page.evaluate(() => window.__st.s.run.orders.length), 2, 'two orders on the run');
  assert.equal(await page.locator('#orders .oc').count(), 2, 'two order cards with countdowns');

  // real presses: each 加速 tap is one gear step
  for (let g = 1; g <= 2; g++) {
    await page.locator('#bGo').tap();
    await page.waitForFunction(n => window.__st.s.gear === n, g);
    await page.waitForTimeout(250);
  }
  // real taps on the road: the right half moves right, the left half left
  const box = await page.locator('#road').boundingBox();
  const lane0 = await page.evaluate(() => window.__st.s.lane);
  await page.touchscreen.tap(box.x + box.width * 0.8, box.y + box.height * 0.5);
  await page.waitForFunction(l => window.__st.s.lane === Math.min(2, l + 1), lane0);
  await page.touchscreen.tap(box.x + box.width * 0.2, box.y + box.height * 0.5);
  await page.waitForFunction(l => window.__st.s.lane === l, lane0);

  // the bot rides through the page's command path, up to the rocket gear
  await page.evaluate(() => { window.__drive = setInterval(() => { const c = window.__st.screen.bot({ gear: 5, skill: 0.95 }); if (c) window.__st.screen.cmd(c); }, 16); });
  await page.waitForFunction(() => window.__st.s.gear === 5 && window.__st.s.st === 'ride' && window.__st.s.cars.some(c => c.y - window.__st.s.pos < 35 && c.y > window.__st.s.pos), null, { timeout: 30000 });
  assert.equal(await page.textContent('#gN'), '火箭！');
  await shot(page, 'rocket');

  // the first drop building with its order number comes into view, then the drop: the card turns done
  await page.waitForFunction(() => { const s = window.__st.s, o = s.run.orders[0]; return o.y - s.pos < 26 && o.y - s.pos > 12; }, null, { timeout: 40000 });
  await shot(page, 'approach');
  await page.waitForFunction(() => window.__st.s.run.orders.some(o => o.done), null, { timeout: 40000 });
  await page.waitForTimeout(150);
  assert.equal(await page.locator('#orders .oc.done').count(), 1, 'one order card shows delivered');
  await shot(page, 'drop');

  // back at the shop: the summary card shows the state's run time and both orders
  await page.waitForFunction(() => window.__st.s.st === 'home', null, { timeout: 60000 });
  await page.evaluate(() => clearInterval(window.__drive));
  await page.waitForFunction(() => !document.getElementById('ovCard').hidden);
  const last = await page.evaluate(() => window.__st.s.last);
  const body = await page.textContent('#cardBody');
  assert.match(body, new RegExp(`${last.secs.toFixed(1)}\\s*秒離開舖頭`));
  for (const o of last.orders) assert.ok(body.includes(`#${o.no}`), `order #${o.no} on the summary`);
  assert.match(body, new RegExp(`撞車 ${last.crashes} 次`));
  await shot(page, 'summary');

  // 再送一轉, two gears up, then a taxi right in front: the crash, the rider picks the bike up, back to gear 0
  await page.click('#bAgain');
  await page.waitForFunction(() => window.__st.s.st === 'ride' && document.getElementById('ovCard').hidden);
  for (let g = 1; g <= 2; g++) { await page.locator('#bGo').tap(); await page.waitForFunction(n => window.__st.s.gear === n, g); await page.waitForTimeout(250); }
  await page.evaluate(() => { const s = window.__st.s; s.cars.push({ id: 9999, k: 'taxi', len: 4.4, lane: s.lane, to: s.lane, x: s.lane, y: s.pos + 5, tele: 0, dec: true, col: 0 }); });
  await page.waitForFunction(() => window.__st.s.st === 'crash' && window.__st.s.crashT > 0.55);
  assert.equal(await page.evaluate(() => window.__st.s.gear), 0, 'a crash puts the gear back to 0');
  assert.equal(await page.textContent('#gN'), '跌咗');
  await shot(page, 'crash');
  await page.waitForFunction(() => window.__st.s.st === 'crash' && window.__st.s.crashT > 1.2);
  await shot(page, 'pickup');
  await page.waitForFunction(() => window.__st.s.st === 'ride');
  assert.equal(await page.evaluate(() => window.__st.s.run.crashes), 1);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('one compact HUD row; the road shows the guard\'s sight ahead on the phones and in the floor job\'s frame', async () => {
  // 390x666 / 375x667: the phones (Chrome with its bars); 374x533: the floor job's iframe on the 390x666 game page
  for (const [w, h] of [[390, 666], [375, 667], [374, 533], [390, 844]]) {
    const ctx = await browser.newContext({ ...PHONE, viewport: { width: w, height: h }, locale: 'zh-HK', serviceWorkers: 'block' });
    const page = await ctx.newPage();
    await page.goto(srv.url + '/stations/deliver.html');
    await page.click('#segN button[data-v="3"]');
    await page.click('#bStart');
    await page.waitForFunction(() => window.__st.s && window.__st.s.st === 'ride');
    await page.waitForTimeout(100);
    const m = await page.evaluate(view => ({ sight: window.__st.screen.sight(), view, hud: document.getElementById('hud').getBoundingClientRect().height, cards: document.querySelectorAll('#hud #orders .oc').length }), VIEW);
    assert.ok(m.sight >= m.view, `${w}x${h}: the road shows ${m.sight.toFixed(1)} m ahead, the guard needs ${m.view}`);
    assert.ok(m.hud <= 44, `${w}x${h}: the top HUD is one row (${m.hud} px)`);
    assert.equal(m.cards, 3, 'the three bags are in the top row');
    if (w === 390 && h === 666) await shot(page, 'hud-666');
    await ctx.close();
  }
});

test('the door picker: 1/2/3 bags with their tip bonus, a real tap chooses, then it waits for the claims', async () => {
  const ctx = await browser.newContext({ ...PHONE, locale: 'zh-HK', serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(srv.url + '/stations/deliver.html');
  await page.click('#bStart');
  await page.waitForFunction(() => window.__st.s && window.__st.s.st === 'ride');
  // the shop feeds the station now (as on the floor seat): two bags at the door, after the run is home
  await page.evaluate(() => { const s = window.__st.s; s.selfFeed = false; s.st = 'idle'; s.run = null; s.door = { bags: [{ gid: 1, no: 61, left: 90 }, { gid: 2, no: 62, left: 70 }], want: 0 }; });
  await page.waitForSelector('#door', { state: 'visible' });
  assert.equal(await page.textContent('#door h3'), '今轉帶幾多袋？');
  assert.deepEqual(await page.$$eval('#door button', bs => bs.map(b => b.disabled)), [false, false, true], 'only as many bags as are at the door');
  assert.match(await page.textContent('#door button[data-n="2"]'), /#61 #62.*×1\.3/);
  await shot(page, 'door');
  await page.locator('#door button[data-n="2"]').tap();
  await page.waitForFunction(() => window.__st.s.door?.want === 2);
  await page.waitForFunction(() => document.querySelector('#door h3')?.textContent === '等確認袋數…');
  assert.deepEqual(await page.$$eval('#door button', bs => bs.map(b => b.disabled)), [true, true, true], 'one choice per door');
  await shot(page, 'door-wait');
  // the run starts: off the door
  await page.evaluate(() => { window.__st.s.door = null; });
  await page.waitForSelector('#door', { state: 'hidden' });
  assert.deepEqual(errors, []);
  await ctx.close();
});
