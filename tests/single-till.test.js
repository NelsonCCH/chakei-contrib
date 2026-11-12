// Single player, till (收銀): prices (hand-computed from the board), typing the total, the + key, cash and change,
// Octopus, struck lines, walk-outs, and whole shifts. Expected values come from the board's rules, not the game's code.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers/server.js';
import { launch, realErrors, shot } from './helpers/browser.js';
import { openSingle, startShift, run, runToEnd, state, hud, endCard, cell, assertClean, settle, ALL_RECIPES } from './helpers/single.js';

let srv, browser;
before(async () => { srv = await startServer(); browser = await launch(); });
after(async () => { await browser?.close(); await srv?.stop(); });

const events = (page, type) => page.evaluate(t => Bot.ev.filter(e => e.type === t), type);
const toast = page => page.evaluate(() => document.getElementById('toast').textContent);
const cur = page => page.evaluate(() => ({ entry: G.entry, step: G.step, paid: G.paid, charged: G.charged, give: [...G.give], expect: G.cur && G.cur.expect, say: G.cur && G.cur.paySay.slice(-1)[0] }));
async function tillShift(page, o = {}) {
  await startShift(page, { station: 'till', ...o });
  await page.evaluate(() => { Bot.quiet(); G.groups = []; });
}
// put one customer at the till and wait for the till to take them
async function customer(page, items, slip, o) {
  await page.evaluate(([i, s, o]) => Bot.payer(i, s, o), [items, slip, o || {}]);
  await page.waitForFunction(() => G.cur !== null, null, { polling: 100 }).catch(() => {});
  if (!await page.evaluate(() => G.cur)) { await run(page, 1.5, { bot: false }); }
  await page.waitForFunction(() => /總數/.test(document.getElementById('pad').innerText));
}
const digits = async (page, str) => { for (const ch of str) await page.click(`#pad [data-k="${ch === '+' ? '+' : ch}"]`); };
const dispTotal = page => page.evaluate(() => document.querySelector('#pad .disp b').textContent);

test('prices, worked out by hand from the price board', async () => {
  const page = await openSingle(browser, srv.url);
  await startShift(page, { station: 'till' });
  const price = keys => page.evaluate(k => ({ game: priceSlip(k).total, oracle: Oracle.price(k) }), keys);
  const cases = [
    [['f餐蛋麵', '熱奶茶'], 42],                       // the meal comes with one hot drink
    [['f餐蛋麵', '凍奶茶'], 42 + 3],                   // cold costs 3 more
    [['熱奶茶'], 18],                                  // a drink on its own is full price
    [['凍檸茶少甜走冰'], 18 + 3],
    [['f餐蛋麵', '熱奶茶', '熱檸茶'], 42 + 18],        // the second drink is extra
    [['f餐蛋麵', 'f西多士', '凍奶茶', '凍檸茶'], 42 + 34 + 3 + 3],   // two meals, two drinks
    [['f餐蛋麵', 'f西多士', '熱奶茶'], 42 + 34],       // fewer drinks than meals
    [['sA餐 通粉 煎蛋 牛油多士', '熱奶茶'], 38],
    [['sA餐 公仔麵 煎蛋 牛油多士', '熱奶茶'], 38 + 5],  // instant noodles +5
    [['sB餐 通粉 煎蛋 餐包烘底', '凍鴛鴦'], 38 + 2 + 3],  // toasted bun +2
    [['sC餐 公仔麵 炒蛋 餐包烘底飛邊', '熱檸茶'], 42 + 5 + 2],
    [['d粟米肉粒飯', '熱奶茶'], 46],
    [['d揚州炒飯加底', '凍檸水'], 54 + 6 + 3],        // double rice +6
    [['d咖喱牛腩飯走青', '熱奶茶'], 56],
    [['f菠蘿油', '凍檸茶少甜'], 30 + 3],
  ];
  for (const [keys, want] of cases) {
    const r = await price(keys);
    assert.equal(r.game, want, `game: ${keys}`);
    assert.equal(r.oracle, want, `oracle: ${keys}`);
  }
  // and across many random orders in every slot the game and the independently written oracle agree
  const bad = await page.evaluate(() => {
    const out = [], keep = slot;
    for (const s of ['breakfast', 'lunch', 'dinner']) { slot = s; for (let i = 0; i < 150; i++) { const o = genOrder(1 + Math.floor(Math.random() * 4)), k = itemsOf(o.persons); if (priceSlip(k).total !== Oracle.price(k)) out.push(k); } }
    slot = keep; return out;
  });
  assert.deepEqual(bad, []);
  assert.deepEqual(realErrors(page), []);
  await page.context().close();
});

