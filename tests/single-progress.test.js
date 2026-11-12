// Single player, rules around the shift: difficulty levels, time slots, the tutorial for each station, the daily
// challenge (same customers for everybody), regulars and celebrities, stars / ranks / bank, unlock gates firing once,
// and saving. Expected numbers come from the rules in the comments of career.js / market.js, not from the code paths.
import { go } from './helpers/intro.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers/server.js';
import { launch, realErrors, shot } from './helpers/browser.js';
import { openSingle, startShift, run, runToEnd, state, hud, endCard, cell, assertClean, settle, ALL_RECIPES } from './helpers/single.js';

let srv, browser;
before(async () => { srv = await startServer(); browser = await launch(); });
after(async () => { await browser?.close(); await srv?.stop(); });

const events = (page, type) => page.evaluate(t => Bot.ev.filter(e => e.type === t), type);
const RENT = .08;

// ---------------------------------------------------------------- difficulty
// Only 新人 slows the shop while a slip is open (to a quarter); 熟手 and 阿姐 keep the clock running
const DIFF = { rookie: { pat: 1.4, gap: 2.5, slow: .25, name: '新人', says: /慢到四分一/ }, pro: { pat: 1, gap: 2.2, slow: 1, name: '熟手', says: /時間照行/ }, ace: { pat: .8, gap: 1.7, slow: 1, name: '阿姐', says: /時間照行/ } };
for (const [diff, d] of Object.entries(DIFF)) {
  test(`difficulty ${diff}: door patience 45 s x ${d.pat}, arrival gap x ${d.gap}, time while a slip is open x ${d.slow}`, async () => {
    const page = await openSingle(browser, srv.url, { shop: { stars: 60 } });
    await startShift(page, { diff });
    assert.equal(await page.evaluate(() => document.querySelector('#diffSeg button[aria-pressed="true"]').dataset.d), diff);
    // the difficulty button says what the slip does to the clock (screen = rule)
    assert.match(await page.evaluate(k => document.querySelector(`#diffSeg [data-d="${k}"] span`).textContent, diff), d.says);
    assert.equal(await page.evaluate(() => D().slow), d.slow);
    await page.evaluate(() => { Bot.quiet(); });
    await page.evaluate(() => { Bot.inject(1); });
    const enq = await events(page, 'enqueue');
    assert.ok(Math.abs(enq.at(-1).max - 45 * d.pat) < 1e-9, `queue patience ${enq.at(-1).max}`);
    // the average gap between two arrivals is 6 s in the rush (and 8.5 s outside it) x the difficulty
    const mean = await page.evaluate(() => { G.ease = 1; G.fever = false; G.feverAt = null; let s = 0; for (let i = 0; i < 3000; i++) s += spawnGap(60); return s / 3000; });
    assert.ok(Math.abs(mean - 6 * d.gap) < .12, `mean gap in the rush ${mean.toFixed(2)} vs ${6 * d.gap}`);
    const calm = await page.evaluate(() => { let s = 0; for (let i = 0; i < 3000; i++) s += spawnGap(10); return s / 3000; });
    assert.ok(Math.abs(calm - 8.5 * d.gap) < .15, `mean gap outside the rush ${calm.toFixed(2)} vs ${8.5 * d.gap}`);
    // seated: order patience 50 s x pat
    await page.evaluate(() => { const id = G.groups[0].id; seat(byId(id), G.tables[0]); });
    await run(page, 12, { bot: false });
    const g = await page.evaluate(() => { const g = G.groups.find(g => g.state === 'order'); return g && { max: g.max }; });
    assert.ok(g, 'ordering');
    assert.ok(Math.abs(g.max - 50 * d.pat) < 1e-9, `order patience ${g.max}`);
    // with the slip open the clock runs at slow x its normal speed (the real loop; measured against the same page's normal speed, so a slow machine does not matter)
    const clock = async () => { const t0 = await page.evaluate(() => G.t); await page.waitForTimeout(1200); return (await page.evaluate(() => G.t)) - t0; };
    const normal = await clock();
    assert.ok(normal > .3, 'the clock runs: ' + normal);
    await page.locator('#floor .tbl[data-t="0"]').click();
    assert.equal(await page.locator('#sheetWrap').isVisible(), true);
    const open = await clock();
    assert.ok(open > 0, 'the shop never stands still while a slip is open');
    assert.ok(Math.abs(open / normal - d.slow) < .12, `slip open: ${open.toFixed(3)} vs normal ${normal.toFixed(3)} (wanted x${d.slow})`);
    await page.context().close();
  });
}

