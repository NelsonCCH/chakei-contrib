// Real finger presses at human speed (down, hold 40-140 ms, up) on the phone layout, while the shop changes under them:
// every press on a pad or rail button must count exactly once, solo, on the host's own phone and on a co-op teammate's
// phone (laggy network). Also screen-vs-state after-effects at the bar: a ticket leaves the rail once its drinks are made.
// Why this file exists: tests used to press through game functions or a click with no duration, so a
// press that straddled a re-render (the button swapped under the finger) was never made; the 收銀 keypad lost digits.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { startServer, sleep, ROOT } from './helpers/server.js';
import { launch, openGame, veteran, realErrors, WEBKIT } from './helpers/browser.js';
import { startShift } from './helpers/single.js';

const BOTS = readFileSync(join(ROOT, 'tests', 'helpers', 'bots.browser.js'), 'utf8');
let srv, browser;
const pages = [];
before(async () => { srv = await startServer(); browser = await launch(); });
after(async () => { await browser?.close(); await srv?.stop(); });

async function player(nick, opts = {}) {
  const p = await openGame(browser, srv.url, { storage: { ...veteran(nick), 'ckf-view': 'simple' }, ...opts });
  await p.addScriptTag({ content: BOTS });
  pages.push(p);
  return p;
}
async function closeAll() { for (const p of pages.splice(0)) { try { await p.context().close(); } catch {} } }

/* ---------- co-op room (same steps as coop.test.js) ---------- */
async function hostRoomAs(p, st) {
  await p.evaluate(s => { station = s; saveSet('ckf-station', s); buildMenus(); }, st);
  await p.click('#coopBtn');
  await p.click('#hostBtn');
  await p.waitForFunction(() => NET.t && NET.t.up && NET.code);
  return p.evaluate(() => NET.code);
}
async function joinAs(p, code, st, host) {
  if (await p.isHidden('#coopView')) await p.click('#coopBtn');
  await p.fill('#roomIn', code);
  await p.click('#joinBtn');
  await p.waitForFunction(() => NET.meta);
  await p.click(`#coop [data-seat="${st}"]`);
  await host.waitForFunction(s => Object.values(NET.seats).some(x => x.station === s), st);
}
/** Host plays `hostSt`, one teammate (80±40 ms lag) plays `mateSt`; the shift is running on both. */
async function room(hostSt, mateSt, ms = 80, jitter = 40) {
  const host = await player('老闆'), mate = await player('阿珍', { latency: { ms, jitter } });
  const code = await hostRoomAs(host, hostSt);
  await joinAs(mate, code, mateSt, host);
  await host.click('#hostGo');
  await host.waitForFunction(() => G.coop && G.running);
  await mate.waitForFunction(() => G && G.coop && G.running && G.roles[NET.myStation] === 'me', null, { timeout: 10000 });
  return { host, mate };
}
/** Boils, steeps and pulls the tea pot on the bar's phone (host or teammate: the pot is the bar's own) until the shop opens. */
async function openBar(bar, host) {
  await bar.evaluate(() => barKey('pot'));
  await bar.waitForFunction(() => G.pot.st === 'pull', null, { timeout: 15000 });
  for (let i = 0; i < 8 && await bar.evaluate(() => G.pot.st !== 'ready'); i++) { await bar.evaluate(() => barKey('pot')); await sleep(150); }
  await host.waitForFunction(() => G.phase === 'open', null, { timeout: 5000 });
}

/* ---------- presses ---------- */
/**
 * A finger on the phone: press the middle of `sel` for `hold` ms, then lift. Chromium: real touch through DevTools (the
 * browser makes the click). WebKit has no touch injection: a real mouse press and release through the engine, which
 * picks the click target itself (like iOS Safari, it makes no click when the pressed element left the page meanwhile).
 */
async function fingerTap(page, sel, hold) {
  const p = await page.evaluate(s => { const el = document.querySelector(s); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, sel);
  assert.ok(p, 'nothing to press at ' + sel);
  if (!WEBKIT) {
    const cdp = page.__cdp || (page.__cdp = await page.context().newCDPSession(page));
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y }] });
    await sleep(hold);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else { await page.mouse.move(p.x, p.y); await page.mouse.down(); await sleep(hold); await page.mouse.up(); }
}
/** Human pace: 40-140 ms presses, 40-200 ms apart (so the same key is often pressed twice quickly). */
async function presses(page, sels) {
  for (const s of sels) { await fingerTap(page, s, 40 + Math.random() * 100); await sleep(40 + Math.random() * 160); }
}
/**
 * Counts what the presses did: `n` presses, `swapped` = presses whose button was replaced before the finger lifted
 * (iOS Safari drops those taps), `calls` = calls of the station function `fn` the screen makes for a press.
 */
