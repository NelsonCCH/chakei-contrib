// Mid-shift seat switches, from a co-op shift played at 390x666: the host ran 屋邨 with 傳菜 on, sat at
// the runner, moved to 伙記 with the strip's 返做伙記 and could not seat or serve anyone; then 換做燒味 did nothing.
// Each test plays that path with real presses against a local Worker (the room's DO referee) and checks the new seat
// really works: its screen shows the shop's real state and a press there changes the shop.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, sleep } from './helpers/server.js';
import { mapTap } from './helpers/map.js';
import { launch, openGame, veteran, ROLES_LEARNED, realErrors, shot, roomFastForward } from './helpers/browser.js';

let srv, browser;
const pages = [];
before(async () => { srv = await startServer({ vars: { PLAYTEST: '1' } }); browser = await launch(); });
after(async () => { await browser?.close(); await srv?.stop(); });
async function closeAll() { for (const p of pages.splice(0)) { try { await p.context().close(); } catch {} } }
/** iPhone Chrome with its bars: 390x666 CSS px (the primary phone viewport). */
const PHONE_390 = { viewport: { width: 390, height: 666 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };

/** Every role learned and the ladder passed up to 打風前夕, so every level's seats are open. */
const SAVE = { ...ROLES_LEARNED, levels: { estate: 1, central: 1, mongkok: 1, airport: 1, typhoon: 1 } };
async function player(nick) {
  const p = await openGame(browser, srv.url, { device: PHONE_390, storage: veteran(nick, SAVE), latency: process.env.LAT ? { ms: Number(process.env.LAT), jitter: 60 } : null });
  pages.push(p);
  // rows already uploaded (POST /api/ptlog) leave the kept store: collect them as they go
  sent.set(p, []);
  p.on('request', r => { if (r.method() === 'POST' && r.url().includes('/api/ptlog')) { try { sent.get(p).push(...(JSON.parse(r.postData() || '{}').ev ?? [])); } catch { /* not JSON */ } } });
  // an unlock card can pop up over the menus: answer 遲啲, as a player would
  await p.addLocatorHandler(p.locator('#gatePop'), async () => { await p.click('#gateLater'); });
  return p;
}
async function hostRoom(extras, level = 'estate') {
  const host = await player('老闆');
  await host.click('#coopBtn'); await host.click('#hostBtn');
  await host.waitForFunction(() => NET.t && NET.t.up && NET.code);
  await host.click(`#coop [data-lv="${level}"]`); await host.waitForFunction(l => NET.level === l, level);
  for (const k of extras) { await host.click(`#coop [data-x="${k}"]`); await host.waitForFunction(x => NET.meta.extra.includes(x), k); }
  return host;
}
const sent = new Map();
/** The timing log's rows from this page: those uploaded plus those kept (saved every 3 s). */
const keptRows = async p => { await sleep(3300); return [...sent.get(p), ...await p.evaluate(() => { const k = JSON.parse(localStorage.getItem('ckf_pt_log') || '{"out":[],"pend":[]}'); return [...k.out.flatMap(b => b.ev), ...k.pend]; })]; };
/** A real tap at a point of the page (a finger), not an element click. */
const tapAt = (p, x, y) => p.touchscreen.tap(x, y);
/** Where the drawn floor's table `t` is on the page (floor-iso.ts: a tap nearest its anchor picks it). */
const tablePt = (p, t) => p.evaluate(id => { const a = isoAnchors[id], r = FSC.tv.getBoundingClientRect(); return { x: r.left + a.nx, y: r.top + a.ny }; }, t);
const phoneDump = p => p.evaluate(() => JSON.stringify({ roles: G.roles, sel: G.selected, sheet: G.sheet, P: (() => { const q = phone(); return q && { held: q.held, seats: Object.fromEntries(Object.entries(q.seats).map(([k, s]) => [k, [s.driver.type, s.driver.player, s.epoch]])), out: q.outbox.length, stats: q.stats }; })() }));
/**
 * The waiter's floor works on this phone after a seat switch: a group at the door is seated with two real taps, and a
 * table waiting to order opens the slip with one. Diagnostics go to the log when it does not.
 */
async function waiterWorks(host, tag) {
  const free = () => G.groups.find(g => g.state === 'queue' && G.tables.some(t => !seatProblem(g, t)));
  await host.waitForFunction(`(${free})()`, null, { timeout: 40000 });
  const gid = await host.evaluate(`(${free})().id`);
  await shot(host, `seat-switch-${tag}-floor`);
  assert.ok((await mapTap(host, { k: 'group', gid })).ok, 'the party outside on the map');   // the door list is gone on the map
  const t = await host.evaluate(id => { const g = G.groups.find(x => x.id === id); return G.tables.find(tb => !seatProblem(g, tb)).id; }, gid);
  const pt = await tablePt(host, t);
  await tapAt(host, pt.x, pt.y);
  const seated = await host.waitForFunction(id => { const g = G.groups.find(x => x.id === id); return !g || g.state !== 'queue'; }, gid, { timeout: 5000 }).then(() => true, () => false);
  if (!seated) console.log(tag, 'not seated', await phoneDump(host));
  assert.ok(seated, `${tag}: the group at the door was seated by two taps`);
  // the group reads the menu, then wants to order: one tap on its table opens the slip
  await host.waitForFunction(id => { const g = G.groups.find(x => x.id === id); return g && g.state === 'order'; }, gid, { timeout: 30000 });
  await tapAt(host, pt.x, pt.y);
  const slip = await host.waitForFunction(id => G.sheet && G.sheet.gid === id && !document.getElementById('sheet').hidden, gid, { timeout: 5000 }).then(() => true, () => false);
  await shot(host, `seat-switch-${tag}-slip`);
  if (!slip) console.log(tag, 'no slip', await phoneDump(host));
  assert.ok(slip, `${tag}: a tap on the table opened the slip`);
}

// The three 屋邨 runs with a 傳菜 seat (伙記 -> 換做傳菜 -> 返做伙記, with a slip open, seated at 傳菜 from the lobby) are gone
//: 屋邨 is a 樓面 level and 傳菜 is a floor task, not a seat. The run below keeps the switch
// away from the floor and back.
test('co-op on a 樓面 level (年廿八) with a teammate on the floor: 換做燒味 and 返做樓面, the strip says 樓面', { timeout: 240000 }, async () => {
  const host = await hostRoom([], 'newyear'),   // 打風前夕 until 洗碗 went: 年廿八 has 燒味
    code = await host.evaluate(() => NET.code), mate = await player('阿明');
  await mate.click('#coopBtn'); await mate.fill('#roomIn', code); await mate.click('#joinBtn');
  await mate.waitForSelector('#coop [data-seat="floor2"]');   // the host sits at 樓面1; 樓面2 is the floor's second place
  await mate.click('#coop [data-seat="floor2"]');
  await host.waitForFunction(() => Object.values(NET.seats).some(s => s.station === 'floor2'));
  await host.click('#hostGo');
  await host.waitForFunction(() => G.running && G.floor && Object.keys(G.roles).some(k => /^floor\d$/.test(k) && G.roles[k] === 'me'));
  await mate.waitForFunction(() => G && G.running && G.roles.floor === 'me');
  await host.waitForFunction(() => /你做樓面/.test(document.getElementById('xStrip').textContent));
  await host.click('#xStrip [data-sw="roast"]');
  await host.waitForFunction(() => G.roles.roast === 'me' && !document.getElementById('seatView').hidden);
  // the teammate still holds a floor seat: the aggregate role is 'remote', yet the computer runs another floor seat
  await host.waitForFunction(() => /返做樓面/.test(document.getElementById('xStrip').textContent));
  await shot(host, 'seat-switch-floor-roast');
  await host.click('#xStrip [data-sw=""]');
  await host.waitForFunction(() => G.roles.roast === 'ai' && Object.keys(G.roles).some(k => /^floor\d$/.test(k) && G.roles[k] === 'me') && !document.getElementById('floorWrap').hidden);
  await host.waitForFunction(() => /你做樓面/.test(document.getElementById('xStrip').textContent));
  await shot(host, 'seat-switch-floor-back');
  for (const p of [host, mate]) assert.deepEqual(realErrors(p), []);
  await closeAll();
});

/** A solo level from the level book at 伙記 (the floor on a 樓面 level). */
async function soloLevel(p, lv) {
  await p.click('#levelBtn');
  await p.click('#lvSt [data-st="waiter"]');
  await p.click(`#book [data-lv="${lv}"]`);
  await p.waitForFunction(l => G && G.running && G.level === l, lv);
}
// A switch before the log's first poll (100 ms after the start) lost its row: the shift was opened at the new seat. On a
// fast run the test below hit it now and then; this one always switches in the same task as the start.
test('solo 年廿八: a switch in the very first moment of the shift still gets its seat row', { timeout: 60000 }, async () => {
  const p = await player('老闆');
  await p.evaluate(() => { document.getElementById('startView').hidden = true; station = 'waiter'; armLevel('newyear'); start(); soloSwitch('roast'); });
  await p.waitForFunction(() => G.roles.roast === 'me');
  const seat = (await keptRows(p)).filter(r => r.e === 'seat').map(r => `${r.x.from}>${r.x.to}`);
  assert.deepEqual(seat, ['floor1>roast']);
  assert.deepEqual(realErrors(p), []);
  await closeAll();
});
test('solo 年廿八 at 伙記 (樓面): 換做燒味 moves to the roast counter, 返做樓面 back, and the log names both moves', { timeout: 180000 }, async () => {
  const p = await player('老闆');
  await soloLevel(p, 'newyear');
  await p.waitForFunction(() => /換做燒味/.test(document.getElementById('xStrip').textContent));
  assert.match(await p.textContent('#xStrip'), /你做樓面/);
  await p.click('#xStrip [data-sw="roast"]');
  await p.waitForFunction(() => G.roles.roast === 'me' && G.roles.floor1 === 'ai' && !document.getElementById('seatView').hidden);
  await p.frameLocator('#seatFrame').locator('#shop canvas').first().waitFor();
  assert.match(await p.textContent('#xStrip'), /你做燒味/);
  await shot(p, 'seat-switch-solo-roast');
  await p.click('#xStrip [data-sw=""]');
  await p.waitForFunction(() => G.roles.roast === 'ai' && Object.keys(G.roles).some(k => /^floor\d$/.test(k) && G.roles[k] === 'me') && !document.getElementById('floorWrap').hidden);
  const rows = await keptRows(p);
  const seat = rows.filter(r => r.e === 'seat').map(r => `${r.x.from}>${r.x.to}`);
  assert.ok(seat.includes('floor1>roast') && seat.some(s => s.startsWith('roast>floor')), JSON.stringify(seat));
  assert.deepEqual(realErrors(p), []);
  await closeAll();
});

// 'solo 中環 at 傳菜 (a solo seat)' is gone: 傳菜 is a 樓面 task, no seat picker offers it;
// tests/strip-roles.test.js plays 中環 at 水吧 with the floor run by the computer.

// An own-shop 外賣 shift (dinner, 新人) once showed a start row and nothing else in the playtest log when
// first read; its 81 gestures and end row reached the log later (batches go every FLUSH_MS and when the page hides).
// This keeps the path checked: real touches on the 外賣 screen at 390x666 become takeaway gesture rows.
// 外賣 is a 樓面 task, no longer a seat of the own shop, so the touches are played in its 員工培訓 lesson (a
// solo 外賣 seat still).
test('solo 外賣 seat (its lesson): touches on the station are logged as takeaway gestures', { timeout: 120000 }, async () => {
  const p = await player('老闆');
  await p.click('#tutBtn');
  await p.click('#book [data-train="takeaway"]');
  await p.waitForFunction(() => G && G.running && G.xseat === 'takeaway' && G.roles.takeaway === 'me' && soloSeatOn());
  if (await p.locator('#bossSay.stay').count()) await p.click('#bossSay');
  await p.frameLocator('#seatFrame').locator('canvas').first().waitFor();
  await sleep(3000);
  const box = await p.locator('#seatFrame').boundingBox();
  for (let i = 0; i < 8; i++) {
    const x = box.x + box.width * (0.2 + 0.07 * i), y = box.y + box.height * (0.3 + 0.05 * i);
    await tapAt(p, x, y); await sleep(250);
    await p.mouse.move(x, y); await p.mouse.down(); await p.mouse.move(x + 40, y + 60, { steps: 6 }); await p.mouse.up(); await sleep(250);
  }
  await shot(p, 'seat-switch-solo-takeaway');
  const rows = await keptRows(p);
  assert.ok(rows.some(r => r.e === 'shift' && r.x.seat === 'takeaway'), 'a start row for the 外賣 seat');
  assert.ok(rows.filter(r => r.e === 'g' && r.s === 'takeaway').length >= 4, 'takeaway gestures: ' + JSON.stringify(rows.filter(r => r.e !== 'g')));
  assert.deepEqual(realErrors(p), []);
  await closeAll();
});

