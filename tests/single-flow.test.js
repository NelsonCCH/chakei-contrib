// Single player, shift flow: start, pause / resume / quit, the end screen of every station, then next slot (早市 -> 午市 ->
// 晚市 -> next day), again, home, and the levels' next / again buttons.
import { go } from './helpers/intro.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers/server.js';
import { launch, realErrors, shot } from './helpers/browser.js';
import { openSingle, startShift, run, runToEnd, state, hud, endCard, cell, assertClean, settle } from './helpers/single.js';

let srv, browser;
before(async () => { srv = await startServer(); browser = await launch(); });
after(async () => { await browser?.close(); await srv?.stop(); });

const ROLE = { waiter: '伙記', kitchen: '廚房', bar: '水吧', till: '收銀' };
const END_TXT = { breakfast: '九點半 · 早市完', lunch: '二點正 · 午市完', dinner: '八點半 · 晚市完' };
const START_CLOCK = { breakfast: '7:30', lunch: '12:00', dinner: '18:30' };
const DIFF_NAME = { rookie: '新人', pro: '熟手', ace: '阿姐' };
// the sign the boss hangs up, from the rules in main.js
function expectSign(station, s) {
  if (station === 'waiter') return s.angry === 0 && s.mistakes === 0 ? '頂呱呱' : s.angry <= 2 && s.mistakes <= 2 ? '唔錯' : s.mistakes > s.angry ? '眼大睇過龍' : '手腳慢';
  if (station === 'kitchen') return s.mistakes === 0 && s.angry === 0 ? '鑊氣十足' : s.angry > s.mistakes ? '火候慢' : s.mistakes > 2 ? '亂咁整' : '唔錯';
  if (station === 'bar') return s.mistakes === 0 && s.angry === 0 ? '絲襪王' : s.angry > s.mistakes ? '手腳慢' : s.mistakes > 2 ? '亂咁沖' : '唔錯';
  return s.mistakes === 0 && s.angry === 0 ? '數口精' : s.loss > 100 ? '蝕本貨' : s.angry > s.mistakes ? '手腳慢' : '計數要準';
}
const LABELS = {
  waiter: ['營業額', '招呼咗', '落錯單', '嬲走'], kitchen: ['營業額', '出咗', '整錯', '嬲走'],
  bar: ['營業額', '沖咗', '沖錯', '嬲走'], till: ['營業額', '埋咗單', '計錯', '蝕咗'],
};

test('pause and resume: the clock stops, the overlay shows the boss target, sheets close, nothing can be tapped, resume carries on', async () => {
  const page = await openSingle(browser, srv.url);
  await startShift(page);
  await run(page, 8);
  await page.evaluate(() => { Bot.quiet(); });
  const gid = await page.evaluate(() => Bot.inject(1));
  await page.locator('#pauseBtn').click();
  assert.equal(await page.evaluate(() => G.paused), true);
  assert.equal(await page.locator('#pauseView').isVisible(), true);
  assert.match(await page.locator('#pauseGoal').innerText(), /^老闆目標：.+/);
  const t0 = await page.evaluate(() => G.t);
  await page.waitForTimeout(1200);
  assert.equal(await page.evaluate(() => G.t), t0, 'game time stands still in the real loop');
  await page.evaluate(id => tapGroup(id), gid);
  assert.equal(await page.evaluate(() => G.selected), null, 'taps are ignored while paused');
  await page.locator('#resumeBtn').click();
  assert.equal(await page.evaluate(() => G.paused), false);
  assert.equal(await page.locator('#pauseView').isVisible(), false);
  await page.waitForTimeout(700);
  assert.ok(await page.evaluate(() => G.t) > t0 + .3, 'time runs again');
  assert.ok(await page.evaluate(([t0]) => G.t < t0 + 3, [t0]), 'but did not jump ahead by the pause');
  // pausing with the slip open closes it (the draft stays)
  await page.evaluate(id => { const g = byId(id); seat(g, G.tables[0]); }, gid);
  await run(page, 10, { bot: false });
  await page.locator('#floor .tbl[data-t="0"]').click();
  assert.equal(await page.locator('#sheetWrap').isVisible(), true);
  // hiding the tab pauses by itself, and closes the open slip (the pause button itself is under the slip's overlay)
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  assert.equal(await page.evaluate(() => G.paused), true, 'tab hidden = paused');
  assert.equal(await page.locator('#sheetWrap').isVisible(), false);
  assert.equal(await page.evaluate(() => G.sheet), null);
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: false, configurable: true }); });
  await page.locator('#resumeBtn').click();
  assert.deepEqual(realErrors(page), []);
  await page.context().close();
});

