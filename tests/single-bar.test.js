// Single player, bar (水吧): the tea pot, every drink recipe through the buttons, mistakes and re-makes, late customers,
// and whole shifts. The recipes are re-derived in helpers/bots.browser.js from the help text (Oracle.recipe).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers/server.js';
import { launch, realErrors, shot } from './helpers/browser.js';
import { openSingle, startShift, run, runToEnd, state, hud, endCard, cell, assertClean, endless, settleTickets, drain, ALL_RECIPES } from './helpers/single.js';

let srv, browser;
before(async () => { srv = await startServer(); browser = await launch(); });
after(async () => { await browser?.close(); await srv?.stop(); });

const events = (page, type) => page.evaluate(t => Bot.ev.filter(e => e.type === t), type);
const toast = page => page.evaluate(() => document.getElementById('toast').textContent);
const pot = page => page.evaluate(() => ({ st: G.pot.st, level: G.pot.level, pulls: G.pot.pulls, until: G.pot.until, rt: G.rt, phase: G.phase }));
// a real mouse click on the tea pot (it is drawn on the canvas)
async function clickPot(page) {
  const p = await page.evaluate(() => { const h = BSC.hits.find(h => h.kind === 'pot'), r = BSC.tv.getBoundingClientRect(); return { x: r.left + h.x + h.w / 2, y: r.top + h.y + h.h / 2, same: hitAt(BSC, { clientX: r.left + h.x + h.w / 2, clientY: r.top + h.y + h.h / 2 }) === h }; });
  assert.ok(p.same, 'pot hit area is the top one at its centre');
  await page.mouse.click(p.x, p.y);
}

test('tea pot, with the real mouse: boil 4 s, steep 3 s, pull 4 times, then the shop opens; drinks wait for it', async () => {
  const page = await openSingle(browser, srv.url);
  await startShift(page, { station: 'bar' });
  await page.waitForFunction(() => BSC.hits.some(h => h.kind === 'pot'));
  let p = await pot(page);
  assert.deepEqual([p.st, p.phase], ['empty', 'prep']);
  assert.match(await toast(page), /煲茶/);
  assert.equal(await page.evaluate(() => document.getElementById('clockLbl').textContent), '開舖前');
  // nothing but the pot works before opening
  await page.click('#barPad [data-b="cold"]');
  assert.match(await toast(page), /煲好茶膽先開門/);
  await clickPot(page);
  p = await pot(page);
  assert.equal(p.st, 'boil'); assert.ok(Math.abs(p.until - p.rt - 4) < .2, 'boil lasts 4 s');
  assert.equal(await page.evaluate(() => G.pot.level), 0);
  await clickPot(page);   // pot is busy: second tap changes nothing
  assert.equal((await pot(page)).st, 'boil');
  await run(page, 3.5, { bot: false });
  assert.equal((await pot(page)).st, 'boil');
  await run(page, .6, { bot: false });
  p = await pot(page);
  assert.equal(p.st, 'steep'); assert.ok(Math.abs(p.until - p.rt - 3) < .2, 'steep lasts 3 s');
  await run(page, 3.1, { bot: false });
  assert.equal((await pot(page)).st, 'pull');
  for (let i = 1; i <= 3; i++) { await clickPot(page); p = await pot(page); assert.deepEqual([p.st, p.pulls], ['pull', i]); }
  await clickPot(page);
  p = await pot(page);
  assert.equal(p.st, 'ready'); assert.equal(p.level, await page.evaluate(() => potCap()), 'full pot');
  assert.match(await toast(page), /有茶喇|開門/);
  await run(page, 1, { bot: false });
  assert.equal((await pot(page)).phase, 'open');
  // full pot: no new boiling
  await clickPot(page);
  assert.equal((await pot(page)).st, 'ready'); assert.match(await toast(page), /仲係滿嘅/);
  await shot(page, 'single-bar-open');
  assert.deepEqual(realErrors(page), []);
  await page.context().close();
});

