// Solo at the new seats, through the real menus: 員工培訓 has a lesson for 燒味 that runs on the station's
// own screen (the seat view) and marks it learned; a learned new seat can be picked for a level and a whole shift
// played there with the computer at the shop's four. The shifts are driven in lock-step in the page (the game loop's
// body: shiftStep, the solo referee's frame, the lesson tick) with the station's own bot pressing for the player.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers/server.js';
import { launch } from './helpers/browser.js';
import { openSingle, endCard, assertClean } from './helpers/single.js';
import { ROLES_REACHED } from './helpers/browser.js';

let srv, browser;
before(async () => { srv = await startServer(); browser = await launch(); });
after(async () => { await browser?.close(); await srv?.stop(); });

/** Runs the page in lock-step for up to `sec` game seconds, the seat's bot pressing every `every`-th step (default 3). */
const drive = (page, kind, sec, every = 3) => page.evaluate(([kind, sec, every]) => {
  const press = { roast: roastBotPress, runner: runnerBotPress, takeaway: takeawayBotPress }[kind];
  let now = performance.now();
  for (let i = 0; i < sec / .05 && G.running; i++) {
    if (!G.paused) shiftStep(.05);
    now += 50; coopFrame(now); tutTick();
    if (G.running && i % every === 0) press();
  }
  coopFrame(now + 50);
  return { running: G.running, t: G.t };
}, [kind, sec, every]);
const seatSrc = page => page.evaluate(() => document.getElementById('seatFrame')?.getAttribute('src') ?? null);

test('員工培訓: the 燒味 lesson runs on the station screen, three set customers, then the seat is learned and pickable', async () => {
  const page = await openSingle(browser, srv.url, { shop: ROLES_REACHED });   // the ladder brought every role
  await page.click('#tutBtn');
  assert.match(await page.locator('#book [data-train="roast"]').innerText(), /燒味[\s\S]*未學 · 獎 \$300/);
  const bank0 = await page.evaluate(() => SHOP.bank);
  await page.click('#book [data-train="roast"]');
  await page.waitForFunction(() => G && G.running && G.tut && G.xseat === 'roast');
  assert.equal(await seatSrc(page), 'stations/roast.html?seat');
  assert.equal(await page.locator('#seatFrame').isVisible(), true);
  assert.deepEqual(await page.evaluate(() => [G.extra, G.roles.waiter, G.roles.bar, G.roles.kitchen, G.roles.till, G.roles.roast]), [['roast'], 'ai', 'ai', 'ai', 'ai', 'me']);
  await page.frameLocator('#seatFrame').locator('#shop canvas').first().waitFor();
  await drive(page, 'roast', 4);
  assert.match(await page.locator('#tutHint').innerText(), /教學 · 0\/3 碟/);
  assert.match(await page.locator('#tutHint').innerText(), /叉燒飯|白飯|鐵通|砧板/);
  const r = await drive(page, 'roast', 400);
  assert.equal(r.running, false, 'the lesson ended after three dishes');
  await page.waitForFunction(() => !document.getElementById('endView').hidden);
  const card = await endCard(page);
  assert.equal(card.sign, '學識喇');
  assert.equal(await page.evaluate(() => SHOP.tutDone.roast), true);
  const gain = await page.evaluate(() => SHOP.bank) - bank0, rev = await page.evaluate(() => G.revenue);
  assert.equal(gain, 300 + rev, 'the first time pays $300 (plus the lesson takings, as the shop lessons do)');
  // the seat is now on the level picker, unlocked
  await page.click('#homeBtn');
  await page.click('#levelBtn');
  assert.doesNotMatch(await page.locator('#lvSt [data-st="roast"]').innerText(), /🔒/);
  await assertClean(assert, page, 'roast lesson');
  await page.context().close();
});