test('pause at the till closes the price board', async () => {
  const page = await openSingle(browser, srv.url);
  await startShift(page, { station: 'till' });
  await page.locator('#boardBtn').click();
  assert.equal(await page.locator('#boardWrap').isVisible(), true);
  assert.match(await page.locator('#board').innerText(), /價錢牌/);
  const t0 = await page.evaluate(() => G.t);
  await page.waitForTimeout(500);
  assert.ok(await page.evaluate(([t0]) => G.t > t0, [t0]), 'with the board open a pro shift slows to a quarter, it does not stop');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#boardWrap').isVisible(), false);
  await page.locator('#boardBtn').click();
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  assert.deepEqual(await page.evaluate(() => [G.paused, G.board]), [true, false]);
  assert.equal(await page.locator('#boardWrap').isVisible(), false);
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: false, configurable: true }); });
  await page.locator('#resumeBtn').click();
  assert.deepEqual(realErrors(page), []);
  await page.context().close();
});

test('quit from the pause menu: back to the home screen, no end card, no pay, a new shift starts clean', async () => {
  const page = await openSingle(browser, srv.url);
  await startShift(page);
  await run(page, 40);
  const before = await page.evaluate(() => ({ bank: SHOP.bank, stars: SHOP.stars, shifts: SHOP.shifts, day: SHOP.day, rev: G.revenue }));
  assert.ok(before.rev > 0);
  await page.locator('#pauseBtn').click();
  await page.locator('#quitBtn').click();
  assert.equal(await page.locator('#startView').isVisible(), true);
  assert.equal(await page.locator('#pauseView').isVisible(), false);
  assert.equal(await page.locator('#endView').isVisible(), false);
  assert.equal(await page.evaluate(() => G.running), false);
  assert.deepEqual(await page.evaluate(() => ({ bank: SHOP.bank, stars: SHOP.stars, shifts: SHOP.shifts, day: SHOP.day, rev: G.revenue })), before, 'quitting earns and costs nothing');
  await startShift(page, { slot: 'dinner' });
  assert.deepEqual(await page.evaluate(() => [G.t < 1, G.revenue, G.slot, G.running]), [true, 0, 'dinner', true]);
  assert.equal((await hud(page)).clock.startsWith('18:3'), true);
  await assertClean(assert, page, 'quit');
  await page.context().close();
});

