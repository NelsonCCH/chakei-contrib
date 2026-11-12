// The co-op room lobby's seats (a bug seen in play: one 樓面 row, 「＋樓面：傳菜」「＋樓面：外賣」 add-on
// toggles, and no way for the owner to change seat) at 390x666, headless and muted, against a local Worker: 樓面1 and
// 樓面2 are seats of their own (a player, the computer or off), the level's own stations (燒味) only where it has them, no
// 傳菜 / 外賣 seat or 加位 toggle anywhere; the owner and a teammate move by tapping 坐呢度; a teammate switches 樓面2
// between the computer and off (through the owner) and sits there; the shift gets the switched-on places as floor seats.
// Plus the stale build banner (src/ver/stale.ts): a different served build id offers a one-tap reload.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers/server.js';
import { launch, openGame, veteran, ROLES_LEARNED, PHONE, realErrors, shot } from './helpers/browser.js';

const P666 = { ...PHONE, viewport: { width: 390, height: 666 } };
const SAVE = { ...ROLES_LEARNED, levels: { estate: 1, central: 1, mongkok: 1, airport: 1, typhoon: 1, newyear: 1 } };
const TASKS = /伙記|傳菜|外賣|送外賣|執枱/;
let srv, browser;
const pages = [];
before(async () => { srv = await startServer(); browser = await launch(); });
after(async () => { for (const p of pages) { try { await p.context().close(); } catch {} } await browser?.close(); await srv?.stop(); });

async function player(nick) {
  const p = await openGame(browser, srv.url, { device: P666, storage: veteran(nick, SAVE) });
  pages.push(p);
  await p.addLocatorHandler(p.locator('#gatePop'), async () => { await p.click('#gateLater'); });
  return p;
}
const rows = p => p.$$eval('#coop ul.seats li', l => l.map(x => [x.dataset.k, x.querySelector('b').innerText, x.querySelector('span').innerText, x.className.trim()]));
const lobbyText = p => p.evaluate(() => document.getElementById('coop').innerText);
async function pickLevel(host, id) { await host.click(`#coop [data-lv="${id}"]`); await host.waitForFunction(l => NET.level === l && NET.meta.level === l, id); }
/** The lobby's seat list fits the phone: no row wider than the list, every button inside the screen's width. */
async function fits(p) {
  const bad = await p.evaluate(() => [...document.querySelectorAll('#coop ul.seats li, #coop ul.seats button')].filter(e => { const r = e.getBoundingClientRect(); return r.left < 0 || r.right > innerWidth + 0.5; }).map(e => e.outerHTML.slice(0, 80)));
  assert.deepEqual(bad, [], 'every seat row and button fits 390 px');
}