test('the three difficulty buttons unlock with rank: 新人 for apprentices, 熟手 at 10 stars, 阿姐 at 25 stars', async () => {
  for (const [stars, open] of [[4, ['rookie']], [12, ['rookie', 'pro']], [30, ['rookie', 'pro', 'ace']]]) {
    const page = await openSingle(browser, srv.url, { shop: { stars } });
    await page.click('#shopBtn');
    const got = await page.evaluate(() => [...document.querySelectorAll('#diffSeg button')].filter(b => !b.disabled).map(b => b.dataset.d));
    assert.deepEqual(got, open, `${stars} stars`);
    const locked = await page.evaluate(() => [...document.querySelectorAll('#diffSeg button.locked')].map(b => b.querySelector('span').textContent));
    assert.equal(locked.length, 3 - open.length);
    for (const t of locked) assert.match(t, /要升到.+（\d+★）/);
    await page.context().close();
  }
});

// ---------------------------------------------------------------- slots
const SLOT = { breakfast: { clock: '7:30', end: '9:30', pre: 's', head: '餐' }, lunch: { clock: '12:00', end: '14:00', pre: 'f', head: '食' }, dinner: { clock: '18:30', end: '20:30', pre: 'd', head: '碟頭飯' } };
for (const [slot, s] of Object.entries(SLOT)) {
  test(`time slot ${slot}: clock ${s.clock} to ${s.end}, ${s.pre}-type orders, the slip and the price board show the right menu`, async () => {
    const page = await openSingle(browser, srv.url, { shop: { stars: 60, recipes: ALL_RECIPES } });
    await startShift(page, { slot });
    assert.equal((await hud(page)).clock, s.clock);
    await run(page, 90);
    const subs = await events(page, 'submit');
    assert.ok(subs.length >= 3, 'orders sent ' + subs.length);   // 熟手 sends fewer customers
    for (const e of subs) { const meals = e.slip.filter(k => 'fsd'.includes(k[0])); for (const k of meals) assert.equal(k[0], s.pre, `${slot} order ${k}`); }
    // the slip shows this slot's menu heading
    const gid = await page.evaluate(() => { Bot.stop(); closeSheet(); Bot.quiet(); return Bot.inject(1); });   // the bot may have left a slip open
    await run(page, 12, { bot: false });
    // seat our own one-person group (the queue may still hold a bigger group from the rush), on a table the stopped bot left
    // dirty if need be: nobody is cleaning any more
    const seated = await page.evaluate(id => {
      const g = byId(id); G.tables.forEach(t => { if (!G.groups.some(x => x.table === t.id)) t.dirty = 0; });
      const tb = G.tables.find(t => !seatProblem(g, t)); if (tb) seat(g, tb); return !!tb;
    }, gid);
    assert.ok(seated, 'a free seat for the test customer');
    await run(page, 12, { bot: false });
    const ord = await page.evaluate(id => byId(id).state === 'order' && byId(id).table, gid);
    assert.notEqual(ord, false, 'the test customer is ready to order');
    await page.locator(`#floor .tbl[data-t="${ord}"]`).click();
    assert.match(await page.locator('#sheet .sec-h').first().innerText(), /./);
    assert.ok((await page.locator('#sheet .sec-h').allInnerTexts()).some(t => t.startsWith(s.head)), 'slip heading ' + s.head);
    await page.keyboard.press('Escape');
    await run(page, 180, { bot: false });
    assert.equal((await hud(page)).clock, s.end);
    await page.context().close();
  });
}