for (const station of ['waiter', 'kitchen', 'bar', 'till']) {
  test(`end screen (${station}): numbers, labels, sign by the boss's rules, kick line, buttons - idle shift and played shift`, async () => {
    const page = await openSingle(browser, srv.url, { shop: { stars: 60 } });
    // a shift where nobody does anything
    await startShift(page, { station, slot: 'lunch', diff: 'pro' });
    if (station === 'bar') for (let i = 0; i < 10 && await page.evaluate(() => G.phase !== 'open'); i++) await run(page, 2);   // somebody has to boil the tea before the shop opens
    await runToEnd(page, { bot: false });
    let st = await state(page), card = await endCard(page);
    assert.equal(card.visible, true);
    assert.deepEqual(card.cells.map(c => c[0]).filter(l => LABELS[station].includes(l)), LABELS[station]);
    assert.equal(cell(card, '營業額'), '$' + st.revenue);
    assert.equal(card.kick, `第 1 日 · ${END_TXT.lunch} · ${ROLE[station]} · ${DIFF_NAME.pro}`);
    assert.equal(card.sign, expectSign(station, st), `idle sign ${JSON.stringify(st)}`);
    assert.match(card.boss, /^老闆講.+/);
    assert.equal(card.next, '做埋晚市'); assert.equal(card.again, '再做一次午市');
    assert.equal(await page.evaluate(() => G.t), 180, 'a shift is exactly 180 s');
    assert.equal(await page.evaluate(() => document.getElementById('clock').textContent), '14:00');
    await shot(page, `single-flow-end-${station}-idle`);
    // and played well
    await go(page, '#againBtn');
    await page.evaluate(() => Bot.reset());
    await runToEnd(page);
    st = await state(page); card = await endCard(page);
    assert.equal(card.sign, expectSign(station, st));
    assert.equal(st.mistakes, 0); assert.equal(st.angry, 0);
    assert.equal(cell(card, '營業額'), '$' + st.revenue);
    assert.ok(['頂呱呱', '鑊氣十足', '絲襪王', '數口精'].includes(card.sign), card.sign);
    await assertClean(assert, page, station);
    await page.context().close();
  });
}

test('end-card signs for every outcome the boss has a line for (waiter: mixed mistakes; till: heavy losses)', async () => {
  const page = await openSingle(browser, srv.url, { shop: { stars: 60 } });
  // waiter with wrong slips for every third order: some mistakes, no walk-outs
  await startShift(page, { station: 'waiter', diff: 'rookie' });
  await page.evaluate(() => { Bot.opts.sheetMode = g => (g.id % 2 ? 'drink' : 'correct'); });
  await runToEnd(page);
  let st = await state(page), card = await endCard(page);
  assert.ok(st.mistakes > 2, 'mistakes ' + st.mistakes);
  assert.equal(card.sign, expectSign('waiter', st)); assert.equal(card.sign, '眼大睇過龍');
  await page.evaluate(() => Bot.reset());
  // the till under-charging everything loses money
  await page.click('#homeBtn');
  await startShift(page, { station: 'till', diff: 'rookie' });
  await page.evaluate(() => { Bot.opts.tillMode = 'under'; });
  await runToEnd(page);
  st = await state(page); card = await endCard(page);
  assert.equal(card.sign, expectSign('till', st));
  assert.ok(st.loss > 0);
  assert.equal(cell(card, '蝕咗'), '$' + st.loss);
  await page.context().close();
});

test('the day: 早市 -> 午市 -> 晚市 -> 收舖 -> next day (clock, labels, buttons, day revenue, day counter)', async () => {
  const page = await openSingle(browser, srv.url, { shop: { stars: 60, day: 4 } });
  await startShift(page, { station: 'waiter', slot: 'breakfast', diff: 'pro' });
  const revs = [];
  const plan = [['breakfast', '做埋午市', 'lunch'], ['lunch', '做埋晚市', 'dinner'], ['dinner', '收舖，聽日早市', null]];
  for (const [slot, nextTxt, nextSlot] of plan) {
    assert.equal(await page.evaluate(() => G.slot), slot);
    assert.equal(await page.evaluate(() => document.getElementById('clockLbl').textContent), { breakfast: '早市', lunch: '午市', dinner: '晚市' }[slot]);
    assert.equal((await hud(page)).clock, START_CLOCK[slot]);
    await runToEnd(page);
    const card = await endCard(page);
    revs.push((await state(page)).revenue);
    assert.equal(card.kick, `第 4 日 · ${END_TXT[slot]} · 伙記 · 熟手`);
    assert.equal(card.next, nextTxt);
    assert.equal(card.again, `再做一次${{ breakfast: '早市', lunch: '午市', dinner: '晚市' }[slot]}`);
    if (nextSlot) {
      assert.equal(cell(card, '第 4 日全日營業額'), undefined, 'the day total only shows after the last slot');
      await go(page, '#nextBtn');
      await page.evaluate(() => Bot.reset());
      assert.equal(await page.evaluate(() => slot), nextSlot);
      assert.equal(await page.evaluate(() => localStorage.getItem('ckf-slot')), nextSlot, 'the chosen slot is remembered');
    } else {
      assert.equal(cell(card, '第 4 日全日營業額'), '$' + revs.reduce((a, b) => a + b, 0));
      assert.equal(await page.evaluate(() => SHOP.dayRev), revs.reduce((a, b) => a + b, 0));
      await go(page, '#nextBtn');
      assert.deepEqual(await page.evaluate(() => [SHOP.day, SHOP.dayRev, slot, G.slot, G.running]), [5, 0, 'breakfast', 'breakfast', true]);
    }
  }
  assert.ok(revs.every(r => r > 0));
  await assertClean(assert, page, 'day');
  await page.context().close();
});