test('host: 樓面1 / 樓面2 + the level\'s stations (燒味 only on 年廿八), no 樓面：傳菜 / 外賣, taps a seat to move', { timeout: 90000 }, async () => {
  const host = await player('老闆');
  await host.click('#coopBtn'); await host.click('#hostBtn');
  await host.waitForFunction(() => NET.t && NET.t.up && NET.code);
  await pickLevel(host, 'newyear');
  let r = await rows(host);
  assert.deepEqual(r.map(x => x[1]), ['樓面1', '樓面2', '廚房', '水吧', '收銀', '燒味'], JSON.stringify(r));
  assert.deepEqual(r[0].slice(2), ['老闆（你）', 'mine'], 'the owner sits at 樓面1');
  assert.equal(r[1][2], '電腦', '樓面2 the computer\'s by default');
  const text = await lobbyText(host);
  assert.ok(!/樓面：|＋/.test(text), 'no 加位 toggle: ' + text);
  assert.ok(!r.some(x => TASKS.test(x[1])), 'no 傳菜 / 外賣 seat');
  assert.equal(await host.locator('#coop [data-x]').count(), 0, 'no 加位 toggle');
  assert.match(await host.textContent('#youDo'), /你開工做：樓面1/);
  await fits(host);
  await host.evaluate(() => document.querySelector('#coop .sh-head').scrollIntoView({ block: 'start' }));
  await shot(host, 'coop-lobby-host-newyear-390x666');

  await pickLevel(host, 'typhoon');
  r = await rows(host);
  assert.deepEqual(r.map(x => x[1]), ['樓面1', '樓面2', '廚房', '水吧', '收銀'], '打風前夕 has no 燒味: ' + JSON.stringify(r));
  assert.match(await lobbyText(host), /樓面要做埋傳菜、外賣/);
  await fits(host);
  await host.evaluate(() => document.querySelector('#coop .sh-head').scrollIntoView({ block: 'start' }));
  await shot(host, 'coop-lobby-host-typhoon-390x666');

  // the owner moves by tapping a seat: 水吧, then 樓面2 (no trip back to the start screen)
  await host.click('#coop li[data-k="bar"] [data-seat]');
  await host.waitForFunction(() => NET.meta.hostX === '' && NET.meta.hostStation === 'bar');
  assert.match(await host.textContent('#youDo'), /你開工做：水吧/);
  assert.match(await host.textContent('#coop li.mine'), /水吧.*（你）/);
  assert.equal((await rows(host))[0][2], '電腦', '樓面1 the computer\'s once the owner left it');
  await host.click('#coop li[data-k="floor2"] [data-seat]');
  await host.waitForFunction(() => NET.meta.hostX === 'floor2');
  assert.match(await host.textContent('#youDo'), /你開工做：樓面2/);
  assert.deepEqual(realErrors(host), []);
});

test('teammate: switches 樓面2 off and on through the owner, sits at it, and the shift seats both 樓面 places', { timeout: 120000 }, async () => {
  const host = await player('老闆');
  await host.click('#coopBtn'); await host.click('#hostBtn');
  await host.waitForFunction(() => NET.t && NET.t.up && NET.code);
  await pickLevel(host, 'typhoon');
  const code = await host.evaluate(() => NET.code), mate = await player('阿明');
  await mate.click('#coopBtn'); await mate.fill('#roomIn', code); await mate.click('#joinBtn');
  await mate.waitForSelector('#coop li[data-k="floor2"] [data-slot]');
  const mr = await rows(mate);
  assert.deepEqual(mr.map(x => x[1]), ['樓面1', '樓面2', '廚房', '水吧', '收銀']);
  assert.equal(mr[0][2], '老闆（老闆）', 'the owner (nick 老闆) at 樓面1');
  assert.equal(await mate.locator('#coop li[data-k="floor1"] [data-slot]').count(), 0, 'no switch on a place someone sits at');
  // 熄位 on 樓面2 (the teammate's tap goes to the owner, who decides)
  await mate.click('#coop li[data-k="floor2"] [data-slot]');
  await host.waitForFunction(() => (NET.meta.floorOff ?? []).includes('floor2'));
  await mate.waitForFunction(() => document.querySelector('#coop li[data-k="floor2"]')?.classList.contains('off'));
  assert.equal((await rows(mate))[1][2], '熄咗');
  assert.equal(await host.evaluate(() => floorOnNow()), 1, 'one 樓面 place on');
  await fits(mate);
  await shot(mate, 'coop-lobby-mate-floor2-off-390x666');
  // 開位 again, then off again and sit there: sitting at an off place switches it on
  await mate.click('#coop li[data-k="floor2"] [data-slot]');
  await host.waitForFunction(() => !(NET.meta.floorOff ?? []).includes('floor2'));
  await mate.waitForFunction(() => !document.querySelector('#coop li[data-k="floor2"]')?.classList.contains('off'));
  await mate.click('#coop li[data-k="floor2"] [data-slot]');
  await mate.waitForFunction(() => document.querySelector('#coop li[data-k="floor2"]')?.classList.contains('off'));
  await mate.click('#coop li[data-k="floor2"] [data-seat]');
  await host.waitForFunction(() => Object.values(NET.seats).some(s => s.station === 'floor2') && !(NET.meta.floorOff ?? []).length);
  await mate.waitForFunction(() => document.querySelector('#coop li.mine')?.dataset.k === 'floor2');
  assert.match(await host.textContent('#coop li[data-k="floor2"]'), /阿明/);
  // the teammate moves again by tapping: 收銀, then back to 樓面2
  await mate.click('#coop li[data-k="till"] [data-seat]');
  await host.waitForFunction(() => Object.values(NET.seats).some(s => s.station === 'till'));
  await mate.click('#coop li[data-k="floor2"] [data-seat]');
  await host.waitForFunction(() => Object.values(NET.seats).some(s => s.station === 'floor2'));
  await shot(mate, 'coop-lobby-mate-sat-floor2-390x666');
  // the shift: both 樓面 places are floor seats, each a player's; no 傳菜 / 外賣 seat
  await host.click('#hostGo');
  await mate.waitForFunction(() => G && G.running && G.floor && NET.myStation === 'waiter', null, { timeout: 15000 });
  const st = await host.evaluate(() => NET.t.dbg({ op: 'state' }));
  const floor = Object.entries(st.seats).filter(([k]) => /^floor\d$/.test(k)).map(([k, s]) => [k, s.driver.type]);
  assert.deepEqual(floor, [['floor1', 'player'], ['floor2', 'player']], JSON.stringify(st.seats));
  assert.ok(!('runner' in st.seats) && !('takeaway' in st.seats), Object.keys(st.seats).join());
  assert.deepEqual(realErrors(host), []); assert.deepEqual(realErrors(mate), []);
});