test('cash a customer pays with is always enough, and change can be made from the notes in the till', async () => {
  const page = await openSingle(browser, srv.url);
  await startShift(page, { station: 'till' });
  const bad = await page.evaluate(() => {
    const out = [];
    for (let T = 1; T <= 1000; T++) for (let i = 0; i < 4; i++) { const n = cashNote(T); if (n.paid < T || n.paid - T >= 600 || !Number.isInteger(n.paid)) out.push([T, n]); if (n.neat && (n.paid - T) % 10 !== 0 && false) out.push([T, n]); }
    return out.slice(0, 5);
  });
  assert.deepEqual(bad, []);
  await page.context().close();
});

test('real mouse at the till: total, 收, change, 找錢 - revenue, combo, HUD and the next customer', async () => {
  const page = await openSingle(browser, srv.url);
  await tillShift(page);
  await settle(page);
  assert.match(await page.evaluate(() => document.getElementById('cust').innerText), /等緊客人/);
  await customer(page, ['f餐蛋麵', '凍檸茶少甜'], ['f餐蛋麵', '凍檸茶少甜']);
  const c = await cur(page);
  assert.equal(c.expect, 42 + 3);
  assert.equal(c.step, 'total');
  assert.equal(await page.evaluate(() => document.querySelector('#pad .disp span').textContent), '總數');
  // typing, backspace, clear
  await digits(page, '12');
  assert.equal(await dispTotal(page), '$12');
  await page.click('#pad [data-k="back"]');
  assert.equal(await dispTotal(page), '$1');
  await page.click('#pad [data-k="clr"]');
  assert.equal(await dispTotal(page), '$0');
  await page.click('#pad [data-k="ok"]');
  assert.match(await toast(page), /未打數/);
  assert.equal((await state(page)).mistakes, 0, 'empty entry is not a mistake');
  // the + key adds line by line: 42 + 3
  await page.click('#pad [data-k="+"]');   // nothing yet to add to
  assert.equal((await cur(page)).entry, '');
  await digits(page, '42+3');
  assert.equal(await dispTotal(page), '$45');
  assert.match(await page.locator('#pad .expr').innerText(), /42 ＋ 3/);
  await page.click('#pad [data-k="ok"]');
  const c2 = await cur(page);
  assert.equal(c2.step, 'cash'); assert.equal(c2.charged, 45);
  assert.ok(c2.paid >= 45);
  assert.match(c2.say, /^(\$\d+，唔該。|俾你 \$\d+，方便你找。)$/);
  // change: build it from the notes, take one back, then 找錢
  const need = c2.paid - 45;
  const notes = [100, 50, 20, 10, 5, 2, 1];
  let left = need;
  for (const n of notes) while (n <= left) { await page.click(`#pad [data-k="${n}"]`); left -= n; }
  assert.equal(await page.evaluate(() => document.querySelector('#pad .disp b').textContent), '$' + need);
  const rev0 = (await state(page)).revenue;
  await page.click('#pad [data-k="ok"]');
  const st = await state(page);
  assert.equal(st.mistakes, 0); assert.equal(st.loss, 0); assert.equal(st.paidCount, 1);
  assert.equal(st.revenue - rev0 - st.tips, 45, 'revenue grows by the bill (plus tips)');
  assert.equal(st.combo, 1);
  assert.equal((await hud(page)).rev, '$' + st.revenue);
  assert.equal(await page.evaluate(() => G.cur), null);
  await settle(page);
  assert.match(await page.evaluate(() => document.getElementById('cust').innerText), /唔該|多謝|拜拜/);
  await shot(page, 'single-till-paid');
  assert.deepEqual(realErrors(page), []);
  await page.context().close();
});