test('再做一次 and 返主頁: same slot and station again from zero; home shows the menu with the day saved', async () => {
  const page = await openSingle(browser, srv.url, { shop: { stars: 60 } });
  await startShift(page, { station: 'bar', slot: 'dinner', diff: 'ace' });
  await runToEnd(page);
  const bank1 = await page.evaluate(() => SHOP.bank);
  await go(page, '#againBtn');
  const s = await page.evaluate(() => ({ station: G.station, slot: G.slot, t: G.t, rev: G.revenue, running: G.running, end: !document.getElementById('endView').offsetParent, diff }));
  assert.deepEqual(s, { station: 'bar', slot: 'dinner', t: s.t, rev: 0, running: true, end: true, diff: 'ace' });
  assert.ok(s.t < 1);
  await run(page, 60);
  await page.locator('#pauseBtn').click();
  await page.locator('#quitBtn').click();
  assert.equal(await page.evaluate(() => SHOP.bank), bank1, 'an unfinished shift pays nothing');
  await startShift(page, { station: 'bar', slot: 'dinner', diff: 'ace' });
  await runToEnd(page);
  await page.click('#homeBtn');
  assert.equal(await page.locator('#startView').isVisible(), true);
  assert.equal(await page.locator('#endView').isVisible(), false);
  assert.match(await page.locator('#career .rank').innerText(), /★/);
  await assertClean(assert, page, 'again/home');
  await page.context().close();
});

test('levels: pick from the list, play with the bot, stars follow the revenue lines, next-level and play-again buttons', async () => {
  const page = await openSingle(browser, srv.url);
  await page.click('#levelBtn');
  assert.equal(await page.locator('#bookView').isVisible(), true);
  // only the first level of each family is open at the start; the others are locked behind a star
  const open = await page.evaluate(() => [...document.querySelectorAll('#book .levels li')].map(li => [li.querySelector('b').textContent, !li.classList.contains('locked')]));
  assert.deepEqual(open.filter(([, o]) => o).map(([n]) => n), ['屋邨茶記']);
  assert.ok(open.length >= 5);
  await page.click('#book [data-lv="estate"]');
  await page.waitForFunction(() => G && G.running && G.level === 'estate');
  await page.evaluate(() => { CFG.aiErr = 0; CFG.aiBarErr = 0; CFG.aiKitErr = 0; G.regPlan = []; });
  assert.equal(await page.evaluate(() => document.getElementById('clockLbl').textContent), '午市');
  assert.equal(await page.evaluate(() => TABLES.length), 6);
  // idle: nothing earned, "唔夠數", no stars, and the button says so
  await runToEnd(page, { bot: false });
  let card = await endCard(page);
  assert.equal(card.sign, '唔夠數');
  assert.equal(await page.evaluate(() => SHOP.levels.estate | 0), 0);
  assert.equal(card.next, '再挑戰呢關'); assert.equal(card.again, '再玩呢關');
  assert.match(card.kick, /屋邨茶記|二點正/);
  // again -> same level; a good run
  await go(page, '#againBtn');
  assert.deepEqual(await page.evaluate(() => [G.level, G.t < 1, G.revenue]), ['estate', true, 0]);
  await page.evaluate(() => { CFG.aiErr = 0; CFG.aiBarErr = 0; CFG.aiKitErr = 0; G.regPlan = []; });
  await runToEnd(page);
  const st = await state(page);
  const lines = await page.evaluate(() => curLine());   // the waiter's own line, not the team line
  // one and two stars on revenue, the third on the waiter's average seat-to-order time, 15 s in the levels
  const avg = await page.evaluate(() => { const a = G.spd && G.spd.waiter; return a && a[0] ? a[1] / a[0] : null; });
  const two = lines.slice(0, 2).filter(l => st.revenue >= l).length, stars = two === 2 && avg !== null && avg <= 15 ? 3 : two;
  card = await endCard(page);
  assert.equal(card.sign, ['唔夠數', '過關', '好嘢', '完美'][stars]);
  assert.equal(await page.evaluate(() => SHOP.levels.estate | 0), stars);
  assert.equal(await page.evaluate(() => document.querySelector('#result .stars b').getAttribute('aria-label')), `${stars} 粒星`);
  assert.ok(stars >= 1, 'bot revenue ' + st.revenue + ' vs lines ' + lines);
  assert.equal(card.next, '下一關：中環早餐');
  await go(page, '#nextBtn');
  assert.deepEqual(await page.evaluate(() => [G.level, G.slot, G.running]), ['central', 'breakfast', true]);
  await assertClean(assert, page, 'levels');
  await page.context().close();
});