const track = (page, fn) => page.evaluate(fn => {
  let down = null; window.__press = { n: 0, swapped: 0, calls: 0 };
  document.addEventListener('pointerdown', e => { down = e.target.closest('button'); __press.n++; }, true);
  document.addEventListener('pointerup', () => { if (down && !down.isConnected) __press.swapped++; down = null; }, true);
  const f = window[fn]; window[fn] = (...a) => { __press.calls++; return f(...a); };
}, fn);
/** A busy shift: the shop changes ten times a second (customers, the other stations), as it does in a rush. */
const busy = page => page.evaluate(() => { window.__busy = setInterval(() => { if (G && G.running) bump(); }, 100); });
/**
 * A station's presses change its own state on its own phone, and only what the station did
 * (a result) goes to the referee. `settleNet`: the referee has every result this phone sent (unacked() empty), and a
 * keyframe or two has come back.
 */
const settleNet = async mate => { await mate.waitForFunction(() => unacked() === 0, null, { timeout: 10000 }); await sleep(600); };
const noSwap = p => assert.equal(p.swapped, 0, `${p.swapped} of ${p.n} pressed buttons were replaced before the finger lifted`);

const DIGITS = '773331995528446617';
const keys = s => [...s].map(d => `#pad [data-k="${d}"]`);
async function soloShift(station) {
  const page = await player('測試員');
  await startShift(page, { station, slot: 'lunch', diff: 'pro' });
  return page;
}

/* ---------- 收銀 keypad ---------- */
test('till keypad, solo, busy shift: every digit pressed shows once', { timeout: 90000 }, async () => {
  const page = await soloShift('till');
  await page.evaluate(() => { Bot.quiet(); Bot.payer(['f餐蛋麵', '熱奶茶'], ['f餐蛋麵', '熱奶茶']); });
  await page.waitForFunction(() => G.cur && G.step === 'total', null, { timeout: 15000 });
  await busy(page); await track(page, 'tillKey');
  await presses(page, keys(DIGITS));
  const p = await page.evaluate(() => __press);
  assert.equal(await page.evaluate(() => G.entry), DIGITS);
  assert.equal(await page.evaluate(() => document.querySelector('#pad .disp b').textContent), '$' + Number(DIGITS), 'the display shows the number typed');
  assert.equal(p.calls, DIGITS.length); noSwap(p);
  assert.deepEqual(realErrors(page), []);
  await closeAll();
});

test('till keypad, teammate phone (150±50 ms lag): every digit and slip-line press counts once, on both phones', { timeout: 120000 }, async () => {
  const { host, mate } = await room('waiter', 'till', 150, 50);
  await mate.waitForFunction(() => G.cur && G.step === 'total', null, { timeout: 30000 });
  await track(mate, 'tillKey');
  await presses(mate, keys(DIGITS));
  await fingerTap(mate, '#cust [data-strike="0"]', 90);   // a slip line tapped to strike it: same re-rendered screen
  await settleNet(mate);
  const p = await mate.evaluate(() => __press);
  // the keypad and the customer at the counter are the till's own: they count on the phone that plays it
  assert.equal(await mate.evaluate(() => G.entry), DIGITS, 'the teammate\'s screen shows every digit pressed, once');
  assert.equal(await mate.evaluate(() => G.cur.payLines[0].struck), true, 'the slip line tapped is struck');
  // ... and survives the keyframes that arrived meanwhile; the customer taken to the counter reached the referee
  assert.equal(await host.evaluate(cid => !G.payQ.some(c => c.id === cid), await mate.evaluate(() => G.cur.id)), true, 'the referee took the customer out of the pay queue (tillTake)');
  assert.equal(p.calls, DIGITS.length); noSwap(p);
  assert.deepEqual(realErrors(host), []); assert.deepEqual(realErrors(mate), []);
  await closeAll();
});