test('nobody boils the pot: after 20 s the computer boils the first pot and the screen says the shop is open', async () => {
  const page = await openSingle(browser, srv.url);
  await startShift(page, { station: 'bar' });
  assert.equal(await page.evaluate(() => document.getElementById('clockLbl').textContent), '開舖前');
  await run(page, 19, { bot: false });
  assert.deepEqual(await page.evaluate(() => [G.phase, G.pot.st, document.getElementById('clockLbl').textContent]), ['prep', 'empty', '開舖前'], 'still closed at 19 s');
  await run(page, 1.5, { bot: false });
  const p = await pot(page);
  assert.deepEqual([p.phase, p.st, p.level], ['open', 'ready', await page.evaluate(() => potCap())], 'open with a full pot');
  assert.equal(await page.evaluate(() => document.getElementById('clockLbl').textContent), '午市', 'the HUD shows the shift, not 開舖前');
  // the shift's own 180 s start at the opening
  assert.ok(await page.evaluate(() => G.t < 1), 'shift clock starts at the opening');
  // and the pot works for the player at once
  await page.click('#barPad [data-b="hot"]');
  await page.click('#barPad [data-b="茶"]');
  assert.equal((await pot(page)).level, p.level - 1);
  assert.deepEqual(realErrors(page), []);
  await page.context().close();
});

test('bench rules: cup first, tea only from a ready pot (one cup of the pot per 茶), serve needs a ticket, dumping refunds nothing', async () => {
  const page = await openSingle(browser, srv.url);
  await startShift(page, { station: 'bar' });
  await page.evaluate(() => { Bot.quiet(); G.pot = { level: potCap(), st: 'ready', until: 0, pulls: 0 }; G.phase = 'open'; });
  await run(page, 1, { bot: false });
  await page.click('#barPad [data-b="淡奶"]');
  assert.match(await toast(page), /揀熱杯定凍杯先/);
  await page.click('#barPad [data-b="serve"]');
  assert.match(await toast(page), /撳上面張飛揀做邊杯/);
  await page.click('#barPad [data-b="hot"]');
  await page.click('#barPad [data-b="茶"]');
  const cap = await page.evaluate(() => potCap());
  assert.deepEqual(await page.evaluate(() => [G.pot.level, G.bench.ing.茶]), [cap - 1, 1]);
  await page.click('#barPad [data-b="hot"]');
  assert.match(await toast(page), /倒咗佢先/, 'cannot swap the cup while it holds something');
  await page.click('#barPad [data-b="dump"]');
  assert.deepEqual(await page.evaluate(() => [G.bench.cup, Object.keys(G.bench.ing).length, G.pot.level]), [null, 0, cap - 1]);
  // the bench takes at most 3 of one thing
  await page.click('#barPad [data-b="hot"]');
  for (let i = 0; i < 5; i++) await page.click('#barPad [data-b="茶"]');
  assert.equal(await page.evaluate(() => G.bench.ing.茶), 3);
  // drain the pot completely: no tea once it is empty
  await page.evaluate(() => { G.pot.level = 1; });
  await page.click('#barPad [data-b="dump"]'); await page.click('#barPad [data-b="hot"]');
  await page.click('#barPad [data-b="茶"]');
  assert.deepEqual(await page.evaluate(() => [G.pot.level, G.bench.ing.茶]), [0, 1]);
  await page.click('#barPad [data-b="茶"]');
  assert.match(await toast(page), /茶壺冇茶/);
  assert.equal(await page.evaluate(() => G.bench.ing.茶), 1, 'no tea came out');
  assert.deepEqual(realErrors(page), []);
  await page.context().close();
});

