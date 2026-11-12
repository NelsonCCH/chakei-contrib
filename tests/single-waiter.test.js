// Single player, waiter (伙記): seating, taking orders, mistakes, patience, dirty tables, the computer players behind
// the waiter, and a whole shift in real (scaled) time. Expected numbers come from the oracle in helpers/bots.browser.js.
import { go } from './helpers/intro.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers/server.js';
import { launch, realErrors, shot } from './helpers/browser.js';
import { openSingle, startShift, run, runToEnd, state, hud, endCard, cell, assertClean, perfectAI, ALL_RECIPES } from './helpers/single.js';

let srv, browser;
before(async () => { srv = await startServer(); browser = await launch(); });
after(async () => { await browser?.close(); await srv?.stop(); });

const events = (page, type) => page.evaluate(t => Bot.ev.filter(e => e.type === t), type);
const MIXED = ['omit', 'extra', 'drink', 'temp', 'sweet', 'correct'];

for (const slot of ['lunch', 'breakfast', 'dinner']) {
  test(`correct slips (${slot}): slip = what was asked, till charges the rule price, no mistakes, tips follow the combo`, async () => {
    const page = await openSingle(browser, srv.url, { shop: { recipes: ALL_RECIPES } });
    await startShift(page, { slot });
    await run(page, 150);
    const orders = await page.evaluate(() => Bot.orders);
    assert.ok(orders.length >= 12, 'at least 12 orders written, got ' + orders.length);
    for (const o of orders) {
      assert.equal(o.how, 'none', 'correct mode');
      assert.ok(o.correct, `slip ${o.slip} should equal ${o.wanted}`);
    }
    const subs = await events(page, 'submit');
    for (const e of subs) assert.deepEqual([...e.slip].sort(), [...e.items].sort(), 'slip equals the order the game holds');
    for (const e of await events(page, 'toPay')) assert.equal(e.expect, await page.evaluate(([i, s]) => Oracle.expectPay(i, s), [e.items, e.slip]), 'bill of ' + e.items);
    for (const e of await events(page, 'serve')) assert.equal(e.d.mis, 0, 'no mistake when the slip is right');
    for (const e of await events(page, 'good')) {
      assert.equal(e.d.tips, await page.evaluate(([c, f]) => Oracle.tipFor(c, f), [e.combo, e.fever]), 'tip at combo ' + e.combo);
      assert.equal(e.d.rev, e.d.tips, 'a good deed adds only the tip to revenue');
    }
    const st = await state(page);
    assert.equal(st.mistakes, 0); assert.equal(st.angry, 0);
    const L = await page.evaluate(() => Bot.ledger());
    assert.equal(L.missing, 0, 'money conservation ' + JSON.stringify(L));
    assert.ok(L.net > 0);
    await assertClean(assert, page, slot);
    await page.context().close();
  });
}

test('deliberate wrong slips: complaint at serve, mistakes +1 each, wrong line never billed, bill follows the rules', async () => {
  const page = await openSingle(browser, srv.url);
  await startShift(page, { slot: 'lunch' });
  await page.evaluate(m => { Bot.opts.sheetMode = g => m[g.id % m.length]; }, MIXED);
  await run(page, 170);
  const orders = await page.evaluate(() => Bot.orders);
  const wrong = orders.filter(o => o.how !== 'none');
  assert.ok(wrong.length >= 6, 'enough wrong slips: ' + wrong.length);
  for (const o of orders) assert.equal(o.correct, o.how === 'none', `${o.how}: slip ${o.slip} vs ${o.wanted}`);
  const serves = await events(page, 'serve'), byId = Object.fromEntries(orders.map(o => [o.id, o]));
  for (const e of serves) { const o = byId[e.id]; if (o) assert.equal(e.d.mis, o.how === 'none' ? 0 : 1, 'mistake counted once, at serve, for ' + o.how); }
  const served = serves.filter(e => byId[e.id] && byId[e.id].how !== 'none').length;
  assert.ok(served >= 4);
  const st = await state(page);
  assert.equal(st.mistakes, serves.reduce((a, e) => a + e.d.mis, 0));
  assert.equal(st.mistakes, served);
  // the bill only contains what the customers really ordered
  for (const e of await events(page, 'toPay')) assert.equal(e.expect, await page.evaluate(([i, s]) => Oracle.expectPay(i, s), [e.items, e.slip]));
  const L = await page.evaluate(() => Bot.ledger());
  assert.equal(L.missing, 0, JSON.stringify(L));
  // a mistake breaks the combo
  assert.ok((await events(page, 'break')).length > 0);
  // the mistakes are logged for the end screen: what was said, what was written, what it should have been
  const err = await page.evaluate(() => G.errLog);
  assert.ok(err.length > 0 && err.length <= 12);
  for (const x of err) { assert.ok(x.say && x.tb && x.said && x.want.length); }
  await runToEnd(page);
  const card = await endCard(page);
  assert.equal(cell(card, '落錯單'), String(st.mistakes > 0 ? (await state(page)).mistakes : 0));
  assert.match(await page.evaluate(() => document.querySelector('#result details.errs summary').textContent), /睇返邊幾張單落錯/);
  await assertClean(assert, page, 'mixed');
  await page.context().close();
});