test('till keypad, host\'s own phone while a teammate works: every digit pressed counts once', { timeout: 120000 }, async () => {
  const { host, mate } = await room('till', 'kitchen');
  await host.waitForFunction(() => G.cur && G.step === 'total', null, { timeout: 30000 });
  // The kitchen teammate taps away (5 taps a second): each of its taps changes the shop on the host phone.
  await mate.evaluate(() => { window.__work = setInterval(() => kitKey('dump'), 200); });
  await track(host, 'tillKey');
  await presses(host, keys(DIGITS));
  await mate.evaluate(() => clearInterval(__work));
  const p = await host.evaluate(() => __press);
  assert.equal(await host.evaluate(() => G.entry), DIGITS, 'every digit pressed on the host\'s till counts');
  assert.equal(p.calls, DIGITS.length); noSwap(p);
  assert.deepEqual(realErrors(host), []); assert.deepEqual(realErrors(mate), []);
  await closeAll();
});

/* ---------- 水吧 pad, 廚房 plate buttons, 落單紙: solo (busy) and teammate (80±40 ms) ---------- */
const N = 14;
const BAR_KEYS = Array(N).fill('#barPad [data-b="dump"]');
const KIT_KEYS = Array(N).fill('#kplate [data-k="dump"]');
const SHEET_KEYS = Array(N).fill('#sheet [data-add="k"][data-id="奶茶"]');

test('bar pad and kitchen plate buttons, solo, busy shift: every press counts once', { timeout: 120000 }, async () => {
  for (const [st, fn, sels] of [['bar', 'barKey', BAR_KEYS], ['kitchen', 'kitKey', KIT_KEYS]]) {
    const page = await soloShift(st);
    if (st === 'bar') await page.evaluate(() => { G.phase = 'open'; G.pot = { level: potCap(), st: 'ready', until: 0, pulls: 0 }; });
    await busy(page); await track(page, fn);
    await presses(page, sels);
    const p = await page.evaluate(() => __press);
    assert.equal(p.calls, N, `${st}: ${p.calls} of ${N} presses reached the station`); noSwap(p);
    assert.deepEqual(realErrors(page), []);
    await closeAll();
  }
});

test('bar pad and kitchen plate buttons, teammate phone (80±40 ms lag): every press counts once, on both phones', { timeout: 150000 }, async () => {
  for (const [st, fn, sels] of [['bar', 'barKey', BAR_KEYS], ['kitchen', 'kitKey', KIT_KEYS]]) {
    const { host, mate } = await room('waiter', st);
    if (st === 'bar') await openBar(mate, host);
    await track(mate, fn);
    await presses(mate, sels);
    await settleNet(mate);
    const p = await mate.evaluate(() => __press);
    // every press reached the station on this phone once; a dump is the station's own, so no result travels
    assert.equal(p.calls, N, `${st}: ${p.calls} of ${N} presses reached the station`); noSwap(p);
    assert.deepEqual(realErrors(host), []); assert.deepEqual(realErrors(mate), []);
    await closeAll();
  }
});

/** Seats one injected customer (on the host) and waits until they want to order. Returns the table index. */
const seatForOrder = page => page.evaluate(() => {
  Bot.quiet();
  const id = Bot.inject(1), g = byId(id);
  G.tables.forEach(t => { if (!G.groups.some(x => x.table === t.id)) t.dirty = 0; });
  const tb = G.tables.find(t => !seatProblem(g, t)); seat(g, tb); return { id, tb: tb.id };
});