test('the player picks the ticket: nothing is picked by itself, before or after a cup, and the bench says so', async () => {
  const page = await openSingle(browser, srv.url);
  await startShift(page, { station: 'bar' });
  await page.evaluate(() => { Bot.quiet(); G.pot = { level: potCap(), st: 'ready', until: 0, pulls: 0 }; G.phase = 'open'; G.nextSpawn = Infinity; });
  await endless(page);
  await page.evaluate(() => Bot.tickets(['熱奶茶', '凍檸茶']));
  await run(page, .5, { bot: false });
  const look = () => page.evaluate(() => ({ target: G.bench.target, txt: document.querySelector('#bench .target').textContent, on: document.querySelectorAll('[data-tk].on').length, open: document.querySelectorAll('[data-tk]:not([disabled])').length }));
  assert.deepEqual(await look(), { target: null, txt: '撳張飛揀做邊杯', on: 0, open: 2 }, 'two tickets waiting, none picked');
  const second = await page.evaluate(() => document.querySelectorAll('[data-tk]')[1].dataset.tk);
  await page.click(`[data-tk="${second}"]`);
  await run(page, .05, { bot: false });   // the next frame draws the pick
  let s = await look();
  assert.deepEqual([s.target && `${s.target.gid}:${s.target.i}`, s.on], [second, 1], 'the player picked the second one, not the most urgent');
  assert.match(s.txt, /^做緊 /);
  // the right cup (a wrong one would come back as a redo)
  await page.evaluate(() => { const t = G.bench.target, r = Oracle.recipe(byId(t.gid).drinks[t.i].k); G.bench.cup = r.cup; G.bench.ing = { ...r.ing }; });
  await page.click('#barPad [data-b="serve"]');
  await run(page, .5, { bot: false });
  s = await look();
  assert.deepEqual(s, { target: null, txt: '撳張飛揀做邊杯', on: 0, open: 1 }, 'after the cup: one ticket left, still not picked for the player');
  await page.click('#barPad [data-b="hot"]');
  await page.click('#barPad [data-b="serve"]');
  assert.match(await toast(page), /撳上面張飛揀做邊杯/);
  assert.equal((await look()).open, 1, 'nothing served without a pick');
  assert.deepEqual(realErrors(page), []);
  await page.context().close();
});

// every drink the menu can make, hot and cold, with every sweetness / no-ice option the waiter can write
const allKeys = page => page.evaluate(() => {
  const out = [];
  for (const d of DRINKS) {
    if (!d.iced) out.push(Oracle.drinkKey({ d: d.id, cold: false, sweet: 0, noice: false }));
    if (d.hot) continue;
    for (const sweet of d.sw ? [0] : [0, 1, 2]) for (const noice of d.iced ? [false] : [false, true]) out.push(Oracle.drinkKey({ d: d.id, cold: true, sweet, noice }));
  }
  return out;
});

test('every drink and every variant, made through the buttons, is judged right (cup + ingredients = the recipe)', async () => {
  const page = await openSingle(browser, srv.url, { shop: { recipes: ALL_RECIPES } });
  await startShift(page, { station: 'bar' });
  await page.evaluate(() => { Bot.quiet(); G.pot = { level: potCap(), st: 'ready', until: 0, pulls: 0 }; G.phase = 'open'; });
  await endless(page);
  const keys = await allKeys(page);
  assert.ok(keys.length >= 58, 'keys ' + keys.length);   // 10 drinks
  for (let i = 0; i < keys.length; i += 6) {
    const batch = keys.slice(i, i + 6);
    await page.evaluate(b => Bot.tickets(b), batch);
    await settleTickets(page);
    await drain(page);
    assert.equal(await page.evaluate(() => G.groups.filter(g => g.state === 'wait').length), 0, 'all drinks of the batch made: ' + batch);
  }
  const serves = (await events(page, 'serve')).filter(e => e.slip.length === 1);
  assert.equal(serves.length, keys.length);
  assert.deepEqual(serves.map(e => e.slip[0]).sort(), [...keys].sort());
  for (const e of serves) { assert.equal(e.bad, false, 'drink judged wrong: ' + e.slip[0]); assert.equal(e.d.mis, 0); }
  const st = await state(page);
  assert.equal(st.cups, keys.length, 'one cup counted per ticket line');
  assert.equal(st.mistakes, 0);
  assert.equal(st.angry, 0);
  await assertClean(assert, page, 'recipes');
  await page.context().close();
});

