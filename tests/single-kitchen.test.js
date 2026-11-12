// Single player, kitchen (廚房): every recipe, the stoves (pot / pan / toaster / oven / wok), burning, the plate rules,
// mistakes and re-cooks, and whole shifts. The plate contents are re-derived in helpers/bots.browser.js (Oracle.tokens).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, sleep } from './helpers/server.js';
import { launch, realErrors, shot, WEBKIT } from './helpers/browser.js';
import { openSingle, startShift, run, runToEnd, state, hud, endCard, cell, assertClean, endless, settleTickets, ALL_RECIPES } from './helpers/single.js';

let srv, browser;
before(async () => { srv = await startServer(); browser = await launch(); });
after(async () => { await browser?.close(); await srv?.stop(); });

const events = (page, type) => page.evaluate(t => Bot.ev.filter(e => e.type === t), type);
const toast = page => page.evaluate(() => document.getElementById('toast').textContent);
const plate = page => page.evaluate(() => [...activePlate().tokens].sort());
const slotOf = (page, st, i = 0) => page.evaluate(([st, i]) => { const j = G.kit[st][i]; return j && { item: j.item, cls: slotState(st, j).cls, stirs: j.stirs, rice: j.rice }; }, [st, i]);
// a real mouse press on a stove drawn on the canvas
async function clickCell(page, st, i = 0) {
  const p = await page.evaluate(([st, i]) => { const h = kHits.find(h => h.st === st && h.i === i), r = ktv.getBoundingClientRect(); return h && { x: r.left + h.x + h.w / 2, y: r.top + h.y + h.h / 2 }; }, [st, i]);
  assert.ok(p, `stove ${st}[${i}] is on screen`);
  await page.mouse.click(p.x, p.y);
}
const pad = (page, k) => page.click(`#kitPad [data-k="${k}"]`);
async function kitchenShift(page, o = {}) {
  await startShift(page, { station: 'kitchen', ...o });
  await page.evaluate(() => Bot.quiet());
  await page.waitForFunction(() => kHits.some(h => h.st));
}

test('the player picks the ticket: no dish is picked by itself, before or after a plate, and the plate says so', async () => {
  const page = await openSingle(browser, srv.url);
  await kitchenShift(page, { slot: 'lunch' });
  await endless(page);
  await page.evaluate(() => { G.nextSpawn = Infinity; });
  const look = () => page.evaluate(() => ({ ksel: G.ksel, txt: document.querySelector('#kplate .target').textContent, on: document.querySelectorAll('.kchipt.on').length, chips: document.querySelectorAll('[data-mk]').length }));
  await run(page, .3, { bot: false });
  assert.deepEqual(await look(), { ksel: null, txt: '暫時冇飛', on: 0, chips: 0 }, 'no tickets at all');
  await page.evaluate(() => Bot.tickets(['f餐蛋麵', 'f西多士']));
  await run(page, .5, { bot: false });
  assert.deepEqual(await look(), { ksel: null, txt: '撳張飛揀做邊碟', on: 0, chips: 2 }, 'two tickets waiting, none picked');
  const serve = () => page.locator('#kitView [data-k="serve"]').click();
  await serve();
  assert.match(await toast(page), /撳上面張飛揀做邊碟/);
  const second = await page.evaluate(() => document.querySelectorAll('[data-mk]')[1].dataset.mk);
  await page.click(`[data-mk="${second}"]`);
  await run(page, .05, { bot: false });   // the next frame draws the pick
  let s = await look();
  assert.deepEqual([s.ksel && `${s.ksel.gid}:${s.ksel.i}`, s.on], [second, 1], 'the player picked the second one, not the most urgent');
  assert.match(s.txt, /^做緊 /);
  await page.evaluate(() => { activePlate().tokens = [...Oracle.tokens(selOk().meals[G.ksel.i].k)]; });   // the right plate (a wrong one comes back)
  await serve();
  await run(page, .5, { bot: false });
  s = await look();
  assert.deepEqual(s, { ksel: null, txt: '撳張飛揀做邊碟', on: 0, chips: 1 }, 'after the plate: one ticket left, still not picked for the player');
  assert.deepEqual(realErrors(page), []);
  await page.context().close();
});