test('order sheet, solo and teammate phone (80±40 ms lag): every item pressed is written once', { timeout: 120000 }, async () => {
  const solo = await soloShift('waiter');
  const s = await seatForOrder(solo);
  await solo.waitForFunction(id => byId(id) && byId(id).state === 'order', s.id, { timeout: 15000 });
  await solo.evaluate(tb => tapTable(tb), s.tb);
  await busy(solo); await track(solo, 'sheetAct');
  await presses(solo, SHEET_KEYS);
  let p = await solo.evaluate(() => __press);
  assert.equal(await solo.evaluate(id => byId(id).draft.length, s.id), N, 'solo: one line per press'); noSwap(p);
  // The sheet keeps its nodes between renders, but the 火速奶公司 fade bar (a CSS animation that starts when its node
  // is made) must still show the time since the customer spoke, render after render.
  const fade = await solo.evaluate(async () => {
    G.level = 'fastmilk'; G.sheet.at = performance.now() - 1000; renderSheet();
    await new Promise(r => setTimeout(r, 400)); renderSheet();
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const t = document.querySelector('#sheet .fadebar').getAnimations()[0].effect.getComputedTiming();
    return { shown: t.localTime - t.delay, real: performance.now() - G.sheet.at };
  });
  assert.ok(Math.abs(fade.shown - fade.real) < 200, `fade bar at ${Math.round(fade.shown)} ms, customer spoke ${Math.round(fade.real)} ms ago`);
  assert.deepEqual(realErrors(solo), []);
  await closeAll();

  const { host, mate } = await room('till', 'waiter');
  const r = await seatForOrder(host);
  await mate.waitForFunction(id => byId(id) && byId(id).state === 'order', r.id, { timeout: 15000 });
  await mate.evaluate(tb => tapTable(tb), r.tb);
  await mate.waitForFunction(() => !document.getElementById('sheetWrap').hidden);
  await track(mate, 'sheetAct');
  await presses(mate, SHEET_KEYS);
  await settleNet(mate);
  p = await mate.evaluate(() => __press);
  assert.equal(await mate.evaluate(id => byId(id).draft.length, r.id), N, 'teammate: one line per press'); noSwap(p);
  // the slip is the waiter's own: the referee has the slipOpen (the table is taken), not the lines
  assert.equal(await host.evaluate(id => byId(id).taken === true, r.id), true, 'the referee knows the slip is open');
  assert.deepEqual(realErrors(host), []); assert.deepEqual(realErrors(mate), []);
  await closeAll();
});

/* ---------- 水吧 rail: a ticket leaves once its drinks are made, though the kitchen is still cooking ---------- */
for (const [label, hostSt, mateSt] of [['host\'s own phone', 'bar', 'kitchen'], ['teammate phone', 'kitchen', 'bar']]) {
  test(`bar rail (${label}): a ticket leaves when its last drink is made while the kitchen is still cooking`, { timeout: 120000 }, async () => {
    const { host, mate } = await room(hostSt, mateSt);
    const bar = hostSt === 'bar' ? host : mate;
    await openBar(bar, host);
    // One table orders a meal and a drink; the kitchen (a person, doing nothing here) has not cooked the meal.
    const gid = await host.evaluate(() => {
      Bot.quiet(); G.groups.filter(g => g.state === 'wait').forEach(g => leave(g, false));
      const id = Bot.inject(1), g = byId(id);
      G.tables.forEach(t => { if (!G.groups.some(x => x.table === t.id)) t.dirty = 0; });
      seat(g, G.tables.find(t => !seatProblem(g, t))); g.items = ['f餐蛋麵', '熱奶茶']; submitOrder(g, ['f餐蛋麵', '熱奶茶'], false); return id;
    });
    const onRail = () => bar.evaluate(id => !!document.querySelector(`#rail [data-key="${id}"]`), gid);
    await bar.waitForFunction(id => document.querySelector(`#rail [data-key="${id}"]`), gid, { timeout: 5000 });
    // Make the drink on the bar's phone, through the bar's own key handler.
    await bar.evaluate(id => { pickLine(id, 0); for (const k of ['hot', '淡奶', '茶', 'serve']) barKey(k); }, gid);
    await host.waitForFunction(id => byId(id) && byId(id).drinks[0].done, gid, { timeout: 5000 });
    assert.equal(await host.evaluate(id => byId(id).state === 'wait' && !byId(id).meals[0].done, gid), true, 'the table still waits for its food');
    // Two snapshots and a few frames later the ticket must be gone from the bar's screen.
    await sleep(800);
    assert.equal(await onRail(), false, 'the drink is made: its ticket is still on the bar rail');
    assert.equal(await bar.evaluate(() => document.querySelectorAll('#rail .ticket').length), 0, 'no ticket left on the rail');
    assert.deepEqual(realErrors(host), []); assert.deepEqual(realErrors(mate), []);
    await closeAll();
  });
}