test('wrong cup / missing ingredient / extra ingredient: the customer sends it back (換), +1 mistake, the re-make is right; third wrong one is eaten anyway', async () => {
  const page = await openSingle(browser, srv.url, { shop: { recipes: ALL_RECIPES } });
  await startShift(page, { station: 'bar' });
  await page.evaluate(() => { Bot.quiet(); G.pot = { level: potCap(), st: 'ready', until: 0, pulls: 0 }; G.phase = 'open'; });
  await endless(page);
  const keys = await page.evaluate(() => ['熱奶茶', '凍檸茶', '凍鴛鴦少甜走冰', '熱咖啡', '凍紅豆冰走甜', '凍阿華田'].map(k => k));
  const hows = ['cup', 'miss', 'extra'];
  for (const how of hows) {
    const before = await page.evaluate(() => Bot.ev.length), mis0 = (await state(page)).mistakes;
    for (const k of keys) {
      await page.evaluate(([k, how]) => { Bot.sab = { pending: how, done: [], added: false }; Bot.tickets([k]); }, [k, how]);
      await settleTickets(page);
      assert.equal(await page.evaluate(() => G.groups.filter(g => g.state === 'wait').length), 0, `${how} ${k} finished`);
    }
    const sv = (await events(page, 'serve')).slice(before ? undefined : 0).filter(e => e.t > 0);
    const mine = sv.slice(-keys.length * 2);
    assert.equal((await state(page)).mistakes - mis0, keys.length, `${how}: exactly one mistake per sabotaged drink`);
    const firsts = mine.filter(e => e.bad);
    assert.equal(firsts.length, keys.length, `${how}: every sabotaged drink was judged wrong`);
    for (const e of firsts) { assert.equal(e.d.mis, 1); assert.equal(e.state, 'wait', 'sent back, not eaten'); }
    const redo = mine.filter(e => !e.bad);
    assert.equal(redo.length, keys.length, 'then served right');
    for (const e of redo) { assert.equal(e.returnsBefore, 1); assert.equal(e.d.mis, 0); assert.equal(e.state, 'eat'); }
  }
  // sabotage every attempt of one drink: sent back twice, then the customer drinks it anyway (3 mistakes in all)
  const m0 = (await state(page)).mistakes;
  const id = await page.evaluate(() => { Bot.sab = { pending: 'cup', done: [], added: false }; return Bot.tickets(['熱奶茶'])[0]; });
  for (let i = 0; i < 400 && await page.evaluate(i => byId(i) && byId(i).state === 'wait', id); i++) {
    await run(page, .15);   // one bot action at a time, so the next wrong cup is armed before the re-make starts
    await page.evaluate(() => { if (!Bot.sab.pending) Bot.sab.pending = 'cup'; });
  }
  const last = (await events(page, 'serve')).filter(e => e.id === id);
  assert.deepEqual(last.map(e => [e.returnsBefore, e.state, e.d.mis]), [[0, 'wait', 1], [1, 'wait', 1], [2, 'eat', 1]]);
  assert.equal((await state(page)).mistakes - m0, 3);
  await page.evaluate(() => { Bot.sab = null; });
  await assertClean(assert, page, 'sabotage');
  await page.context().close();
});

test('a bar that does nothing: waiting customers walk out angry (counted), their table is left dirty', async () => {
  const page = await openSingle(browser, srv.url);
  await startShift(page, { station: 'bar', diff: 'pro' });
  for (let i = 0; i < 20 && await page.evaluate(() => G.phase !== 'open'); i++) await run(page, 2);   // the bot boils the tea, then we stop helping
  assert.equal(await page.evaluate(() => G.phase), 'open');
  const cups0 = (await state(page)).cups;
  await run(page, 100, { bot: false });
  const st = await state(page), lv = (await events(page, 'leave')).filter(e => e.state === 'wait');
  assert.ok(lv.length >= 3, 'customers left: ' + lv.length);
  assert.equal(st.angry, lv.length, 'every walk-out is an angry customer');
  assert.equal(st.cups, cups0, 'no drink was made');
  await assertClean(assert, page, 'idle bar');
  await page.context().close();
});

for (const slot of ['breakfast', 'lunch', 'dinner']) {
  test(`bar shift (${slot}), whole 3 minutes played by the bot: nothing wrong, angry 0, cups = tickets, bills balance`, async () => {
    const page = await openSingle(browser, srv.url, { shop: { stars: 60, recipes: ALL_RECIPES } });
    await startShift(page, { station: 'bar', slot, diff: 'ace' });
    await runToEnd(page);
    const st = await state(page), card = await endCard(page);
    assert.equal(st.running, false);
    assert.equal(cell(card, '營業額'), '$' + st.revenue);
    assert.equal(cell(card, '沖咗'), st.cups + ' 杯');
    assert.equal(cell(card, '沖錯'), '0');
    assert.equal(cell(card, '嬲走'), '0');
    const lines = await page.evaluate(() => Bot.ev.filter(e => e.type === 'submit').reduce((a, e) => a + e.slip.filter(k => !'fsd'.includes(k[0])).length, 0));
    const undone = await page.evaluate(() => G.groups.reduce((a, g) => a + (g.drinks || []).filter(d => !d.done).length, 0));
    assert.equal(st.cups + undone, lines, 'every drink line ordered was made, or is still waiting when the shift ended');
    assert.equal((await page.evaluate(() => Bot.ledger())).missing, 0);
    assert.ok(st.revenue > 800);
    await assertClean(assert, page, slot);
    await page.context().close();
  });
}