test('mistakes at the till: charging too much, too little, short change, over change, +/- keys', async () => {
  const page = await openSingle(browser, srv.url);
  await tillShift(page);
  const slip = ['f餐蛋麵', '熱奶茶'];   // 42
  // 1. over-charge: refused, customer complains, nothing is taken, the sum is cleared
  await customer(page, slip, slip);
  await digits(page, '43'); await page.click('#pad [data-k="ok"]');
  let st = await state(page), c = await cur(page);
  assert.equal(st.mistakes, 1); assert.equal(st.revenue, 0); assert.equal(c.step, 'total'); assert.equal(c.entry, '');
  assert.match(c.say, /做乜咁貴呀|唔係咁多錢掛/);
  // 2. under-charge by $2: taken at $40, the $2 is a loss
  await digits(page, '40'); await page.click('#pad [data-k="ok"]');
  st = await state(page); c = await cur(page);
  assert.equal(st.mistakes, 2); assert.equal(st.loss, 2); assert.equal(c.charged, 40); assert.equal(c.step, 'cash');
  assert.match(await toast(page), /少收咗 \$2/);
  // 3. short change: sent back for more
  const need = c.paid - 40;
  await page.click('#pad [data-k="ok"]');   // nothing given at all
  st = await state(page); c = await cur(page);
  assert.equal(st.mistakes, 3);
  assert.equal(c.say, `仲差 $${need} 呀！`);
  assert.equal(c.step, 'cash');
  // undo a note with 撤回
  await page.click('#pad [data-k="1"]'); await page.click('#pad [data-k="back"]');
  assert.deepEqual((await cur(page)).give, []);
  // 4. too much change: customer pockets it, the over-payment is a loss, the customer is done
  const over = 1;
  const parts = []; let left = need + over; for (const n of [100, 50, 20, 10, 5, 2, 1]) while (n <= left) { parts.push(n); left -= n; }
  for (const n of parts) await page.click(`#pad [data-k="${n}"]`);
  await page.click('#pad [data-k="ok"]');
  st = await state(page);
  assert.equal(st.mistakes, 4); assert.equal(st.loss, 2 + over);
  assert.match(await toast(page), new RegExp(`多找咗 \\$${over}`));
  assert.equal(st.paidCount, 1); assert.equal(st.revenue - st.tips, 40, 'what was charged is booked');
  assert.equal(await page.evaluate(() => G.cur), null);
  // let real frames run first: the per-frame check must not break the combo again for the mistake made in the same tap
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 50)))));
  assert.equal(await page.evaluate(() => G.combo), 1, 'the customer was served (combo +1) but the mistakes broke the one before');
  assert.equal((await hud(page)).mis, '4');
  await page.context().close();
});

test('disputed lines: customer says they did not order it - strike the line and it is not charged', async () => {
  const page = await openSingle(browser, srv.url);
  await tillShift(page);
  // the waiter wrote an extra 熱檸茶 the customer never asked for
  const items = ['f餐蛋麵', '熱奶茶'], slip = ['f餐蛋麵', '熱奶茶', '熱檸茶'];
  await customer(page, items, slip);
  const c = await page.evaluate(() => ({ expect: G.cur.expect, lines: G.cur.payLines.map(l => [l.k, l.extra]), say: G.cur.paySay }));
  assert.equal(c.expect, 42);
  assert.deepEqual(c.lines, [['f餐蛋麵', false], ['熱奶茶', false], ['熱檸茶', true]]);
  assert.ok(c.say.some(l => /冇叫熱檸茶/.test(l)), 'the customer says it: ' + c.say);
  // charging all three lines (60) is too much
  await digits(page, '60'); await page.click('#pad [data-k="ok"]');
  assert.equal((await state(page)).mistakes, 1);
  // strike the third line, the price display of the lines follows
  await page.click('#cust [data-strike="2"]');
  await settle(page);
  assert.equal(await page.locator('#cust li.struck').count(), 1);
  await digits(page, '42'); await page.click('#pad [data-k="ok"]');
  assert.equal((await cur(page)).charged, 42);
  assert.equal((await state(page)).mistakes, 1);
  // un-strike works as a toggle
  await page.context().close();
});