test('real mouse: pick group, see which tables fit, seat, refusals (too big, couple, shared), write the slip, send', async () => {
  const page = await openSingle(browser, srv.url);
  await startShift(page);
  await page.evaluate(() => Bot.quiet());
  const toast = () => page.evaluate(() => document.getElementById('toast').textContent);
  const grp = (id) => page.evaluate(i => { const g = byId(i); return g && { state: g.state, table: g.table }; }, id);
  // a party of four cannot sit at the two-seaters
  const four = await page.evaluate(() => Bot.inject(4, { fields: { label: '一家四口' } }));
  await page.locator('#queue .grp').first().click();
  await page.waitForSelector('#floor .tbl.fit');
  assert.equal(await page.locator('#floor .tbl.fit').count(), 4, 'four booths fit');
  assert.equal(await page.locator('#floor .tbl.nofit').count(), 2, 'both small tables do not');
  await page.locator('#floor .tbl[data-t="4"]').click();
  assert.match(await toast(), /位唔夠/);
  assert.equal((await grp(four)).state, 'queue');
  await page.locator('#floor .tbl[data-t="0"]').click();
  assert.deepEqual(await grp(four), { state: 'think', table: 0 });
  await page.waitForFunction(() => /睇餐牌/.test(document.querySelector('#floor .tbl[data-t="0"]').innerText));
  // a couple does not share, and nobody sits with a couple
  const couple = await page.evaluate(() => Bot.inject(2, { fields: { label: '情侶', noShare: true } }));
  await page.locator('#queue .grp').first().click();
  await page.locator('#floor .tbl[data-t="0"]').click();
  assert.match(await toast(), /位唔夠|情侶唔想搭枱/);
  await page.locator('#floor .tbl[data-t="4"]').click();
  assert.deepEqual(await grp(couple), { state: 'think', table: 4 });
  const solo = await page.evaluate(() => Bot.inject(1));
  await page.locator('#queue .grp').first().click();
  await page.locator('#floor .tbl[data-t="4"]').click();
  assert.match(await toast(), /位唔夠|情侶/);
  await page.locator('#floor .tbl[data-t="1"]').click();
  assert.deepEqual(await grp(solo), { state: 'think', table: 1 });
  // sharing: a party of two joins the empty seats of table 1 (cap 4, one seat used)
  const duo = await page.evaluate(() => Bot.inject(2));
  await page.locator('#queue .grp').first().click();
  await page.locator('#floor .tbl[data-t="1"]').click();
  assert.deepEqual(await grp(duo), { state: 'think', table: 1 });
  assert.equal(await page.evaluate(() => occupied(1)), 3);
  // tapping empty floor drops the selection
  const extra = await page.evaluate(() => Bot.inject(1));
  await page.locator('#queue .grp').first().click();
  assert.equal(await page.evaluate(() => G.selected !== null), true);
  await page.locator('#queue .grp').first().click();
  assert.equal(await page.evaluate(() => G.selected), null, 'tapping the group again un-selects it');
  await page.evaluate(id => { leave(byId(id), false); }, extra);
  // wait for the party of four to be ready to order, then write a slip by hand
  await page.evaluate(() => {
    const g = G.groups.find(g => g.table === 0);
    g.persons = [{ food: '餐蛋麵', set: null, dish: null, drink: { d: '檸茶', cold: true, sweet: 1, noice: true } }, { food: null, set: null, dish: null, drink: { d: '奶茶', cold: false, sweet: 0, noice: false } }];
    g.size = 2; g.items = itemsOf(g.persons); g.lines = g.persons.map(p => sayPerson(p) + '。');
  });
  await run(page, 12, { bot: false });
  assert.equal((await grp(four)).state, 'order');
  assert.equal(await page.locator('#floor .tbl[data-t="0"] .st-order').count(), 1, '"落單!" bubble');
  await page.locator('#floor .tbl[data-t="0"]').click();
  assert.equal(await page.locator('#sheetWrap').isVisible(), true);
  await page.locator('#sheet .send').click();   // empty slip
  assert.match(await toast(), /空/);
  assert.equal(await page.locator('#sheetWrap').isVisible(), true, 'empty slip is not sent');
  await page.click('#sheet [data-add="f"][data-id="餐蛋麵"]');
  await page.click('#sheet [data-add="k"][data-id="檸茶"]');
  await page.click('#sheet [data-temp="cold"]');
  await page.click('#sheet [data-sweet="1"]');
  await page.click('#sheet [data-noice]');
  await page.click('#sheet [data-add="k"][data-id="奶茶"]');
  const spare = (await page.locator('#sheet [data-add="f"]').evaluateAll(bs => bs.map(b => b.dataset.id))).find(id => id !== '餐蛋麵');
  await page.click(`#sheet [data-add="f"][data-id="${spare}"]`);   // wrong extra
  assert.deepEqual(await page.locator('#sheet .slip li button[data-pick]').allInnerTexts(), ['餐蛋麵', '凍檸茶少甜走冰', '熱奶茶', spare]);
  await page.click('#sheet [data-del="3"]');
  assert.equal(await page.locator('#sheet .slip li button[data-pick]').count(), 3);
  await page.locator('#sheet .later').click();   // put it away: the customer keeps waiting for you, no timer
  assert.equal(await page.locator('#sheetWrap').isVisible(), false);
  await page.locator('#floor .tbl[data-t="0"]').click();
  assert.equal(await page.locator('#sheet .slip li button[data-pick]').count(), 3, 'draft kept');
  await page.locator('#sheet [data-pick="1"]').click();
  await page.click('#sheet [data-temp="hot"]');   // now it is the wrong temperature: customer wanted cold
  await page.locator('#sheet .send').click();
  const g = await page.evaluate(() => { const g = G.groups.find(g => g.table === 0); return { slip: g.slip, ok: g.result.correct, complaint: g.result.complaint, state: g.state }; });
  assert.deepEqual(g.slip, ['f餐蛋麵', '熱檸茶', '熱奶茶']);
  assert.equal(g.ok, false);
  assert.equal(g.complaint, '我叫凍嘅！');
  assert.equal(g.state, 'wait');
  await run(page, 25, { bot: false });
  assert.equal((await state(page)).mistakes, 1);
  assert.equal((await hud(page)).mis, '1');
  assert.match(await page.evaluate(() => G.errLog[0].say), /我叫凍嘅/);
  await shot(page, 'single-waiter-mouse');
  assert.deepEqual(realErrors(page), []);
  await page.context().close();
});