test('every meal the menu can order: the plate the game wants = the plate the help text describes (all sets, dishes, lunch dishes, hat)', async () => {
  const page = await openSingle(browser, srv.url);
  await startShift(page, { station: 'kitchen' });
  const r = await page.evaluate(() => {
    const keys = [];
    for (const s of SETS) for (const noodle of NOODLES) for (const egg of EGGS) for (const bread of BREADS) for (const [hongdai, feibin] of [[0, 0], [0, 1], [1, 0], [1, 1]]) {
      const roll = bread === '餐包';
      if ((hongdai && !roll) || (!roll && false)) continue;
      if (feibin && roll && !hongdai) continue;
      keys.push(setKey({ id: s.id, noodle, egg, bread, hongdai: !!hongdai, feibin: !!feibin }));
    }
    for (const d of DISHES) for (const f of [0, 1]) for (const g of [0, 1]) for (const z of [0, 1]) {
      if (f && !d.sauce) continue;
      keys.push(dishKey({ id: d.id, 炒底: !!f, 加底: !!g, 走青: !!z }));
    }
    for (const f of FOODS) { keys.push('f' + f.id); if (HAT_OK.includes(f.id)) keys.push('f' + f.id + HAT_TXT); }
    const bad = [];
    for (const k of keys) {
      let want; try { want = Oracle.tokens(k); } catch (e) { bad.push([k, 'oracle: ' + e.message]); continue; }
      const got = kitRecipe(k);
      if (Oracle.bag(want) !== Oracle.bag(got)) bad.push([k, want, got]);
    }
    return { n: keys.length, bad: bad.slice(0, 6) };
  });
  assert.ok(r.n > 300, 'meals checked: ' + r.n);
  assert.deepEqual(r.bad, []);
  await page.context().close();
});

test('lunch plate with the real mouse: noodles to the pot (auto-held), egg to the pan (take when ready, too early refuses), meat from the bin, serve', async () => {
  const page = await openSingle(browser, srv.url);
  await kitchenShift(page);
  await page.evaluate(() => Bot.tickets(['f餐蛋麵', '熱奶茶']));
  await page.waitForFunction(() => document.querySelectorAll('#krail .tk-l').length > 0);
  assert.equal(await page.locator('#kplate .target').innerText(), '撳張飛揀做邊碟', 'nothing picked yet');
  await page.locator('#krail .tk-l').first().click();
  await run(page, .05, { bot: false });   // the next frame draws the pick
  assert.match(await page.locator('#kplate .target').innerText(), /餐蛋麵/);
  await page.locator('#kitView [data-k="serve"]').click();
  assert.match(await toast(page), /空/);   // empty plate
  await pad(page, 's:pot:公仔麵');
  assert.equal((await slotOf(page, 'pot')).cls, 'cook');
  await pad(page, 's:pan:煎蛋');
  await clickCell(page, 'pan', 0);   // too early
  assert.match(await toast(page), /未熟/);
  assert.equal((await slotOf(page, 'pan')).cls, 'cook', 'still cooking');
  await pad(page, 'i:餐肉');
  assert.deepEqual(await plate(page), ['餐肉']);
  await run(page, 3.2, { bot: false });
  // noodles finish after 3 s, are lifted out by themselves and lie in the strainer, then jump onto the plate because the ticket needs them
  assert.equal(await slotOf(page, 'pot'), null);
  assert.deepEqual(await plate(page), ['公仔麵', '餐肉']);
  await run(page, 1.2, { bot: false });
  assert.match((await slotOf(page, 'pan')).cls, /ready/);
  await clickCell(page, 'pan', 0);
  assert.deepEqual(await plate(page), ['公仔麵', '煎蛋', '餐肉']);
  assert.equal(await slotOf(page, 'pan'), null);
  const d0 = (await state(page)).dishes;
  await page.locator('#kitView [data-k="serve"]').click();
  assert.deepEqual(await plate(page), []);
  const st = await state(page);
  assert.equal(st.dishes, d0 + 1); assert.equal(st.mistakes, 0); assert.equal(st.combo, 1);
  const sv = await events(page, 'good'); assert.equal(sv.length, 1);
  await shot(page, 'single-kitchen-plate');
  assert.deepEqual(realErrors(page), []);
  await page.context().close();
});