test('quitting from a level, from the tutorial or from the daily challenge gives the player their own shop, difficulty and slot back', async () => {
  const page = await openSingle(browser, srv.url, { shop: { stars: 60 } });
  const mine = () => page.evaluate(() => ({ diff, tables: TABLES.length, fixed: fixedShop === null, tut: document.body.classList.contains('tut'), hint: !!document.getElementById('tutHint') && !document.getElementById('tutHint').hidden, running: G.running }));
  const home = { diff: 'pro', tables: 6, fixed: true, tut: false, hint: false, running: false };
  const quit = async () => { await page.locator('#pauseBtn').click(); await page.locator('#quitBtn').click(); };
  // a level (its own tables, slot and difficulty)
  await page.evaluate(() => { document.getElementById('startView').hidden = true; armLevel('mongkok'); start(); });
  await page.waitForFunction(() => G.running && G.level === 'mongkok');
  assert.deepEqual(await page.evaluate(() => [TABLES.length, slot, diff]), [8, 'dinner', 'lv']);
  await run(page, 10);
  await quit();
  assert.deepEqual(await mine(), home);
  assert.equal(await page.evaluate(() => slot), 'lunch', 'the slot the player had chosen is back');
  // the tutorial
  await page.click('#tutBtn'); await page.click('#book [data-train="bar"]');
  await page.waitForFunction(() => G.running && G.tut);
  assert.equal(await page.evaluate(() => document.body.classList.contains('tut')), true);
  await quit();
  assert.deepEqual(await mine(), home);
  // the daily challenge
  await go(page, '#dailyBtn');
  await page.waitForFunction(() => G.running && G.daily);
  await quit();
  assert.deepEqual(await mine(), home);
  // and a normal shift afterwards is a normal shift
  await startShift(page, { slot: 'lunch' });
  assert.deepEqual(await page.evaluate(() => [!G.level, !G.tut, !G.daily, TABLES.length]), [true, true, true, 6]);
  await assertClean(assert, page, 'quit restores');
  await page.context().close();
});