test('dirty table: seating onto a dirty table cleans it first, then a second tap seats', async () => {
  const page = await openSingle(browser, srv.url);
  await startShift(page);
  await page.evaluate(() => { Bot.quiet(); G.tables[0].dirty = 2; });
  const id = await page.evaluate(() => Bot.inject(4));
  assert.equal(await page.evaluate(() => seatProblem(byId(G.groups[0].id), G.tables[0])), 'dirty');
  await page.locator('#queue .grp').first().click();
  await page.waitForSelector('#floor .tbl.fit');
  assert.equal(await page.locator('#floor .tbl[data-t="0"].fit').count(), 1, 'a dirty table that would fit once cleaned is highlighted');
  await page.locator('#floor .tbl[data-t="0"]').click();
  assert.equal(await page.evaluate(() => G.tables[0].dirty), 0);
  assert.match(await page.evaluate(() => document.getElementById('toast').textContent), /執緊枱/);
  assert.equal(await page.evaluate(i => byId(i).state, id), 'queue');
  await page.locator('#floor .tbl[data-t="0"]').click();
  assert.equal(await page.evaluate(i => byId(i).state, id), 'think');
  // after eating the party leaves its dishes: seats stay blocked until a tap on the table
  await page.evaluate(() => { G.tables[5].dirty = 1; });
  await page.waitForFunction(() => /要執枱/.test(document.querySelector('#floor .tbl[data-t="5"]').innerText));
  await page.locator('#floor .tbl[data-t="5"]').click();
  assert.equal(await page.evaluate(() => G.tables[5].dirty), 0);
  assert.deepEqual(realErrors(page), []);
  await page.context().close();
});