test('mid-shift: a teammate joining takes 樓面2 from the computer; an off 樓面2 is not offered while the shift runs', { timeout: 120000 }, async () => {
  const host = await player('老闆');
  await host.click('#coopBtn'); await host.click('#hostBtn');
  await host.waitForFunction(() => NET.t && NET.t.up && NET.code);
  await pickLevel(host, 'typhoon');
  await host.click('#hostGo');
  await host.waitForFunction(() => G && G.running && G.floor, null, { timeout: 15000 });
  const code = await host.evaluate(() => NET.code), mate = await player('阿明');
  await mate.click('#coopBtn'); await mate.fill('#roomIn', code); await mate.click('#joinBtn');
  await mate.waitForSelector('#coop li[data-k="floor2"] [data-seat]');
  assert.equal(await mate.locator('#coop [data-slot]').count(), 0, 'no 熄位 / 開位 while the shift runs');
  await mate.click('#coop li[data-k="floor2"] [data-seat]');
  await mate.waitForFunction(() => G && G.running && G.floor && phone()?.seats.floor2?.driver.player === NET.id, null, { timeout: 15000 });
  assert.deepEqual(realErrors(mate), []);
});

test('a newer build served: the one-tap 「有新版，撳一下更新」 banner reloads; the same build shows none', { timeout: 60000 }, async () => {
  const p = await player('測試員');
  await p.waitForTimeout(300);
  assert.equal(await p.evaluate(() => checkStale(true)), false, 'the same build: no banner');
  await p.route('**/version.json', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ build: 'newer-build' }) }));
  await p.waitForTimeout(2100);   // past the checks' 2 s spacing (the one just above)
  await p.evaluate(() => { window.__mark = 1; window.dispatchEvent(new Event('focus')); });
  await p.waitForSelector('#staleBar button', { timeout: 5000 });
  assert.equal(await p.textContent('#staleBar button'), '有新版，撳一下更新');
  await shot(p, 'stale-banner-390x666');
  // opening a room lobby checks too (a fresh page, the banner gone): the button shows over the lobby
  await Promise.all([p.waitForNavigation(), p.click('#staleBar button')]);
  assert.equal(await p.evaluate(() => window.__mark), undefined, 'the page reloaded');
  await p.waitForFunction(() => typeof buildMenus === 'function');
  await p.click('#coopBtn');
  await p.waitForSelector('#staleBar button', { timeout: 5000 });
  assert.deepEqual(realErrors(p), []);
});