/* ---------- 樓面 table buttons (simple view), 廚房 stove pop-up, 收銀 price board ---------- */
/**
 * Like track(), but a press counts as swapped when the element under the finger itself left the page before the finger
 * lifted, not only its button: a table button stays, but in an older build its contents were rebuilt on every render.
 */
const trackNode = (page, fn) => page.evaluate(fn => {
  let down = null; window.__press = { n: 0, swapped: 0, calls: 0 };
  document.addEventListener('pointerdown', e => { down = e.target; __press.n++; }, true);
  document.addEventListener('pointerup', () => { if (down && !down.isConnected) __press.swapped++; down = null; }, true);
  const f = window[fn]; window[fn] = (...a) => { __press.calls++; return f(...a); };
}, fn);
/** A finger at page point `p` (as fingerTap, for a spot on a canvas). */
async function fingerAt(page, p, hold) {
  if (!WEBKIT) {
    const cdp = page.__cdp || (page.__cdp = await page.context().newCDPSession(page));
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y }] });
    await sleep(hold);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else { await page.mouse.move(p.x, p.y); await page.mouse.down(); await sleep(hold); await page.mouse.up(); }
}
/** No customers come in; an empty table is made clean and nobody is selected, so a tap on it only shows a hint. */
const emptyTable = page => page.evaluate(() => {
  Bot.quiet(); G.selected = null;
  const tb = G.tables.find(t => !G.groups.some(g => g.table === t.id)); tb.dirty = 0; bump(); return tb.id;
});
const tableTaps = id => Array(N).fill(`#floor .tbl[data-t="${id}"]`);

test('floor tables (simple view), solo / host / teammate: every press on a table counts once, under the same finger', { timeout: 180000 }, async () => {
  const solo = await soloShift('waiter');
  const t0 = await emptyTable(solo);
  await busy(solo); await trackNode(solo, 'tapTable');
  await presses(solo, tableTaps(t0));
  let p = await solo.evaluate(() => __press);
  assert.equal(p.calls, N, `solo: ${p.calls} of ${N} presses reached the table`); noSwap(p);
  assert.deepEqual(realErrors(solo), []);
  await closeAll();

  // The host plays the floor while a kitchen teammate taps away: each of its taps changes the shop on the host phone.
  let { host, mate } = await room('waiter', 'kitchen');
  const t1 = await emptyTable(host);
  await mate.evaluate(() => { window.__work = setInterval(() => kitKey('dump'), 200); });
  await trackNode(host, 'tapTable');
  await presses(host, tableTaps(t1));
  await mate.evaluate(() => clearInterval(__work));
  p = await host.evaluate(() => __press);
  assert.equal(p.calls, N, `host: ${p.calls} of ${N} presses reached the table`); noSwap(p);
  assert.deepEqual(realErrors(host), []); assert.deepEqual(realErrors(mate), []);
  await closeAll();

  ({ host, mate } = await room('till', 'waiter'));
  const t2 = await emptyTable(host);
  await mate.waitForFunction(id => document.querySelector(`#floor .tbl[data-t="${id}"] .empty`), t2, { timeout: 5000 });
  await trackNode(mate, 'tapTable');
  await presses(mate, tableTaps(t2));
  await settleNet(mate);
  p = await mate.evaluate(() => __press);
  // every press reached the table on this phone once; a tap on an empty table only shows a hint, no result
  assert.equal(p.calls, N, `teammate: ${p.calls} of ${N} presses reached the table`); noSwap(p);
  assert.deepEqual(realErrors(host), []); assert.deepEqual(realErrors(mate), []);
  await closeAll();
});