test('burning: pan food left past its time burns (pro: 4 s x 1.4), taking it bins it and counts; noodles in the pot never burn', async () => {
  const page = await openSingle(browser, srv.url);
  await kitchenShift(page);
  await page.evaluate(() => Bot.tickets(['f餐蛋麵', '熱奶茶']));
  await pad(page, 's:pan:煎蛋'); await pad(page, 's:pot:通粉');
  await page.evaluate(() => { G.hold.length = 0; });
  // the game clock ran in real time while the pad was tapped (longer on a slower engine): time from the egg's own start
  const egg = await page.evaluate(() => { const j = G.kit.pan[0]; return { span: j.burnAt - j.start, left: j.burnAt - G.t }; });
  assert.ok(Math.abs(egg.span - (4 + 4 * 1.4)) < 1e-6, 'burns 4 s x 1.4 after it is ready: ' + egg.span);
  await run(page, egg.left - .3, { bot: false });
  assert.match((await slotOf(page, 'pan')).cls, /ready/);
  await run(page, .6, { bot: false });
  assert.equal((await slotOf(page, 'pan')).cls, 'burnt');
  const plate0 = await plate(page);
  await clickCell(page, 'pan', 0);
  assert.match(await toast(page), /燶咗/);
  assert.equal(await slotOf(page, 'pan'), null);
  assert.equal(await page.evaluate(() => G.burnt), 1);
  assert.deepEqual(await plate(page), plate0, 'a burnt egg never reaches the plate');
  // the pot lifts the noodles out when they are done (7 s for 通粉) and holds them, however long they wait
  await run(page, 60, { bot: false });
  assert.equal(await slotOf(page, 'pot'), null);
  assert.ok(await page.evaluate(() => G.hold.length + activePlate().tokens.filter(t => t === '通粉').length) >= 1);
  assert.deepEqual(realErrors(page), []);
  await page.context().close();
});

test('wok: five stirs before it is done, rice to the wok (max 2), dish and fried-rice plates; tapping the wok too early stirs', async () => {
  const page = await openSingle(browser, srv.url, { shop: { stars: 60 } });
  await kitchenShift(page, { slot: 'dinner' });
  await page.evaluate(() => Bot.tickets(['d番茄牛肉飯炒底', '熱奶茶']));   // wok dish fried with the rice: one token 'dish·飯×1'
  await pad(page, 's:wok:番茄牛肉飯');
  assert.deepEqual(await slotOf(page, 'wok'), { item: '番茄牛肉飯', cls: 'cook', stirs: 0, rice: 0 });
  await pad(page, 'rice2wok'); await pad(page, 'rice2wok'); await pad(page, 'rice2wok');
  assert.equal((await slotOf(page, 'wok')).rice, 2, 'at most two portions of rice');
  await clickCell(page, 'wok', 0);   // tapping the pan while not done = one stir
  await pad(page, 'stir'); await pad(page, 'stir'); await pad(page, 'stir');
  assert.equal((await slotOf(page, 'wok')).stirs, 4);
  await page.evaluate(() => kitKey('t:wok:0'));   // taking it before 5 stirs is refused
  assert.match(await toast(page), /未炒好，再炒 1 下/);
  assert.deepEqual(await plate(page), []);
  await pad(page, 'stir');
  assert.equal((await slotOf(page, 'wok')).cls, 'ready');
  await clickCell(page, 'wok', 0);
  assert.deepEqual(await plate(page), ['番茄牛肉飯·飯×2']);
  assert.equal(await slotOf(page, 'wok'), null);
  await page.evaluate(() => { activePlate().tokens = []; });
  await assertClean(assert, page, 'wok');
  await page.context().close();
});

test('wrong plates (extra thing / something missing / wrong dish): +1 mistake when the waiter takes it back, re-cook is right', async () => {
  const page = await openSingle(browser, srv.url);
  await kitchenShift(page, { slot: 'lunch' });
  await endless(page);
  const meals = ['f餐蛋麵', 'f火腿通粉', 'f西多士', 'f菠蘿油'];
  for (const how of ['extra', 'short']) {
    const idx = await page.evaluate(() => Bot.ev.length), m0 = (await state(page)).mistakes;
    for (const k of meals) {
      await page.evaluate(([k, how]) => { Bot.sab = { pending: how, done: [], added: false }; Bot.tickets([k]); }, [k, how]);
      await settleTickets(page);
      assert.equal(await page.evaluate(() => G.groups.filter(g => g.state === 'wait').length), 0, `${how} ${k} finished`);
    }
    const sv = await page.evaluate(i => Bot.ev.slice(i).filter(e => e.type === 'serve'), idx);
    const wrong = sv.filter(e => e.bad), right = sv.filter(e => !e.bad);
    assert.equal(wrong.length, meals.length, `${how}: all sabotaged plates were wrong`);
    assert.equal((await state(page)).mistakes - m0, meals.length, `${how}: one mistake per wrong plate`);
    for (const e of wrong) { assert.equal(e.d.mis, 1); assert.equal(e.state, 'wait'); }
    for (const e of right) { assert.equal(e.returnsBefore, 1); assert.equal(e.state, 'eat'); assert.equal(e.d.mis, 0); }
  }
  await assertClean(assert, page, 'wrong plates');
  await page.context().close();
});