// ---------------------------------------------------------------- tutorial
for (const station of ['waiter', 'kitchen', 'bar', 'till']) {
  test(`tutorial (${station}): three set customers, no time limit, prize $300 the first time only, marks the station learned`, async () => {
    const page = await openSingle(browser, srv.url, { shop: { tutDone: {}, shifts: 0, stars: 0, servedTotal: 0, skipTut: true } });
    const bank0 = await page.evaluate(() => SHOP.bank), diff0 = await page.evaluate(() => diff);
    await page.click('#tutBtn');
    assert.equal(await page.locator('#bookView').isVisible(), true);
    assert.match(await page.locator(`#book [data-train="${station}"]`).innerText(), /未學 · 獎 \$300/);
    await page.click(`#book [data-train="${station}"]`);
    await page.waitForFunction(() => G && G.running && G.tut);
    await page.evaluate(() => { CFG.aiErr = 0; CFG.aiBarErr = 0; CFG.aiKitErr = 0; });
    assert.deepEqual(await page.evaluate(() => [diff, G.station, G.slot, TABLES.length]), ['tut', station, 'lunch', 6]);
    await page.waitForSelector('#tutHint', { state: 'visible' });
    assert.match(await page.locator('#tutHint').innerText(), /教學 · 0\/3 枱客/);
    // no time limit: nobody to serve, but 400 s later it is still running
    await run(page, 400, { bot: false });
    assert.equal(await page.evaluate(() => G.running), true, 'no time limit in the tutorial');
    await page.evaluate(() => Bot.reset());
    await page.evaluate(() => { G.groups = []; G.payQ = []; G.cur = null; G.served = 0; G.paidCount = 0; G.tutNext = 0; G.tutAt = G.t + 1; });
    await run(page, 200);
    const card = await endCard(page);
    assert.equal(card.sign, '學識喇', JSON.stringify(await state(page)));
    assert.match(card.boss, /利是/);
    assert.equal(card.again, '再學一次');
    assert.equal(card.next, '第一關：屋邨茶記', 'a brand-new player (no shift played yet) is sent to level 1 after training');
    assert.equal(await page.evaluate(([s]) => SHOP.tutDone[s], [station]), true);
    const rev1 = (await state(page)).revenue;
    assert.equal(await page.evaluate(() => SHOP.bank), bank0 + 300 + rev1, 'first completion pays $300 on top of what the training customers paid (no rent in training)');
    const labels = await page.evaluate(() => TUT_GROUPS.map(g => g.label));
    assert.deepEqual(labels, ['阿伯', '兩個同事', 'OL']);
    assert.deepEqual(await page.evaluate(() => [diff, TABLES.length, fixedShop]), [diff0, 6, null], 'difficulty and own shop restored');
    // second time: no prize
    await go(page, '#againBtn');
    await page.evaluate(() => { CFG.aiErr = 0; CFG.aiBarErr = 0; CFG.aiKitErr = 0; Bot.reset(); });
    await run(page, 200);
    const card2 = await endCard(page);
    assert.equal(card2.sign, '學識喇');
    assert.doesNotMatch(card2.boss, /利是/);
    assert.equal(await page.evaluate(() => SHOP.bank), bank0 + 300 + rev1 + (await state(page)).revenue, 'no second prize');
    await assertClean(assert, page, 'tutorial ' + station);
    await page.context().close();
  });
}