test('patience: door 45 s, order 50 s (pro); a waiter who does nothing loses them angry; an open slip holds them, a put-away one only 10 s more', async () => {
  let page = await openSingle(browser, srv.url);
  await startShift(page, { diff: 'pro' });
  await page.evaluate(() => Bot.quiet());
  const gid = await page.evaluate(() => Bot.inject(1));
  await run(page, 50, { bot: false });
  let lv = await events(page, 'leave');
  assert.equal(lv.length, 1);
  assert.equal(lv[0].id, gid); assert.equal(lv[0].state, 'queue'); assert.equal(lv[0].angry, true);
  assert.equal(lv[0].max, 45, 'queuePat 45 x pro 1.0');
  assert.ok(lv[0].t >= lv[0].until && lv[0].t < lv[0].until + .2, 'left exactly when the bar ran out');
  assert.equal((await state(page)).angry, 1);
  // seated but ignored
  await page.evaluate(() => { const id = Bot.inject(1); seat(byId(id), G.tables[0]); });
  await run(page, 70, { bot: false });
  lv = await events(page, 'leave');
  assert.equal(lv.length, 2); assert.equal(lv[1].state, 'order'); assert.equal(lv[1].max, 50);
  assert.equal((await state(page)).angry, 2);
  assert.equal((await hud(page)).ang, '2');
  // slip open: the customer waits as long as it stays open; put away (收埋): 10 s more, then the slip is released
  // (the table flashes 落 again) and patience carries on from where it stopped.
  // A fresh shift: the steps below need about 160 of its 180 game seconds.
  await page.context().close();
  page = await openSingle(browser, srv.url);
  await startShift(page, { diff: 'pro' });
  await page.evaluate(() => Bot.quiet());
  const gid2 = await page.evaluate(() => { const id = Bot.inject(1); seat(byId(id), G.tables[1]); return id; });
  await run(page, 15, { bot: false });
  await page.locator('#floor .tbl[data-t="1"]').click();
  const left0 = await page.evaluate(id => byId(id).until - G.t, gid2);
  await run(page, 55, { bot: false });   // longer than the whole order patience (50 s), slip still open
  const g2 = () => page.evaluate(id => { const g = byId(id); return g ? { st: g.state, taken: g.taken, left: g.until - G.t, draft: g.draft.length } : null; }, gid2);
  assert.equal((await g2()).st, 'order', 'nobody walks out while their slip is open');
  assert.ok(Math.abs((await g2()).left - left0) < .2, 'patience stood still while the slip was open');
  await page.locator('#sheet [data-add]:visible').first().click();   // write one line, then put it away
  await page.locator('#sheet .later').click();
  await run(page, 9.5, { bot: false });
  assert.equal((await g2()).taken, true, 'still waiting within the 10 s grace');
  await run(page, 1, { bot: false });
  let s2 = await g2();
  assert.equal(s2.taken, false, 'after the grace the slip is released: the table asks for an order again');
  assert.equal(s2.draft, 1, 'what was written stays on the slip');
  assert.ok(Math.abs(s2.left - (left0 - .5)) < .3, `patience resumes where it stopped (${s2.left.toFixed(2)} vs ${left0.toFixed(2)})`);
  await run(page, s2.left + 1, { bot: false });
  lv = await events(page, 'leave');
  assert.equal(lv.at(-1).id, gid2); assert.equal(lv.at(-1).state, 'order'); assert.equal(lv.at(-1).angry, true);
  assert.equal((await state(page)).angry, 1, 'the only walk-out in this shift');
  // reopening within the grace stops the countdown again
  const gid3 = await page.evaluate(() => { const id = Bot.inject(1); seat(byId(id), G.tables[2]); return id; });
  await run(page, 5, { bot: false });
  await page.locator('#floor .tbl[data-t="2"]').click(); await page.locator('#sheet .later').click();
  await run(page, 6, { bot: false });
  await page.locator('#floor .tbl[data-t="2"]').click();
  await run(page, 30, { bot: false });
  assert.equal(await page.evaluate(id => byId(id) && byId(id).taken, gid3), true, 'reopened slip: waiting again');
  await assertClean(assert, page, 'patience');
  await page.context().close();
});