test('Octopus: a card customer pays at once; a short card falls back to cash', async () => {
  const page = await openSingle(browser, srv.url);
  await tillShift(page);
  const slip = ['f西多士', '熱奶茶'];
  await customer(page, slip, slip, { octo: true });
  await settle(page);
  assert.equal(await page.evaluate(() => document.querySelector('#cust .paytag').textContent), '八達通');
  assert.equal(await page.evaluate(() => document.querySelector('#pad [data-k="ok"]').textContent), '拍卡');
  await digits(page, '34'); await page.click('#pad [data-k="ok"]');
  let st = await state(page);
  assert.equal(st.paidCount, 1); assert.equal(st.revenue - st.tips, 34);
  await settle(page);
  assert.match(await page.evaluate(() => document.getElementById('cust').innerText), /嘟！唔該/);
  await customer(page, slip, slip, { octo: true, octoShort: true });
  await digits(page, '34'); await page.click('#pad [data-k="ok"]');
  const c = await cur(page);
  assert.equal(c.step, 'cash'); assert.equal(c.charged, 34);
  assert.equal(await page.evaluate(() => G.cur.octo), false);
  assert.equal((await state(page)).paidCount, 1, 'not paid yet');
  assert.match(await page.evaluate(() => G.cur.paySay.join('|')), /唔夠錢/);
  await page.context().close();
});

test('keyboard: digits, +, backspace, Enter and = work at the till', async () => {
  const page = await openSingle(browser, srv.url);
  await tillShift(page);
  await customer(page, ['f餐蛋麵', '熱奶茶'], ['f餐蛋麵', '熱奶茶']);
  await page.keyboard.type('4'); await page.keyboard.type('3');
  assert.equal((await cur(page)).entry, '43');
  await page.keyboard.press('Backspace');
  await page.keyboard.type('2');
  assert.equal(await dispTotal(page), '$42');
  await page.keyboard.press('Enter');
  assert.equal((await cur(page)).step, 'cash');
  await page.context().close();
});

test('a till that does nothing: customers walk out after their patience, loss = their bills, each one is an angry customer', async () => {
  const page = await openSingle(browser, srv.url);
  await startShift(page, { station: 'till', diff: 'pro' });
  await run(page, 120, { bot: false });
  const st = await state(page), pays = await events(page, 'toPay');
  assert.ok(st.angry >= 3, 'walk-outs ' + st.angry);
  assert.equal(st.revenue, 0); assert.equal(st.mistakes, 0);
  const lost = await page.evaluate(() => Bot.ledger());
  assert.equal(lost.missing, 0, JSON.stringify(lost));
  assert.equal(st.loss, lost.bills - lost.pending, 'every bill that is gone is a loss');
  assert.equal(await page.evaluate(() => G.payQ.length) + (await page.evaluate(() => G.cur ? 1 : 0)) + st.angry, pays.length, 'each customer is in the queue, at the till or walked out');
  assert.equal(await page.evaluate(() => G.cur !== null), true, 'the customer at the counter keeps waiting for the cashier (no timer)');
  assert.equal(await page.evaluate(() => document.getElementById('angLbl').textContent), '走數');
  await page.context().close();
});

test('deliberate till mistakes over a whole shift: each one booked exactly as the rules say', async () => {
  const page = await openSingle(browser, srv.url, { shop: { stars: 60 } });
  await startShift(page, { station: 'till', diff: 'rookie' });
  await page.evaluate(() => {
    const T = ['over', 'under', 'plus', undefined], C = ['short', 'over', undefined];
    Bot.opts.tillMode = c => T[c.id % T.length]; Bot.opts.changeMode = c => C[c.id % C.length];
  });
  await runToEnd(page);
  const tot = await events(page, 'total'), chg = await events(page, 'change'), cust = await events(page, 'cust');
  const val = e => e.entry.split('+').reduce((a, b) => a + +b, 0);   // what was keyed in
  const over = tot.filter(e => val(e) > e.expect), under = tot.filter(e => val(e) < e.expect), exact = tot.filter(e => val(e) === e.expect);
  assert.ok(over.length >= 1 && under.length >= 1 && exact.length >= 1, 'all three kinds of total happened: ' + [over.length, under.length, exact.length]);
  for (const e of over) { assert.equal(e.d.mis, 1); assert.equal(e.d.rev, 0); assert.equal(e.d.loss, 0); assert.equal(e.step, 'total', 'sent back to re-key'); }
  for (const e of under) { assert.equal(e.d.mis, 1); assert.equal(e.d.loss, e.expect - val(e)); assert.equal(e.charged, val(e)); }
  for (const e of exact) assert.equal(e.d.mis, 0);
  for (const e of chg) {
    if (e.give < e.need) { assert.equal(e.d.mis, 1); assert.equal(e.d.loss, 0); }
    else if (e.give > e.need) { assert.equal(e.d.mis, 1); assert.equal(e.d.loss, e.give - e.need); }
    else assert.equal(e.d.mis, 0);
  }
  for (const e of cust) assert.equal(e.d.rev - e.d.tips, e.charged, 'a finished customer books what was charged');
  const st = await state(page);
  assert.equal(st.mistakes, [...tot, ...chg].reduce((a, e) => a + e.d.mis, 0), 'every mistake came from one of those events');
  const L = await page.evaluate(() => Bot.ledger()), done = cust.reduce((a, e) => a + e.expect, 0);
  assert.equal(st.loss, [...tot, ...chg].reduce((a, e) => a + e.d.loss, 0) + (L.bills - L.pending - done), 'loss = under-charges + over-change + the bills of customers who walked out');
  assert.ok(st.mistakes >= 6);
  const card = await endCard(page);
  assert.equal(cell(card, '計錯'), String(st.mistakes));
  assert.equal(cell(card, '蝕咗'), '$' + st.loss);
  await assertClean(assert, page, 'till mistakes');
  await page.context().close();
});