// ---------------------------------------------------------------- daily challenge
test('daily challenge: the same customers for everybody, the day\'s own station / slot / goal, the $500 prize only once', async () => {
  const page = await openSingle(browser, srv.url, { shop: { stars: 60 } });
  const dc = await page.evaluate(() => dailyChallenge());
  assert.ok(['waiter', 'kitchen', 'bar', 'till'].includes(dc.station) /* a fresh save: the four only */ && ['breakfast', 'lunch', 'dinner'].includes(dc.slot) && ['rev', 'calm', 'clean', 'combo', 'tips'].includes(dc.goal));
  assert.match(await page.locator('#career .daily').innerText(), /今日挑戰/);
  const crowd = async () => (await events(page, 'enqueue')).filter(e => e.size).slice(0, 14).map(e => [e.size, e.label, e.items]);
  const runs = [];
  let prizes = [];
  for (let n = 0; n < 2; n++) {
    await page.evaluate(() => Bot.reset());
    await go(page, '#dailyBtn');
    await page.waitForFunction(() => G && G.running && G.daily);
    await page.evaluate(() => { CFG.aiErr = 0; CFG.aiBarErr = 0; CFG.aiKitErr = 0; });
    assert.deepEqual(await page.evaluate(() => [G.station, G.slot, G.goal]), [dc.station, dc.slot, dc.goal], 'the challenge of the day');
    assert.match(await page.evaluate(() => document.getElementById('bossSay').textContent), /每日挑戰（全港同一批客）/);
    assert.equal(await page.evaluate(() => G.regPlan.length), 0, 'no regulars or celebrities in the daily, so it is fair');
    await runToEnd(page);
    runs.push(await crowd());
    const bank = await page.evaluate(() => SHOP.bank), card = await endCard(page);
    prizes.push(await page.evaluate(() => (document.querySelector('#result .stars') || {}).innerText || ''));
    await page.click('#homeBtn');
  }
  assert.ok(runs[0].length >= 6, 'customers seen ' + runs[0].length);
  assert.deepEqual(runs[0], runs[1], 'two runs of the daily challenge see the same customers, in the same order, with the same orders');
  // ... and a normal shift does not
  await page.evaluate(() => Bot.reset());
  await startShift(page, { slot: dc.slot });
  await run(page, 100);
  const normal = (await events(page, 'enqueue')).filter(e => e.size).slice(0, 14).map(e => [e.size, e.label, e.items]);
  assert.notDeepEqual(normal, runs[0], 'a normal shift is random');
  // the prize: 500 the first time the goal is reached today (only if it was), never twice
  const withPrize = prizes.filter(p => /包埋挑戰 \$500/.test(p)).length;
  assert.ok(withPrize <= 1, 'the $500 is paid at most once a day: ' + JSON.stringify(prizes));
  // the goal's own ✓ / ✗ (the card's first mark; the third star's speed has a ✓ / ✗ of its own after it)
  const won = p => /^每日挑戰：[^✓✗]*✓/.test(p);
  if (won(prizes[0])) assert.equal(withPrize, 1, 'first win pays the prize');
  assert.equal(await page.evaluate(() => (SHOP.daily === todayStr())), won(prizes[0]) || won(prizes[1]));
  await assertClean(assert, page, 'daily');
  await page.context().close();
});

// ---------------------------------------------------------------- stars, rank, bank
// stars from the rules: 1 star = at most 3 walk-outs, 2 = and the boss goal, 3 = and the station's speed
// (OWN_NEED: each station's average seconds a job in the own shop)
const goalOk = s => ({ rev: s.revenue >= s.goalN, calm: s.angry === 0, clean: s.mistakes <= 1, combo: s.maxCombo >= s.goalN, tips: s.tips >= s.goalN })[s.goal];
const OWN_NEED = { waiter: 14, bar: 27, till: 9.5 };
const fastOf = s => s.avg !== null && s.avg <= OWN_NEED[s.station];
const starsOf = s => { const s1 = s.angry <= 3, s2 = s1 && goalOk(s), s3 = s2 && fastOf(s); return s3 ? 3 : s2 ? 2 : s1 ? 1 : 0; };