test('quitting in the middle of 旺場 (the shift\'s fever) leaves no fever tint or heat bar on the home screen', async () => {
  const page = await openSingle(browser, srv.url);
  await startShift(page);
  await page.evaluate(() => { G.feverAt = G.t + 1; });
  await run(page, 12);
  assert.equal(await page.evaluate(() => G.fever), true, 'in the fever');
  assert.deepEqual(await page.evaluate(() => [document.body.classList.contains('fever'), document.body.classList.contains('feverPeak'), document.getElementById('heat').hidden]), [true, true, false], 'the screen is in fever mode, at its climax');
  await page.locator('#pauseBtn').click();
  await page.locator('#quitBtn').click();
  assert.equal(await page.locator('#startView').isVisible(), true);
  assert.deepEqual(await page.evaluate(() => [document.body.classList.contains('fever'), document.body.classList.contains('feverPeak')]), [false, false], 'no fever tint on the home screen');
  // and the same after a normal end of shift
  await startShift(page);
  await runToEnd(page);
  assert.deepEqual(await page.evaluate(() => [document.body.classList.contains('fever'), document.body.classList.contains('feverPeak')]), [false, false], 'no fever tint on the end card');
  await page.context().close();
});

test('旺場 on screen: told as it starts, a heat bar that builds to the climax and winds down, told at the climax and the end', async () => {
  const page = await openSingle(browser, srv.url);
  await startShift(page);
  await page.evaluate(() => { Bot.quiet(); G.nextSpawn = Infinity; G.feverAt = G.t + 2; });
  const look = () => page.evaluate(() => {
    const h = document.getElementById('heat'), b = h.querySelector('b');
    return { x: G.t - G.feverAt, fever: !!G.fever, fevers: G.fevers | 0, tint: document.body.classList.contains('fever'), peak: document.body.classList.contains('feverPeak'),
      bar: !h.hidden && h.getBoundingClientRect().width > 0, fill: Number(getComputedStyle(document.body).getPropertyValue('--heat')),
      boss: (document.getElementById('bossSay') || {}).textContent || '', toast: document.getElementById('toast').textContent, combo: (document.getElementById('combo') || {}).textContent || '' };
  });
  await run(page, 1.5, { bot: false });
  let s = await look();
  assert.deepEqual([s.fever, s.tint, s.bar], [false, false, false], 'not yet: no tint, no heat bar');
  await run(page, 1, { bot: false });
  s = await look();
  assert.deepEqual([s.fever, s.tint, s.bar, s.peak], [true, true, true, false], 'started: tint and heat bar, not yet the climax at ' + s.x);
  assert.match(s.boss, /旺場嚟喇！40 秒/, 'the boss announces it');
  await run(page, 4, { bot: false });
  const ramp = (await look()).fill;
  await page.waitForTimeout(300); await shot(page, 'fever-ramp');   // for a person to look at (tests/out)
  await run(page, 6, { bot: false });
  s = await look();
  assert.ok(ramp > .05 && ramp < .6, 'slow at first: the bar part-filled 4.5 s in: ' + ramp);
  assert.ok(s.peak && s.fill > .97, `the climax from 10 s: full bar, pulsing border at ${s.x}: ${s.fill}`);
  assert.equal(s.toast, '旺場高峰！頂住！');
  await page.waitForTimeout(300); await shot(page, 'fever-peak');
  // tips at the climax: twice, shown on the combo
  await page.evaluate(() => { for (let i = 0; i < 12; i++) good(); });
  assert.match((await look()).combo, /\+\$10 貼士 ×2/, 'combo 12 at the climax: $5 x 2');
  // a mistake breaks the combo, not the fever
  await page.evaluate(() => { G.mistakes++; });
  await run(page, .2, { bot: false });
  s = await look();
  assert.deepEqual([s.fever, s.tint], [true, true], 'a mistake does not end the fever');
  await run(page, 24, { bot: false });
  s = await look();
  assert.ok(s.bar && !s.peak && s.fill > .2 && s.fill < .8, `winding down at ${s.x}: ${s.fill}`);
  await run(page, 6, { bot: false });
  s = await look();
  assert.deepEqual([s.fever, s.tint, s.bar, s.peak], [false, false, false, false], 'over at ' + s.x);
  assert.equal(s.toast, '旺場過咗，辛苦晒！');
  await runToEnd(page, { bot: false });
  const card = await endCard(page);
  assert.equal(cell(card, '旺場'), '1 次', 'the end card counts the one fever');
  await page.context().close();
});