// 組隊 and 派對 are two modes of one entry, a switch at the top flips the content in place
const entryHead = p => p.evaluate(() => ({ head: document.querySelector('#coop .sh-head b').innerText, host: document.getElementById('hostBtn').innerText,
  on: document.querySelector('#coop .mpsw button.on').dataset.mode, visible: !document.getElementById('coopView').hidden }));
test('entry: the 組隊 | 派對 switch flips the content in place and is remembered across a reload', { timeout: 60000 }, async () => {
  const p = await player('測試員');
  await p.click('#coopBtn');
  assert.deepEqual(await entryHead(p), { head: '組隊', host: '開房（我做老闆）', on: 'coop', visible: true });
  await p.fill('#roomIn', 'AB');
  await fits(p);
  await shot(p, 'mp-entry-coop-390x666');
  const el = await p.$('#coop');
  await p.click('#coop .mpsw [data-mode="party"]');
  assert.deepEqual(await entryHead(p), { head: '派對', host: '開派對房（我做老闆）', on: 'party', visible: true });
  assert.equal(await p.inputValue('#roomIn'), 'AB', 'a code being typed stays');
  assert.equal(await el.evaluate(e => e.isConnected), true, 'the same view: no extra screen');
  await shot(p, 'mp-entry-party-390x666');
  await p.reload(); await p.waitForFunction(() => typeof buildMenus === 'function');
  await p.click('#coopBtn');
  assert.equal((await entryHead(p)).on, 'party', 'the last choice is remembered');
  await p.click('#coop .mpsw [data-mode="coop"]');
  assert.equal(await p.evaluate(() => localStorage.getItem('ckf-mpmode')), 'coop');
  assert.deepEqual(realErrors(p), []);
});

test('a room code joins the room\'s own mode: a 派對 room from the 組隊 side, a 組隊 room from the 派對 side', { timeout: 90000 }, async () => {
  // a 派對 room: made on the 派對 side, the owner lands in the night's lobby (no 「開派對夜」 step)
  const ph = await player('派對老闆');
  await ph.click('#coopBtn'); await ph.click('#coop .mpsw [data-mode="party"]'); await ph.click('#hostBtn');
  await ph.waitForFunction(() => NET.night && document.querySelector('#coop .pty'), null, { timeout: 15000 });
  assert.equal(await ph.locator('#coop .mpsw [data-mode="party"].on').count(), 1, 'the owner\'s switch reads 派對');
  await shot(ph, 'mp-party-owner-lobby-390x666');
  const pcode = await ph.evaluate(() => NET.code);
  const pj = await player('阿明');
  await pj.click('#coopBtn');
  assert.equal((await entryHead(pj)).on, 'coop');
  await pj.fill('#roomIn', pcode); await pj.click('#joinBtn');
  await pj.waitForFunction(() => NET.night && document.querySelector('#coop .pty') && !document.querySelector('#coop ul.seats'), null, { timeout: 15000 });
  // a 組隊 room: made on the 組隊 side, joined from the 派對 side, lands in the co-op lobby
  const ch = await player('組隊老闆');
  await ch.click('#coopBtn'); await ch.click('#hostBtn');
  await ch.waitForFunction(() => NET.t && NET.t.up && NET.code && document.querySelector('#coop ul.seats'));
  assert.equal(await ch.locator('#coop #partyOpen').count(), 1, 'the owner\'s switch can turn the room into a 派對 room');
  assert.ok(!/開派對夜/.test(await lobbyText(ch)), 'no 「開派對夜」 button');
  const ccode = await ch.evaluate(() => NET.code);
  const cj = await player('阿芳');
  await cj.click('#coopBtn'); await cj.click('#coop .mpsw [data-mode="party"]');
  await cj.fill('#roomIn', ccode); await cj.click('#joinBtn');
  await cj.waitForFunction(() => NET.meta && document.querySelector('#coop ul.seats li[data-k="floor2"]'), null, { timeout: 15000 });
  assert.equal(await cj.evaluate(() => !!NET.night || !!document.querySelector('#coop .pty')), false, 'the co-op lobby, not a party night');
  for (const p of [ph, pj, ch, cj]) assert.deepEqual(realErrors(p), []);
});