test('stars, prize and bank: stars follow the boss-goal rules; bank = revenue minus rent + $100 per star + the first-time bonuses; saved to the browser', async () => {
  const page = await openSingle(browser, srv.url, { shop: { stars: 9, bank: 5000 } });
  const outcomes = [];
  // 供舖 is paid with a button on the shop screen, never by a shift: no instalment in the bank sums below
  for (const [mode, station] of [['correct', 'waiter'], ['mixed', 'waiter'], ['idle', 'waiter']]) {
    await page.evaluate(() => Bot.reset());
    await startShift(page, { station, diff: 'rookie' });
    await page.evaluate(m => { G.goal = 'calm'; G.goalN = 0; if (m === 'mixed') Bot.opts.sheetMode = g => (g.id % 2 ? 'drink' : 'correct'); }, mode);
    const s0 = await page.evaluate(() => ({ bank: SHOP.bank, stars: SHOP.stars }));
    await runToEnd(page, { bot: mode !== 'idle' });
    const st = await page.evaluate(() => { const a = (G.spd || {})[G.station]; return { station: G.station, avg: a && a[0] ? a[1] / a[0] : null, revenue: G.revenue, angry: G.angry, mistakes: G.mistakes, maxCombo: G.maxCombo | 0, tips: G.tips | 0, goal: G.goal, goalN: G.goalN }; });
    const stars = starsOf(st);
    const card = await page.evaluate(() => ({ aria: document.querySelector('#result .stars b').getAttribute('aria-label'), bank: SHOP.bank, total: SHOP.stars, text: document.querySelector('#result').innerText, goal: document.querySelector('#result .stars span').textContent }));
    assert.equal(card.aria, `${stars} 粒星`, `${mode}: ${JSON.stringify(st)}`);
    // the card says what the third star asked for and what the shift did, as the state has it
    const have = st.avg === null ? '你未做過' : `你平均 ${st.avg.toFixed(1)} 秒`;
    assert.ok(card.goal.endsWith(` · ★★★ 要坐低到落單平均 14 秒內，${have} ${fastOf(st) ? '✓' : '✗'}`), `${mode}: ${card.goal}`);
    assert.equal(card.total - s0.stars, stars);
    // bank: revenue less 8% rent, the prize, plus the extras listed on the card (the chosen target's stake: + or −)
    const extras = await page.evaluate(() => [...document.querySelectorAll('#result .wide')].filter(w => /返工第|第一次做|老闆目標 ·/.test(w.innerText)).reduce((a, w) => { const m = w.querySelector('b').textContent.match(/([+−]?)\$(\d+)/) || ['', '', 0]; return a + (m[1] === '−' ? -1 : 1) * +m[2]; }, 0));
    const mort = 0;
    const want = st.revenue - Math.round(st.revenue * RENT) + stars * 100 + extras - mort;
    assert.equal(card.bank - s0.bank, want, `${mode}: bank`);
    assert.ok(card.text.includes(`交租（深水埗街舖）\n−$${Math.round(st.revenue * RENT)}`), 'rent line on the card');
    outcomes.push([mode, stars]);
    // saved in the browser as it happened
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('ckf-shop')));
    assert.equal(saved.bank, card.bank); assert.equal(saved.stars, card.total);
    await page.click('#homeBtn');
    await page.waitForTimeout(600);   // a rank-up unlock card may pop up on the home screen: close it like a player would
    if (await page.locator('#gatePop').count()) await page.click('#gateLater');
  }
  assert.ok(outcomes[0][1] === 3, 'a perfect shift is 3 stars: ' + JSON.stringify(outcomes));
  assert.ok(outcomes[2][1] <= 1, 'a shift of doing nothing is at most 1 star: ' + JSON.stringify(outcomes));
  await page.context().close();
});

test('rank up: stars add up, the card says 升職 with what unlocks, the 熟手 button opens, the unlock card pops up once and never again (even after a restart)', async () => {
  const page = await openSingle(browser, srv.url, { shop: { stars: 8, gates: ['shop', 'rookie', 'dex'], bank: 5000 } });
  await page.click('#shopBtn');
  assert.equal(await page.locator('#diffSeg [data-d="pro"]').isDisabled(), true);
  await startShift(page, { diff: 'rookie' });
  await page.evaluate(() => { G.goal = 'calm'; G.goalN = 0; });
  await runToEnd(page);
  const card = await page.evaluate(() => ({ stars: SHOP.stars, text: document.querySelector('#result .stars').innerText }));
  assert.equal(card.stars, 11, '8 + 3 stars');
  assert.match(card.text, /升職！你而家係熟手，解鎖熟手難度、廚房第二隻碟/);
  await page.click('#homeBtn');
  // the yellow unlock card (升咗熟手) appears when back at the menu, once
  await page.waitForSelector('#gatePop', { timeout: 5000 });
  assert.match(await page.locator('#gatePop h2').innerText(), /升咗熟手/);
  assert.deepEqual(await page.evaluate(() => SHOP.gates.filter(g => g === 'pro').length), 1);
  await page.click('#gateLater');
  await page.evaluate(() => renderCareer());
  await page.waitForTimeout(900);
  assert.equal(await page.locator('#gatePop').count(), 0, 'it does not come back');
  assert.equal(await page.locator('#diffSeg [data-d="pro"]').isDisabled(), false);
  // restart the game with what was saved: still no card, rank and bank kept
  const saved = await page.evaluate(() => localStorage.getItem('ckf-shop'));
  const p2 = await openSingle(browser, srv.url, { storage: { 'ckf-shop': saved } });
  assert.deepEqual(await p2.evaluate(() => [SHOP.stars, RANKS[rankIx()].name, SHOP.gates.includes('pro')]), [11, '熟手', true]);
  await p2.evaluate(() => renderCareer());
  await p2.waitForTimeout(900);
  assert.equal(await p2.locator('#gatePop').count(), 0, 'no unlock card after a restart');
  assert.equal(await p2.evaluate(() => SHOP.bank), await page.evaluate(() => SHOP.bank));
  await p2.context().close();
  await assertClean(assert, page, 'rank');
  await page.context().close();
});