test('rank decides plates: apprentice has one plate, 熟手 (10 stars) gets a second one, picked with a tap on the plate', async () => {
  const page = await openSingle(browser, srv.url, { shop: { stars: 4 } });
  await kitchenShift(page, { diff: 'rookie' });
  assert.equal(await page.evaluate(() => G.plates.length), 1);
  await page.context().close();
  const p2 = await openSingle(browser, srv.url, { shop: { stars: 12 } });
  await kitchenShift(p2);
  assert.equal(await p2.evaluate(() => G.plates.length), 2);
  await p2.evaluate(() => Bot.tickets(['f餐蛋麵', '熱奶茶']));
  await pad(p2, 'i:餐肉');
  assert.deepEqual(await p2.evaluate(() => G.plates.map(p => p.tokens)), [['餐肉'], []]);
  const hit = await p2.evaluate(() => { const h = kHits.find(h => h.plate === 1), r = ktv.getBoundingClientRect(); return h && { x: r.left + h.x + h.w / 2, y: r.top + h.y + h.h / 2 }; });
  assert.ok(hit, 'second plate can be tapped');
  await p2.mouse.click(hit.x, hit.y);
  assert.equal(await p2.evaluate(() => G.pi), 1);
  await pad(p2, 'i:餐肉'); await pad(p2, 'i:火腿');
  assert.deepEqual(await p2.evaluate(() => G.plates.map(p => p.tokens)), [['餐肉'], ['餐肉', '火腿']]);
  await p2.locator('#kplate [data-k="dump"]').click();   // dumps only the plate in use
  assert.deepEqual(await p2.evaluate(() => G.plates.map(p => p.tokens)), [['餐肉'], []]);
  assert.deepEqual(realErrors(p2), []);
  await p2.context().close();
});

for (const slot of ['breakfast', 'lunch', 'dinner']) {
  test(`kitchen shift (${slot}), whole 3 minutes by the bot: every plate right, dishes = lines ordered, bills balance`, async () => {
    const page = await openSingle(browser, srv.url, { shop: { stars: 60, recipes: ALL_RECIPES } });
    await startShift(page, { station: 'kitchen', slot, diff: 'pro' });
    await runToEnd(page);
    const st = await state(page), card = await endCard(page);
    assert.equal(st.mistakes, 0); assert.equal(st.angry, 0);
    assert.equal(cell(card, '營業額'), '$' + st.revenue);
    assert.equal(cell(card, '出咗'), st.dishes + ' 碟');
    assert.equal(cell(card, '整錯'), '0');
    const lines = await page.evaluate(() => Bot.ev.filter(e => e.type === 'submit').reduce((a, e) => a + e.slip.filter(k => 'fsd'.includes(k[0])).length, 0));
    const undone = await page.evaluate(() => G.groups.reduce((a, g) => a + (g.meals || []).filter(m => !m.done).length, 0));
    assert.equal(st.dishes + undone, lines, 'every meal line ordered was cooked, or is still waiting when the shift ended');
    assert.equal((await page.evaluate(() => Bot.ledger())).missing, 0);
    assert.ok(st.dishes >= 15, 'dishes ' + st.dishes);
    await assertClean(assert, page, slot);
    await page.context().close();
  });
}

test('kitchen in real time (5x) through the UI: end card agrees with the HUD', async () => {
  const page = await openSingle(browser, srv.url);
  await startShift(page, { station: 'kitchen', slot: 'lunch', diff: 'pro' });
  await page.evaluate(() => { Bot.scale = 5; Bot.start({ every: 50 }); });
  { const a = await page.evaluate(() => G.rt); await page.waitForTimeout(1500); assert.ok(await page.evaluate(a => G.rt > a + 1.5, a), 'the game clock advances in real time (5x)'); }
  await page.waitForFunction(() => !document.getElementById('endView').hidden, null, { timeout: 150000, polling: 500 });
  await page.evaluate(() => Bot.stop());
  const st = await state(page), card = await endCard(page), h = await hud(page);
  assert.equal(cell(card, '營業額'), '$' + st.revenue); assert.equal(h.rev, '$' + st.revenue);
  assert.equal(cell(card, '出咗'), st.dishes + ' 碟');
  assert.equal(await page.evaluate(() => document.getElementById('misLbl').textContent), '整錯');
  assert.match(card.kick, /二點正 · 午市完 · 廚房 · 熟手/);
  assert.equal(st.mistakes, 0);
  assert.ok(st.dishes >= 12, 'dishes ' + st.dishes);
  await assertClean(assert, page, 'realtime kitchen');
  await page.context().close();
});