test('bar in real time (5x), played through the UI: end card agrees with the HUD', async () => {
  const page = await openSingle(browser, srv.url);
  await startShift(page, { station: 'bar', slot: 'lunch', diff: 'pro' });
  await page.evaluate(() => { Bot.scale = 5; Bot.start({ every: 50 }); });
  { const a = await page.evaluate(() => G.rt); await page.waitForTimeout(1500); assert.ok(await page.evaluate(a => G.rt > a + 1.5, a), 'the game clock advances in real time (5x)'); }
  await page.waitForFunction(() => !document.getElementById('endView').hidden, null, { timeout: 150000, polling: 500 });
  await page.evaluate(() => Bot.stop());
  const st = await state(page), card = await endCard(page), h = await hud(page);
  assert.equal(cell(card, '營業額'), '$' + st.revenue);
  assert.equal(h.rev, '$' + st.revenue);
  assert.equal(cell(card, '沖咗'), st.cups + ' 杯');
  assert.match(card.kick, /二點正 · 午市完 · 水吧 · 熟手/);
  assert.equal(await page.evaluate(() => document.getElementById('misLbl').textContent), '沖錯');
  assert.ok(st.cups > 20, 'cups ' + st.cups);
  assert.equal(st.mistakes, 0);
  await assertClean(assert, page, 'realtime bar');
  await page.context().close();
});

test('bar in the phone layout (枱面版): cups and bottles are tapped on the drawn counter - a whole shift, every drink right', async () => {
  const page = await openSingle(browser, srv.url, { storage: { 'ckf-kmode': 'counter' }, shop: { stars: 60, recipes: ALL_RECIPES } });
  await startShift(page, { station: 'bar', slot: 'lunch', diff: 'pro' });
  assert.equal(await page.evaluate(() => kitMode), 'counter');
  assert.equal(await page.locator('#barPad [data-b="hot"]').count(), 0, 'no cup buttons in this layout: they are on the counter');
  await runToEnd(page);
  const st = await state(page), card = await endCard(page);
  assert.equal(st.mistakes, 0); assert.equal(st.angry, 0);
  assert.equal(cell(card, '沖咗'), st.cups + ' 杯');
  assert.ok(st.cups >= 25, 'cups ' + st.cups);
  assert.equal((await page.evaluate(() => Bot.ledger())).missing, 0);
  await shot(page, 'single-bar-counter');
  await assertClean(assert, page, 'bar counter mode');
  await page.context().close();
});

for (const diff of ['pro', 'ace']) {
  test(`on ${diff} the bar shows the 貓紙 card for the drink being made, and it ticks off the bench`, async () => {
    const page = await openSingle(browser, srv.url, { shop: { stars: 60 } });   // 阿姐 opens at 25 stars
    await startShift(page, { station: 'bar', diff });
    await page.evaluate(() => { Bot.quiet(); G.pot = { level: potCap(), st: 'ready', until: 0, pulls: 0 }; G.phase = 'open'; });
    await page.evaluate(() => Bot.tickets(['凍檸茶少甜']));
    await run(page, .3, { bot: false });
    await page.locator('[data-tk]').first().click();   // the player picks the ticket
    await run(page, .1, { bot: false });
    const card = page.locator('#bench .cheat');
    await card.waitFor();
    assert.match(await card.innerText(), /貓紙[\s\S]*凍杯[\s\S]*茶[\s\S]*檸檬[\s\S]*冰[\s\S]*糖水/);
    assert.equal(await card.locator('.ok').count(), 0);
    await page.click('#barPad [data-b="cold"]');
    await run(page, .1, { bot: false });
    assert.equal(await card.locator('.ok').count(), 1, 'the cup is ticked off on the card');
    assert.deepEqual(realErrors(page), []);
    await page.context().close();
  });
}