// ---------------------------------------------------------------- regulars and celebrities
test('a regular: says what he always has ("照舊") from the second visit on, tips $10 then $15, is counted in the book', async () => {
  const page = await openSingle(browser, srv.url);
  const tips = [];
  for (const visit of [0, 1]) {
    await page.evaluate(() => Bot.reset());
    await startShift(page, { slot: 'lunch' });
    await page.evaluate(() => { G.regPlan = [{ key: 'chan', at: 2 }]; });
    await run(page, 60);
    const info = await page.evaluate(() => ({ visits: SHOP.regs.chan | 0, tips: G.tips | 0, reg: G.groups.concat(G.payQ).find(g => g.regular === 'chan') }));
    const lines = await page.evaluate(() => { const g = [...G.groups, ...G.payQ].find(g => g.regular === 'chan'); return g ? g.lines : null; });
    if (lines) { if (visit === 0) assert.match(lines.join(''), /唔該，/); else assert.match(lines.join(''), /照舊|老樣/); }
    await runToEnd(page);
    const after = await page.evaluate(() => ({ visits: SHOP.regs.chan | 0, tips: G.tips | 0, good: Bot.ev.filter(e => e.type === 'good').reduce((a, e) => a + e.d.tips, 0) }));
    assert.equal(after.visits, visit + 1, 'he is counted once per visit');
    tips.push(after.tips - after.good);
    await page.click('#homeBtn');
  }
  assert.deepEqual(tips, [10, 15], 'regular tip = $10 + $5 per earlier visit');
  await assertClean(assert, page, 'regular');
  await page.context().close();
});

test('a celebrity in dark glasses: a $50 tip when they pay, and they go into the book', async () => {
  const page = await openSingle(browser, srv.url, { shop: { stars: 12 } });
  await startShift(page, { slot: 'lunch' });
  await page.evaluate(() => { G.regPlan = [{ celeb: 'tvstar', at: 2 }]; });
  await runToEnd(page);
  const r = await page.evaluate(() => ({ seen: SHOP.celebs.tvstar | 0, tips: G.tips | 0, good: Bot.ev.filter(e => e.type === 'good').reduce((a, e) => a + e.d.tips, 0) }));
  assert.equal(r.seen, 1);
  assert.equal(r.tips - r.good, 50);
  await page.context().close();
});

// ---------------------------------------------------------------- saving
test('a finished shift is saved at once; a new browser with that save has the same bank, stars, day and shift count', async () => {
  const page = await openSingle(browser, srv.url, { shop: { day: 3 } });
  await startShift(page, { slot: 'dinner' });
  await runToEnd(page);
  const mine = await page.evaluate(() => ({ bank: SHOP.bank, stars: SHOP.stars, day: SHOP.day, shifts: SHOP.shifts, dayRev: SHOP.dayRev, servedTotal: SHOP.servedTotal }));
  const saved = await page.evaluate(() => localStorage.getItem('ckf-shop'));
  const p2 = await openSingle(browser, srv.url, { storage: { 'ckf-shop': saved } });
  assert.deepEqual(await p2.evaluate(() => ({ bank: SHOP.bank, stars: SHOP.stars, day: SHOP.day, shifts: SHOP.shifts, dayRev: SHOP.dayRev, servedTotal: SHOP.servedTotal })), mine);
  assert.equal(mine.shifts, 6, 'veteran had 5 shifts, +1');
  assert.ok(mine.servedTotal > 120);
  await p2.context().close();
  await page.context().close();
});