for (const slot of ['lunch', 'dinner']) {
  test(`kitchen in the phone layout (枱面版, ${slot}): bins, strainer, stoves and wok are tapped on the drawn counter - a whole shift, every plate right`, async () => {
    const page = await openSingle(browser, srv.url, { storage: { 'ckf-kmode': 'counter' }, shop: { stars: 60, recipes: ALL_RECIPES } });
    await startShift(page, { station: 'kitchen', slot, diff: 'pro' });
    assert.equal(await page.evaluate(() => kitMode), 'counter');
    assert.equal(await page.locator('#kitPad').isVisible(), false, 'no button pad in this layout: the stoves are on the counter');
    await runToEnd(page);
    const st = await state(page), card = await endCard(page);
    assert.equal(st.mistakes, 0); assert.equal(st.angry, 0);
    assert.equal(cell(card, '出咗'), st.dishes + ' 碟');
    assert.ok(st.dishes >= 12, 'dishes ' + st.dishes);
    assert.equal((await page.evaluate(() => Bot.ledger())).missing, 0);
    await shot(page, 'single-kitchen-counter-' + slot);
    await assertClean(assert, page, 'kitchen counter mode');
    await page.context().close();
  });
}

test('phone-layout kitchen: a stove pop-up still open when the shift ends is not carried into the next shift (keyboard user: Enter on the next button)', async () => {
  const page = await openSingle(browser, srv.url, { storage: { 'ckf-kmode': 'counter' }, shop: { stars: 60, recipes: ALL_RECIPES } });
  await startShift(page, { station: 'kitchen', slot: 'lunch', diff: 'pro' });
  await page.evaluate(() => Bot.quiet());
  await run(page, 3, { bot: false });
  const p = await page.evaluate(() => { const h = kHits.find(h => h.st === 'pan' && h.i === 0), r = ktv.getBoundingClientRect(); return { x: r.left + h.x + h.w / 2, y: r.top + h.y + h.h / 2 }; });
  await page.mouse.click(p.x, p.y);
  assert.equal(await page.evaluate(() => !document.getElementById('kpop').hidden), true, 'tapping an empty stove opens the pop-up');
  await runToEnd(page, { bot: false });
  await page.keyboard.press('Enter');   // the focused button on the end card is 做埋晚市
  await page.waitForFunction(() => !document.getElementById('introView').hidden);
  await page.keyboard.press('Enter');   // then 開工！, focused on the goal card
  await page.waitForFunction(() => G.running && G.slot === 'dinner');
  assert.equal(await page.evaluate(() => document.getElementById('kpop').hidden), true, 'no stale pop-up in the new shift');
  assert.deepEqual(realErrors(page), []);
  await page.context().close();
});