/** An empty stove slot with two or more things to cook (a press there opens the pop-up): its middle on the page. */
const popStove = page => page.evaluate(() => {
  const r = document.getElementById('ktv').getBoundingClientRect();
  const h = kHits.find(h => h.st && h.i !== undefined && !kitSlotsOf(h.st)[h.i] && kitTrays().filter(t => t.st === h.st && t.k !== 'rice2wok').length > 1);
  return h ? { x: r.left + h.x + h.w / 2, y: r.top + h.y + h.h / 2, st: h.st, i: h.i } : null;
});
/** Presses an empty stove (the pop-up opens under the finger), then the pop-up's first option, `n` times. */
async function popCycles(page, n) {
  for (let i = 0; i < n; i++) {
    const at = await popStove(page);
    assert.ok(at, `no empty stove with a choice left after ${i} dishes`);
    await fingerAt(page, at, 40 + Math.random() * 100);
    await page.waitForFunction(() => !document.getElementById('kpop').hidden, null, { timeout: 3000 });
    await sleep(40 + Math.random() * 160);
    await fingerTap(page, '#kpop [data-pop]', 40 + Math.random() * 100);
    await page.waitForFunction(at => document.getElementById('kpop').hidden && kitSlotsOf(at.st)[at.i], at, { timeout: 5000 });
    await sleep(40 + Math.random() * 160);
  }
}
/** No customers at all, so no ticket comes onto the rail and moves the stoves between finding one and pressing it. */
const quietKitchen = page => page.evaluate(() => { Bot.quiet(); G.groups.slice().forEach(g => leave(g, false)); bump(); });
const POPS = 3;

test('kitchen stove pop-up, solo and teammate phone: every option pressed starts one dish', { timeout: 150000 }, async () => {
  const solo = await soloShift('kitchen');
  await quietKitchen(solo); await sleep(400);
  await busy(solo); await trackNode(solo, 'kitKey');
  await popCycles(solo, POPS);
  let p = await solo.evaluate(() => __press);
  assert.equal(p.calls, POPS, `solo: ${p.calls} of ${POPS} options pressed reached the kitchen`); noSwap(p);
  assert.deepEqual(realErrors(solo), []);
  await closeAll();

  const { host, mate } = await room('waiter', 'kitchen');
  await quietKitchen(host); await sleep(800);
  await trackNode(mate, 'kitKey');
  await popCycles(mate, POPS);
  await settleNet(mate);
  p = await mate.evaluate(() => __press);
  // every option started one dish on this phone's own stoves, and stays there through the keyframes
  assert.equal(p.calls, POPS, `teammate: ${p.calls} of ${POPS} options pressed reached the kitchen`); noSwap(p);
  assert.equal(await mate.evaluate(() => Object.values(G.kit).flat().filter(Boolean).length), POPS, 'one dish cooking per option pressed');
  assert.deepEqual(realErrors(host), []); assert.deepEqual(realErrors(mate), []);
  await closeAll();
});

/** Opens the price board and closes it with a held press on 返回, `n` times. */
async function boardCycles(page, n) {
  for (let i = 0; i < n; i++) {
    await fingerTap(page, '#boardBtn', 40 + Math.random() * 100);
    await page.waitForFunction(() => !document.getElementById('boardWrap').hidden, null, { timeout: 3000 });
    await sleep(40 + Math.random() * 160);
    await fingerTap(page, '#boardClose', 40 + Math.random() * 100);
    await page.waitForFunction(() => document.getElementById('boardWrap').hidden, null, { timeout: 3000 });
    await sleep(40 + Math.random() * 160);
  }
}
const BOARDS = 4;

test('till price board, solo / host / teammate: every close press counts once', { timeout: 180000 }, async () => {
  const solo = await soloShift('till');
  await busy(solo); await trackNode(solo, 'closeBoard');
  await boardCycles(solo, BOARDS);
  let p = await solo.evaluate(() => __press);
  assert.equal(p.calls, BOARDS, `solo: the board closed ${p.calls} of ${BOARDS} times`); noSwap(p);
  assert.deepEqual(realErrors(solo), []);
  await closeAll();

  // Host on the till with a kitchen teammate tapping away; then a till teammate.
  for (const [hostSt, mateSt] of [['till', 'kitchen'], ['waiter', 'till']]) {
    const { host, mate } = await room(hostSt, mateSt);
    const till = hostSt === 'till' ? host : mate;
    if (mateSt === 'kitchen') await mate.evaluate(() => { window.__work = setInterval(() => kitKey('dump'), 200); });
    await trackNode(till, 'closeBoard');
    await boardCycles(till, BOARDS);
    if (mateSt === 'kitchen') await mate.evaluate(() => clearInterval(__work));
    p = await till.evaluate(() => __press);
    assert.equal(p.calls, BOARDS, `${hostSt === 'till' ? 'host' : 'teammate'}: the board closed ${p.calls} of ${BOARDS} times`); noSwap(p);
    assert.deepEqual(realErrors(host), []); assert.deepEqual(realErrors(mate), []);
    await closeAll();
  }
});