test('a level at 燒味: starred on the counter\'s own takings and its speed; the end card shows them and the longest combo', async () => {
  // 年廿八 brings 燒味 (its tier 1); the ladder up to 打風前夕 is passed
  const page = await openSingle(browser, srv.url, { shop: { tutDone: { waiter: 1, bar: 1, kitchen: 1, till: 1, roast: true }, ...ROLES_REACHED } });
  await page.click('#levelBtn');
  await page.click('#lvSt [data-st="roast"]');
  await page.click('#book [data-lv="newyear"]');
  await page.waitForFunction(() => G && G.running && G.level === 'newyear' && G.xseat === 'roast');
  await page.frameLocator('#seatFrame').locator('#shop canvas').first().waitFor();
  const r = await drive(page, 'roast', 400, 1);
  assert.equal(r.running, false);
  await page.waitForFunction(() => !document.getElementById('endView').hidden);
  const st = await page.evaluate(() => ({ own: shiftMeasure(G), rev: G.revenue, combo: G.maxCombo ?? 0, line: curLine(), sg: speedGoal('roast', true), stars: lvStarsNow() }));
  assert.deepEqual(st.line, await page.evaluate(() => STAR_LINES.newyear.roast));
  assert.ok(st.own > 0 && st.own < st.rev, 'the counter\'s own takings, not the shop\'s: ' + JSON.stringify(st));
  assert.ok(st.sg.have !== null, 'its plates were timed');
  const res = await page.locator('#result').innerText();
  const need = String(st.sg.need).replace('.', '\\.');
  assert.match(res, new RegExp(`燒味收入 \\$${st.own}（燒味：★ \\$${st.line[0]} · ★★ \\$${st.line[1]} · ★★★ 再要落單到斬好上碟平均 ${need} 秒內，你平均 [\\d.]+ 秒 ${st.sg.ok ? '✓' : '✗'}`));
  assert.match(res, new RegExp(`燒味收入\\s+\\$${st.own}`), 'the card\'s own row');
  assert.match(res, new RegExp(`最長連擊\\s+${st.combo}`));
  assert.ok(st.combo > 0, 'good plates fed the combo');
  const two = st.line.slice(0, 2).filter(l => st.own >= l).length;
  assert.equal(st.stars, two === 2 && st.sg.ok ? 3 : two);
  // back to the four: picking 樓面 again plays the floor (moved here from the retired 洗碗 level test)
  await page.click('#homeBtn');
  await page.click('#levelBtn');
  await page.click('#lvSt [data-st="waiter"]');
  await page.click('#book [data-lv="estate"]');
  await page.waitForFunction(() => G && G.running && G.level === 'estate');
  // 屋邨 is a 樓面 level, so 伙記 is the floor seat on a solo referee
  assert.deepEqual(await page.evaluate(() => [G.xseat ?? null, !!G.floor, soloSeatOn()]), [null, true, true]);
  assert.equal(await seatSrc(page), null);
  await assertClean(assert, page, 'roast level');
  await page.context().close();
});

test('role gates: no new role\'s lesson or seat before the ladder reaches it; its card, lesson and seat after; 做法 hides at a new seat', async () => {
  const page = await openSingle(browser, srv.url);   // the four learned, no level passed yet
  const seatsIn = sel => page.$$eval(`${sel} [data-st]`, b => b.map(x => x.dataset.st));
  const lessons = () => page.$$eval('#book [data-train]', b => b.map(x => x.dataset.train));
  await page.click('#tutBtn');
  assert.deepEqual(await lessons(), ['waiter', 'kitchen', 'bar', 'till'], 'training: the four only');
  assert.equal(await page.locator('#trainX').count(), 0);
  await page.click('#bookClose');
  await page.click('#shopBtn');
  assert.deepEqual(await seatsIn('#stSeg'), ['waiter', 'kitchen', 'bar', 'till'], 'own shop: the four only');
  await page.click('#homeBack');
  await page.click('#levelBtn');
  assert.deepEqual(await seatsIn('#lvSt'), ['waiter', 'kitchen', 'bar', 'till'], 'levels: the four only');
  await page.click('#bookClose');
  // a star on 第 1 關 opens 第 2 關 中環早餐, which brings 傳菜: back home (the menus redrawn, as 返主頁 does), its card
  await page.evaluate(() => { SHOP.levels.estate = 1; saveShop(); buildMenus(); gateRender(); });
  await page.locator('#gatePop').waitFor();
  assert.match(await page.locator('#gatePop').innerText(), /新位：傳菜[\s\S]*中環早餐/);
  await page.click('#gateGo');
  await page.locator('#bookView:not([hidden]) #trainX').waitFor();
  assert.deepEqual(await lessons(), ['waiter', 'kitchen', 'bar', 'till', 'runner', 'clear'], 'the card opens training with the 傳菜 lesson and 執枱 (it joins 樓面 at 第 2 關), nothing else new');
  assert.match(await page.locator('#book [data-train="runner"]').innerText(), /未學 · 獎 \$300/);
  await page.click('#bookClose');
  await page.click('#shopBtn');
  // 傳菜 is 樓面's task, not a seat: the pickers keep the four; a role of its own (燒味, opened
  // here as a later save would) needs its lesson, and once learned is picked and hides 做法
  assert.deepEqual(await seatsIn('#stSeg'), ['waiter', 'kitchen', 'bar', 'till']);
  await page.evaluate(() => { SHOP.levels = { ...SHOP.levels, central: 1, mongkok: 1, airport: 1, typhoon: 1, newyear: 1 }; saveShop(); buildMenus(); });
  assert.match(await page.locator('#stSeg [data-st="roast"]').innerText(), /🔒 先培訓/, 'the seat needs the lesson');
  await page.evaluate(() => { SHOP.tutDone.roast = true; saveShop(); buildMenus(); });
  assert.equal(await page.locator('#soloSeg').isVisible(), true);
  await page.click('#stSeg [data-st="roast"]');
  assert.equal(await page.locator('#stSeg [data-st="roast"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('#soloSeg').isVisible(), false, '做法 hidden at a new seat');
  assert.equal(await page.locator('#soloH').isVisible(), false);
  await page.click('#stSeg [data-st="waiter"]');
  assert.equal(await page.locator('#soloSeg').isVisible(), true, 'and back at the four');
  await assertClean(assert, page, 'role gates');
  await page.context().close();
});