test('door overflow: a seventh group is turned away (angry), exactly the queue limit waits', async () => {
  const page = await openSingle(browser, srv.url);
  await startShift(page);
  await page.evaluate(() => Bot.quiet());
  await page.evaluate(() => { for (let i = 0; i < 9; i++) Bot.inject(1); });
  const s = await page.evaluate(() => ({ q: G.groups.filter(g => g.state === 'queue').length, angry: G.angry, max: CFG.queueMax }));
  assert.equal(s.q, s.max); assert.equal(s.angry, 9 - s.max);
  await page.context().close();
});

for (const diff of ['rookie', 'pro', 'ace']) {
  test(`the computer cook/bar/till keep the shop moving (${diff}, with their normal slips-ups): no stuck group, queues drain`, async () => {
    const page = await openSingle(browser, srv.url, { shop: { stars: 60 } });
    await startShift(page, { slot: 'dinner', diff });
    await page.evaluate(() => { CFG.aiErr = .12; CFG.aiBarErr = .05; CFG.aiKitErr = .04; });
    let worst = 0;
    for (let i = 0; i < 6; i++) { await run(page, 30); worst = Math.max(worst, await page.evaluate(() => Bot.age().worst)); }
    assert.ok(await page.evaluate(() => !G.running), 'shift ended');
    // second shift, then stop the arrivals and see everything empty out
    await go(page, '#againBtn');
    await page.evaluate(() => Bot.reset());
    await page.evaluate(() => { CFG.aiErr = .12; CFG.aiBarErr = .05; CFG.aiKitErr = .04; Bot.quiet(); G.nextSpawn = G.t + 40; });
    await run(page, 40);
    await page.evaluate(() => { G.nextSpawn = Infinity; });
    await run(page, 120);
    const left = await page.evaluate(() => ({ groups: G.groups.length, payQ: G.payQ.length, cur: !!G.at.cur, running: G.running }));
    assert.deepEqual(left, { groups: 0, payQ: 0, cur: false, running: true }, 'everything served or gone after 120 s');
    const L = await page.evaluate(() => Bot.ledger());
    assert.equal(L.missing, 0, JSON.stringify(L));
    assert.ok(worst < 130, 'no group parked for ever: ' + worst);
    await assertClean(assert, page, diff);
    await page.context().close();
  });
}

test('computer players alone (all four stations AI): invariants hold for every slot, nothing parks, bills balance', async () => {
  const page = await openSingle(browser, srv.url, { shop: { stars: 60 } });
  for (const slot of ['breakfast', 'lunch', 'dinner']) {
    await startShift(page, { slot, diff: 'pro' });
    await page.evaluate(() => { CFG.aiErr = .12; CFG.aiBarErr = .05; CFG.aiKitErr = .04; G.roles = { waiter: 'ai', bar: 'ai', kitchen: 'ai', till: 'ai' }; });
    await run(page, 179, { bot: false });
    const st = await state(page);
    assert.ok(st.served >= 12, `${slot}: served ${st.served}`);
    assert.ok(st.revenue > 0 && st.angry === 0 && st.mistakes === 0, `${slot} computer shop ${JSON.stringify(st)}`);
    const L = await page.evaluate(() => Bot.ledger());
    assert.equal(L.missing, 0, slot + JSON.stringify(L));
    await run(page, 5, { bot: false });
    await page.click('#homeBtn');
    await page.evaluate(() => Bot.reset());
  }
  await assertClean(assert, page, 'all-ai');
  await page.context().close();
});