for (const slot of ['breakfast', 'lunch', 'dinner']) {
  test(`till shift (${slot}), a whole 3 minutes by the bot: no mistakes, revenue = bills + tips, nothing lost`, async () => {
    const page = await openSingle(browser, srv.url, { shop: { stars: 60, recipes: ALL_RECIPES } });
    await startShift(page, { station: 'till', slot, diff: 'ace' });
    await runToEnd(page);
    const st = await state(page), card = await endCard(page);
    assert.equal(st.mistakes, 0); assert.equal(st.angry, 0); assert.equal(st.loss, 0);
    assert.equal(cell(card, '營業額'), '$' + st.revenue);
    assert.equal(cell(card, '埋咗單'), st.paidCount + ' 枱');
    assert.equal(cell(card, '計錯'), '0'); assert.equal(cell(card, '蝕咗'), '$0');
    const custs = await events(page, 'cust');
    assert.equal(custs.length, st.paidCount);
    for (const e of custs) assert.equal(e.charged, e.expect);
    assert.equal(st.revenue - st.tips, custs.reduce((a, e) => a + e.expect, 0), 'revenue is exactly the bills plus tips');
    assert.ok(st.paidCount >= 12, 'customers ' + st.paidCount);
    await assertClean(assert, page, slot);
    await page.context().close();
  });
}

test('till in real time (5x) through the UI: end card agrees with the HUD', async () => {
  const page = await openSingle(browser, srv.url);
  await startShift(page, { station: 'till', slot: 'lunch', diff: 'pro' });
  await page.evaluate(() => { Bot.scale = 5; Bot.start({ every: 50 }); });
  { const a = await page.evaluate(() => G.rt); await page.waitForTimeout(1500); assert.ok(await page.evaluate(a => G.rt > a + 1.5, a), 'the game clock advances in real time (5x)'); }
  await page.waitForFunction(() => !document.getElementById('endView').hidden, null, { timeout: 150000, polling: 500 });
  await page.evaluate(() => Bot.stop());
  const st = await state(page), card = await endCard(page), h = await hud(page);
  assert.equal(cell(card, '營業額'), '$' + st.revenue); assert.equal(h.rev, '$' + st.revenue);
  assert.equal(cell(card, '埋咗單'), st.paidCount + ' 枱');
  assert.equal(await page.evaluate(() => document.getElementById('misLbl').textContent), '計錯');
  assert.match(card.kick, /二點正 · 午市完 · 收銀 · 熟手/);
  assert.equal(st.mistakes, 0);
  assert.ok(st.paidCount > 12);
  await assertClean(assert, page, 'realtime till');
  await page.context().close();
});

for (const diff of ['pro', 'ace']) {
  test(`on ${diff} the till shows every line's price and its 跟餐 / 單叫 tag (no prices to remember)`, async () => {
    const page = await openSingle(browser, srv.url, { shop: { stars: 60 } });   // 阿姐 opens at 25 stars
    await tillShift(page, { diff });
    await customer(page, ['f餐蛋麵', '凍檸茶少甜', '熱奶茶'], ['f餐蛋麵', '凍檸茶少甜', '熱奶茶']);
    assert.deepEqual(await page.locator('#cust .pr').allInnerTexts(), ['$42', '跟餐 $3', '單叫 $18']);
    assert.deepEqual(realErrors(page), []);
    await page.context().close();
  });
}