// The pop-up opens on finger down, under the finger; the click at finger up must not pick whatever it lands on,
// however long the press was (the old guard ignored clicks only for the first 350 ms).
test('phone-layout kitchen: a long press (600 ms) on an empty stove opens its pop-up and cooks nothing by itself', async () => {
  const page = await openSingle(browser, srv.url, { storage: { 'ckf-kmode': 'counter' }, shop: { stars: 60, recipes: ALL_RECIPES } });
  await startShift(page, { station: 'kitchen', slot: 'lunch', diff: 'pro' });
  await page.evaluate(() => Bot.quiet());
  await run(page, 3, { bot: false });
  const p = await page.evaluate(() => { const h = kHits.find(h => h.st === 'pan' && h.i === 0), r = ktv.getBoundingClientRect(); return { x: r.left + h.x + h.w / 2, y: r.top + h.y + h.h / 2 }; });
  assert.ok(!(await slotOf(page, 'pan')), 'the pan is empty');
  const popOpen = () => page.waitForFunction(() => !document.getElementById('kpop').hidden);
  if (!WEBKIT) {
    // Real touch input through the DevTools protocol: finger down, hold, finger up (the browser makes the click).
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y }] });
    await popOpen();
    await sleep(600);   // the press itself lasts 600 ms: that is the scenario, not a wait for the game
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    // WebKit has no touch injection here: replay what a touch does - pointerdown on the canvas, then (600 ms later)
    // pointerup and click on whatever is under the finger by then.
    await page.evaluate(([x, y]) => document.elementFromPoint(x, y).dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerType: 'touch', isPrimary: true })), [p.x, p.y]);
    await popOpen();
    await sleep(600);
    await page.evaluate(([x, y]) => { const el = document.elementFromPoint(x, y); el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: x, clientY: y, pointerType: 'touch', isPrimary: true })); el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y, detail: 1 })); }, [p.x, p.y]);
  }
  // Two frames so a wrongly accepted click would have shown up on the stove.
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  assert.ok(!(await slotOf(page, 'pan')), 'nothing was cooked without being chosen');
  assert.equal(await page.evaluate(() => !document.getElementById('kpop').hidden), true, 'the pop-up stays open for a choice');
  // A tap that starts on the pop-up still picks the item.
  await page.click('#kpop [data-pop]');
  await page.waitForFunction(() => G.kit.pan[0], null, { timeout: 3000 });
  assert.deepEqual(realErrors(page), []);
  await page.context().close();
});

test('secret recipes learned in the shop (蛋撻, 豬扒包, 燉奶 ...): the lunch kitchen gets their stoves and bins, and every one of them can be cooked', async () => {
  const special = ['f:城寨叉燒飯', 'f:豬扒包', 'f:蔥油雞扒撈丁', 'f:炒蛋多士', 'f:燉奶', 'f:蛋撻', 'f:火腿三文治', 'f:牛油多士', 'f:油占多', 'f:奶油多', 'f:吸血鬼多士'];
  const page = await openSingle(browser, srv.url, { shop: { stars: 60, recipes: [...ALL_RECIPES, ...special] } });
  await startShift(page, { station: 'kitchen', slot: 'lunch', diff: 'pro' });
  const stuck = await page.evaluate(() => {
    const lay = kitLayout(), out = [];
    const can = t => lay.inst.includes(t) || Object.values(lay.st).some(l => l.includes(t)) || (t.includes('·飯×') && (lay.st.wok || []).includes(t.split('·')[0])) || (t.endsWith('烘底') && (lay.st.toaster || []).includes(t.slice(0, -2)));
    for (const f of FOODS.filter(x => menuOpen('f:' + x.id))) for (const k of ['f' + f.id, ...(HAT_OK.includes(f.id) ? ['f' + f.id + HAT_TXT] : [])]) { const miss = Oracle.tokens(k).filter(t => !can(t)); if (miss.length) out.push([k, miss]); }
    return { out, n: FOODS.filter(x => menuOpen('f:' + x.id)).length };
  });
  assert.ok(stuck.n >= 15, 'the menu has the secret dishes: ' + stuck.n);
  assert.deepEqual(stuck.out, [], 'dishes on the shop menu that the shop kitchen cannot make');
  await runToEnd(page);
  const st = await state(page);
  assert.equal(st.mistakes, 0); assert.equal(st.angry, 0);
  assert.ok(st.dishes >= 12, 'dishes ' + st.dishes);
  await assertClean(assert, page, 'secret recipes');
  await page.context().close();
});

for (const diff of ['pro', 'ace']) {
  test(`on ${diff} the kitchen shows the 貓紙 card for the plate being made`, async () => {
    const page = await openSingle(browser, srv.url, { shop: { stars: 60 } });   // 阿姐 opens at 25 stars
    await kitchenShift(page, { diff });
    await page.evaluate(() => Bot.tickets(['f餐蛋麵']));
    await page.waitForFunction(() => document.querySelectorAll('#krail .tk-l').length > 0);
    await page.locator('#krail .tk-l').first().click();   // the player picks the ticket
    await run(page, .1, { bot: false });
    const card = page.locator('#kplate .cheat');
    await card.waitFor();
    assert.match(await card.innerText(), /貓紙/);
    assert.ok(await card.locator('.ck').count() >= 3, 'the card lists the parts of 餐蛋麵: ' + await card.innerText());
    assert.deepEqual(realErrors(page), []);
    await page.context().close();
  });
}