test('a new player: the shop is locked until the first shift, then the unlock cards come one at a time, each only once', async () => {
  const save = JSON.stringify({ nick: '新手', t: 1, tutDone: { waiter: 1 } });
  const page = await openSingle(browser, srv.url, { storage: { 'ckf-shop': save } });
  assert.equal(await page.evaluate(() => [SHOP.shifts | 0, SHOP.stars | 0, firstShiftDone()]).then(a => a.join()), '0,0,false');
  // my own shop is locked, and tapping it says why
  assert.equal(await page.locator('#shopBtn').getAttribute('data-gate'), 'shop');
  assert.match(await page.locator('#shopBtn').innerText(), /🔒/);
  await page.click('#shopBtn');
  assert.match(await page.evaluate(() => document.getElementById('toast').textContent), /做完第一更先開/);
  assert.equal(await page.evaluate(() => document.querySelector('.home').dataset.step), 'mode', 'still on the first menu');
  // the first level is the way in
  await page.click('#firstLvGo');
  await page.waitForFunction(() => G && G.running && G.level === 'estate');
  // level 1 is customer-limited (4.4 groups a minute), so revenue follows the seed more than the hands; this test
  // is about the unlock cards, not the pace, so the line is lowered to make the bot's three stars certain.
  await page.evaluate(() => { CFG.aiErr = 0; CFG.aiBarErr = 0; CFG.aiKitErr = 0; G.regPlan = []; STAR_LINES.estate.waiter = [100, 200, 300]; });
  await runToEnd(page);
  const stars = await page.evaluate(() => SHOP.stars);
  assert.ok(stars >= 3, 'three stars on level 1 make the player 新人 at once: ' + stars);
  await page.click('#homeBtn');
  // first card: the shop
  await page.waitForSelector('#gatePop', { timeout: 5000 });
  assert.match(await page.locator('#gatePop h2').innerText(), /你都想有自己間舖/);
  await page.click('#gateLater');
  // second card: promoted to 新人
  await page.waitForSelector('#gatePop', { timeout: 5000 });
  assert.match(await page.locator('#gatePop h2').innerText(), /升咗新人/);
  await page.click('#gateLater');
  // third card: level 1 starred opens the road to 第 2 關, which brings the 傳菜 role
  await page.waitForSelector('#gatePop', { timeout: 5000 });
  assert.match(await page.locator('#gatePop h2').innerText(), /新位：傳菜/);
  await page.click('#gateLater');
  // fourth card: 第 2 關 is also where 執枱 joins 樓面
  await page.waitForSelector('#gatePop', { timeout: 5000 });
  assert.match(await page.locator('#gatePop h2').innerText(), /新工作：執枱/);
  await page.click('#gateLater');
  await page.waitForTimeout(900);
  assert.equal(await page.locator('#gatePop').count(), 0, 'nothing else is new');
  const seen = await page.evaluate(() => SHOP.gates);
  assert.deepEqual(seen.filter(g => ['shop', 'rookie'].includes(g)), ['shop', 'rookie'], 'each gate is recorded once, in order');
  assert.equal(await page.locator('#shopBtn').getAttribute('data-gate'), '', 'the shop is open now');
  // coming back to the menu (and a restart with the saved game) shows none of them again
  await page.evaluate(() => renderCareer());
  await page.waitForTimeout(900);
  assert.equal(await page.locator('#gatePop').count(), 0);
  const p2 = await openSingle(browser, srv.url, { storage: { 'ckf-shop': await page.evaluate(() => localStorage.getItem('ckf-shop')) } });
  await p2.waitForTimeout(1000);
  assert.equal(await p2.locator('#gatePop').count(), 0, 'no unlock card after a restart');
  await p2.context().close();
  await assertClean(assert, page, 'gates');
  await page.context().close();
});