test('a whole shift in real time (5x speed) through the UI: end card, HUD and totals agree', async () => {
  const page = await openSingle(browser, srv.url);
  await startShift(page, { slot: 'lunch', diff: 'pro' });
  await page.evaluate(() => { Bot.scale = 5; Bot.start({ every: 50 }); });
  { const a = await page.evaluate(() => G.rt); await page.waitForTimeout(1500); assert.ok(await page.evaluate(a => G.rt > a + 1.5, a), 'the game clock advances in real time (5x)'); }
  const t0 = Date.now();
  await page.waitForFunction(() => !document.getElementById('endView').hidden, null, { timeout: 150000, polling: 500 });
  assert.ok(Date.now() - t0 > 20000, 'this really ran in time, not in one jump: ' + (Date.now() - t0) + ' ms');
  await page.evaluate(() => Bot.stop());
  const st = await state(page), card = await endCard(page), h = await hud(page);
  assert.equal(cell(card, '營業額'), '$' + st.revenue);
  assert.equal(cell(card, '落錯單'), String(st.mistakes));
  assert.equal(cell(card, '嬲走'), String(st.angry));
  assert.equal(cell(card, '招呼咗'), `${st.served + await page.evaluate(() => G.groups.filter(g => g.state === 'eat' || g.state === 'wait').length)} 枱`);
  assert.equal(h.rev, '$' + st.revenue);
  assert.equal(h.clock, '14:00');
  assert.match(card.kick, /二點正 · 午市完 · 伙記 · 熟手/);
  assert.equal(st.mistakes, 0); assert.equal(st.angry, 0);
  assert.ok(st.served >= 15, 'served ' + st.served);
  assert.equal((await page.evaluate(() => Bot.ledger())).missing, 0);
  await shot(page, 'single-waiter-endcard');
  await assertClean(assert, page, 'realtime');
  await page.context().close();
});

test('fuzz: 8000 random wrong slips - grading says "wrong" exactly when the bags differ, always with a complaint; disputes and bills match the rules', async () => {
  const page = await openSingle(browser, srv.url, { shop: { stars: 60, recipes: ALL_RECIPES } });
  await startShift(page);
  const r = await page.evaluate(() => {
    const bad = [], keep = slot, pickOf = a => a[Math.floor(Math.random() * a.length)];
    let wrong = 0, complaints = {};
    for (let n = 0; n < 8000; n++) {
      slot = pickOf(['breakfast', 'lunch', 'dinner']);
      const od = genOrder(1 + Math.floor(Math.random() * 4)), items = itemsOf(od.persons), slip = [...items];
      for (let m = Math.floor(Math.random() * 3); m > 0; m--) {
        const how = Math.floor(Math.random() * 6);
        if (how === 0 && slip.length) slip.splice(Math.floor(Math.random() * slip.length), 1);
        else if (how === 1 && slip.length) slip.push(pickOf(slip));
        else if (how === 2) slip.push('f' + pickOf(FOODS).id);
        else if (how === 3) slip.push(drinkKey(randDrink()));
        else if (how === 4) slip.push(Math.random() < .5 ? setKey(randSet()) : dishKey(randDish()));
        else { const i = slip.findIndex(k => !isMeal(k)); if (i >= 0) slip[i] = (slip[i][0] === '凍' ? '熱' : '凍') + slip[i].slice(1); }
      }
      let g, dis, tot;
      try { g = grade(items, slip); dis = disputes(items, slip); tot = priceSlip(slip.filter((k, i) => !dis.includes(i))).total; }
      catch (e) { bad.push(['threw ' + e.message, items, slip]); continue; }
      const same = Oracle.correct(items, slip);
      if (g.correct !== same) bad.push(['grade differs', items, slip, g]);
      if (!g.correct) { wrong++; if (typeof g.complaint !== 'string' || !g.complaint) bad.push(['no complaint', items, slip]); else complaints[g.complaint.replace(/[^我個叫要熱凍㗎！喎？講冇咗]/g, '').slice(0, 4)] = 1; }
      else if (g.complaint) bad.push(['complaint on a right slip', items, slip]);
      if (JSON.stringify(dis) !== JSON.stringify(Oracle.disputes(items, slip))) bad.push(['disputes differ', items, slip, dis]);
      let want; try { want = Oracle.expectPay(items, slip); } catch (e) { bad.push(['oracle threw ' + e.message, items, slip]); continue; }
      if (tot !== want) bad.push(['bill differs', items, slip, tot, want]);
      if (!(tot >= 0) || !Number.isFinite(tot)) bad.push(['bad bill', items, slip, tot]);
    }
    slot = keep;
    return { bad: bad.slice(0, 4), nBad: bad.length, wrong, kinds: Object.keys(complaints).length };
  });
  assert.deepEqual(r.bad, [], `${r.nBad} bad cases`);
  assert.ok(r.wrong > 3000, 'enough wrong slips: ' + r.wrong);
  assert.ok(r.kinds >= 4, 'different complaints: ' + r.kinds);
  await assertClean(assert, page, 'fuzz');
  await page.context().close();
});
