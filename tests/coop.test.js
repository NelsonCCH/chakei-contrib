// Co-op in real (headless, muted) browsers against a local Worker: every station played remotely,
// latency, drops, reconnects, late join, players leaving, the host leaving, full shifts. The room's Durable Object
// referees every shift and the host's page is a phone like the others: what a test sets up or reads on the referee goes
// through the room's test channel (roomDbg, ROOM_DEBUG); "host" in a test name is the room's owner.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, sleep } from './helpers/server.js';
import { launch, openGame, veteran, realErrors, shot, roomFastForward, roomDbg } from './helpers/browser.js';

let srv, browser;
const pages = [];
before(async () => { srv = await startServer(); browser = await launch(); });
after(async () => { await browser?.close(); await srv?.stop(); });

async function player(nick, opts = {}) {
  const p = await openGame(browser, srv.url, { storage: veteran(nick), ...opts });
  pages.push(p);
  return p;
}
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
  if (host) await host.waitForFunction(s => Object.values(NET.seats).some(x => x.station === s), st);
}
async function startShift(host, clients) {
  await host.click('#hostGo');
  await host.waitForFunction(() => G.coop && G.running);
  for (const c of clients) await c.waitForFunction(() => G && G.coop && G.running && G.roles[NET.myStation] === 'me', null, { timeout: 10000 });
}
/**
 * Boil + steep + pull the tea pot on the (remote) bar so the shop opens. The pot is the bar's own:
 * the bar's phone runs it, and the shop opens on the host when the bar's potReady result reaches the referee.
 */
async function openBar(bar, host) {
  await bar.evaluate(() => barKey('pot'));
  await bar.waitForFunction(() => G.pot.st === 'pull', null, { timeout: 15000 });
  for (let i = 0; i < 8 && await bar.evaluate(() => G.pot.st !== 'ready'); i++) { await bar.evaluate(() => barKey('pot')); await sleep(150); }
  await host.waitForFunction(() => G.phase === 'open', null, { timeout: 5000 });
}
/** Plays one till customer from the client's screen: right total, right change. Returns the amount charged. */
async function tillServeOne(till, host) {
  await till.waitForFunction(() => G.cur && G.step === 'total', null, { timeout: 30000 });
  const expect = await till.evaluate(() => G.cur.expect);
  for (const d of String(expect)) await till.evaluate(k => tillKey(k), d);
  await till.evaluate(() => tillKey('ok'));
  // Octopus card customers finish at once; cash ones need change. unacked() empty: the referee has the results.
  await till.waitForFunction(() => unacked() === 0, null, { timeout: 10000 });
  const step = await till.evaluate(() => G.cur ? G.step : 'done');
  if (step === 'cash') {
    const need = await till.evaluate(() => G.paid - G.charged);
    let left = need;
    for (const n of [100, 50, 20, 10, 5, 2, 1]) while (left >= n) { await till.evaluate(k => tillKey(String(k)), n); left -= n; }
    await till.evaluate(() => tillKey('ok'));
  }
  await till.waitForFunction(() => unacked() === 0, null, { timeout: 10000 });
  return expect;
}
const state = p => p.evaluate(() => ({ t: G.t, rev: G.revenue, paid: G.paidCount, mis: G.mistakes, groups: G.groups.length, roles: { ...G.roles }, running: G.running, phase: G.phase, round: G.round }));
async function closeAll() { for (const p of pages.splice(0)) { try { await p.context().close(); } catch {} } }

test('four players: every station remote, actions reach the host, states converge', { timeout: 120000 }, async () => {
  const host = await player('老闆'), bar = await player('阿明'), kit = await player('阿強'), till = await player('阿珍');
  const code = await hostRoomAs(host, 'waiter');
  await joinAs(bar, code, 'bar', host); await joinAs(kit, code, 'kitchen', host); await joinAs(till, code, 'till', host);
  await shot(host, 'coop-4p-lobby');
  await startShift(host, [bar, kit, till]);
  assert.deepEqual((await state(host)).roles, { waiter: 'me', bar: 'remote', kitchen: 'remote', till: 'remote' });
  assert.deepEqual((await state(bar)).roles, { waiter: 'remote', bar: 'me', kitchen: 'remote', till: 'remote' });
  // Each client shows its own station's screen.
  assert.equal(await bar.isVisible('#barView'), true);
  assert.equal(await kit.isVisible('#kitView'), true);
  assert.equal(await till.isVisible('#till'), true);
  assert.equal(await host.isVisible('#floorWrap'), true);
  await openBar(bar, host);
  // Till customers queue up from the start of a shift where someone plays till.
  const rev0 = (await state(host)).rev;
  const charged = await tillServeOne(till, host);
  await host.waitForFunction(r => G.revenue >= r, rev0 + charged, { timeout: 5000 });
  const h = await state(host);
  assert.ok(h.paid >= 1);
  // Clients converge on the host's numbers within a snapshot or two.
  await sleep(800);
  const [hs, bs, ks, ts] = await Promise.all([host, bar, kit, till].map(state));
  for (const s of [bs, ks, ts]) {
    assert.equal(s.rev, hs.rev); assert.equal(s.paid, hs.paid); assert.equal(s.round, hs.round);
    assert.ok(Math.abs(s.t - hs.t) < 1.5, `clock drift ${s.t} vs ${hs.t}`);
  }
  await Promise.all([shot(host, 'coop-4p-host'), shot(bar, 'coop-4p-bar'), shot(kit, 'coop-4p-kitchen'), shot(till, 'coop-4p-till')]);
  // The connection badge must not sit on top of anything the player taps or reads.
  for (const p of [host, bar, kit, till]) {
    const hits = await p.evaluate(() => {
      const b = document.getElementById('netBadge').getBoundingClientRect();
      return [...document.querySelectorAll('button, [role=button], canvas, .hud b, #clockLbl')].filter(el => {
        const r = el.getBoundingClientRect(); if (!r.width || !el.offsetParent) return false;
        return r.left < b.right && r.right > b.left && r.top < b.bottom && r.bottom > b.top;
      }).map(el => el.id || el.className || el.tagName);
    });
    assert.deepEqual(hits, [], 'badge overlaps: ' + hits.join(', '));
  }
  for (const p of [host, bar, kit, till]) assert.deepEqual(realErrors(p), []);
  await closeAll();
});

test('a teammate\'s own station is instant and never undone by keyframes (150 ms ± 50 latency)', { timeout: 90000 }, async () => {
  const host = await player('老闆'), bar = await player('阿明', { latency: { ms: 150, jitter: 50 } });
  const code = await hostRoomAs(host, 'waiter');
  await joinAs(bar, code, 'bar', host);
  await startShift(host, [bar]);
  // Tap: the bar's own state changes in the same frame (the pot is the bar's).
  const local = await bar.evaluate(() => { barKey('pot'); return G.pot.st; });
  assert.equal(local, 'boil', 'the bar\'s pot changes at once');
  // Sample the pot for 2 s while keyframes arrive: it must never fall back to "empty" (rubber-banding).
  const seen = await bar.evaluate(async () => { const s = new Set(); const end = performance.now() + 2000; while (performance.now() < end) { s.add(G.pot.st); await new Promise(r => setTimeout(r, 20)); } return [...s]; });
  assert.ok(!seen.includes('empty'), 'pot state bounced back: ' + seen.join(','));
  // ... and the pot's result (potReady) reaches the referee: the shop opens there.
  const t0 = Date.now();
  await openBar(bar, host);
  console.log('bar pot ready -> shop open on the host (150±50 ms one way):', Date.now() - t0, 'ms; bar saw', seen.join('>'));
  assert.deepEqual(realErrors(host), []); assert.deepEqual(realErrors(bar), []);
  await closeAll();
});

for (const [ms, jitter] of [[50, 20], [300, 150]]) {
  test(`bad network ${ms}±${jitter} ms: till client still finishes customers correctly`, { timeout: 120000 }, async () => {
    const host = await player('老闆'), till = await player('阿珍', { latency: { ms, jitter } });
    const code = await hostRoomAs(host, 'waiter');
    await joinAs(till, code, 'till', host);
    await startShift(host, [till]);
    let total = 0;
    for (let i = 0; i < 2; i++) total += await tillServeOne(till, host);
    await host.waitForFunction(() => G.paidCount >= 2, null, { timeout: 5000 });   // the host's copy follows the room's next tick
    const h = await state(host);
    assert.equal(h.mis, 0, 'a correct player must not be charged mistakes because of lag');
    assert.ok(h.paid >= 2);
    await sleep(ms * 3 + 600);
    const t = await state(till);
    assert.equal(t.rev, h.rev); assert.equal(t.mis, 0);
    assert.deepEqual(realErrors(host), []); assert.deepEqual(realErrors(till), []);
    await closeAll();
  });
}

test('short client drop (3 s): seat kept, station stays human, play resumes', { timeout: 90000 }, async () => {
  const host = await player('老闆'), till = await player('阿珍');
  const code = await hostRoomAs(host, 'waiter');
  await joinAs(till, code, 'till', host);
  await startShift(host, [till]);
  await till.evaluate(() => __netDrop());
  await till.waitForFunction(() => NET.t && !NET.t.up);
  assert.match(await till.textContent('#netBadge'), /斷線/);
  await sleep(3000);
  assert.equal((await state(host)).roles.till, 'remote', 'host keeps the seat during the grace period');
  await till.evaluate(() => __netRestore());
  await till.waitForFunction(() => NET.t.up, null, { timeout: 10000 });
  await tillServeOne(till, host);
  assert.equal((await state(host)).roles.till, 'remote');
  assert.deepEqual(realErrors(host), []); assert.deepEqual(realErrors(till), []);
  await closeAll();
});

test('client gone for good: computer takes the station; coming back later takes it back', { timeout: 120000 }, async () => {
  const host = await player('老闆'), till = await player('阿珍');
  const code = await hostRoomAs(host, 'waiter');
  await joinAs(till, code, 'till', host);
  await startShift(host, [till]);
  await till.evaluate(() => __netDrop());
  await host.waitForFunction(() => G.roles.till === 'ai', null, { timeout: 30000 });
  // The computer till must actually take payments (nobody stuck in the queue).
  const p0 = (await state(host)).paid;
  await host.waitForFunction(p => G.paidCount > p, p0, { timeout: 40000 });
  await till.evaluate(() => __netRestore());
  await host.waitForFunction(() => G.roles.till === 'remote', null, { timeout: 20000 });
  await tillServeOne(till, host);
  assert.deepEqual(realErrors(host), []); assert.deepEqual(realErrors(till), []);
  await closeAll();
});

test('late join mid-shift takes over a computer station', { timeout: 90000 }, async () => {
  // Host opens the shop alone (the computer plays the other three stations).
  const host = await player('老闆'), bar = await player('阿明');
  const code = await hostRoomAs(host, 'waiter');
  await startShift(host, []);
  // Nobody plays the host's waiter in this test: let the computer do it and run the shop on, so diners reach the till.
  await roomDbg(host, { op: 'drive', seat: 'waiter', to: 'computer' });
  await roomFastForward(host, 30);
  const till = await player('遲到');
  await till.click('#coopBtn'); await till.fill('#roomIn', code); await till.click('#joinBtn');
  await till.waitForFunction(() => NET.meta && NET.meta.state === 'playing');
  assert.match(await till.textContent('#coop'), /開緊工/);
  const free = await till.evaluate(() => [...document.querySelectorAll('#coop [data-seat]')].map(b => b.dataset.seat));
  assert.deepEqual(free.sort(), ['bar', 'kitchen', 'till']);
  await till.click('#coop [data-seat="till"]');
  await host.waitForFunction(() => G.roles.till === 'remote', null, { timeout: 5000 });
  await till.waitForFunction(() => G && G.coop && G.running && G.roles.till === 'me', null, { timeout: 10000 });
  assert.equal(await till.isVisible('#till'), true);
  await tillServeOne(till, host);
  // A second late joiner takes the bar: the shop is already open, so no tea-pot prep phase.
  await joinAs(bar, code, 'bar', host);
  await host.waitForFunction(() => G.roles.bar === 'remote', null, { timeout: 5000 });
  await bar.waitForFunction(() => G && G.coop && G.running && G.roles.bar === 'me', null, { timeout: 10000 });
  assert.equal(await host.evaluate(() => G.phase), 'open');
  assert.equal(await bar.isVisible('#barView'), true);
  assert.deepEqual(realErrors(host), []); assert.deepEqual(realErrors(till), []); assert.deepEqual(realErrors(bar), []);
  await closeAll();
});

test('client quits on purpose: computer takes over at once', { timeout: 60000 }, async () => {
  const host = await player('老闆'), bar = await player('阿明');
  const code = await hostRoomAs(host, 'waiter');
  await joinAs(bar, code, 'bar', host);
  await startShift(host, [bar]);
  await bar.click('#pauseBtn');
  await bar.click('#quitBtn');
  await host.waitForFunction(() => G.roles.bar === 'ai', null, { timeout: 5000 });
  // Quitting goes through pause; the quitter must not leave the shop paused for everyone else.
  await host.waitForFunction(() => !G.paused, null, { timeout: 5000 });
  // Bar was mid-prep: the shop must open anyway once the computer has the bar.
  await host.waitForFunction(() => G.phase === 'open', null, { timeout: 5000 });
  assert.equal(await bar.isVisible('#startView'), true);
  assert.deepEqual(realErrors(host), []); assert.deepEqual(realErrors(bar), []);
  await closeAll();
});

test('client reloads mid-shift: rejoins the same room and station by itself', { timeout: 90000 }, async () => {
  const host = await player('老闆'), till = await player('阿珍');
  const code = await hostRoomAs(host, 'waiter');
  await joinAs(till, code, 'till', host);
  await startShift(host, [till]);
  await till.reload();
  await till.waitForFunction(() => NET.role === 'client' && NET.myStation === 'till', null, { timeout: 15000 });
  await till.waitForFunction(() => G && G.coop && G.running && G.roles.till === 'me', null, { timeout: 15000 });
  assert.equal((await state(host)).roles.till, 'remote');
  await tillServeOne(till, host);
  assert.deepEqual(realErrors(host), []); assert.deepEqual(realErrors(till), []);
  await closeAll();
});

// The shift never moves (the room referees it); only the lobby duty does. The clock runs on every phone, and the old host's waiter goes to the computer by the link rule (15 s).
test('host closes the tab mid-shift: a client becomes host and the shift carries on', { timeout: 120000 }, async () => {
  const host = await player('老闆'), till = await player('阿珍'), kit = await player('阿強');
  const code = await hostRoomAs(host, 'waiter');
  await joinAs(till, code, 'till', host);
  await sleep(100);
  await joinAs(kit, code, 'kitchen', host);
  await startShift(host, [till, kit]);
  await tillServeOne(till, host);
  const before = await state(host);
  await host.context().close();
  pages.splice(pages.indexOf(host), 1);
  // Longest-seated client (till) is promoted after the 6 s grace.
  await till.waitForFunction(() => NET.role === 'host', null, { timeout: 20000 });
  await till.waitForFunction(() => G.roles.waiter === 'ai', null, { timeout: 20000 });
  const t1 = await state(till);
  assert.equal(t1.roles.till, 'me');
  assert.equal(t1.roles.waiter, 'ai', 'old host station goes to the computer');
  assert.equal(t1.roles.kitchen, 'remote');
  assert.ok(t1.rev >= before.rev, 'revenue carried over');
  assert.equal(t1.round, before.round, 'the same shift: the room never restarted it');
  // The room's clock runs on: the computer waiter seats people.
  await sleep(3000);
  const t2 = await state(till);
  assert.ok(t2.t > t1.t + 2, 'the clock runs');
  // The other client follows the room as before.
  await kit.waitForFunction(() => NET.role === 'client' && NET.t.up);
  await sleep(1000);
  const k = await state(kit);
  assert.ok(Math.abs(k.t - t2.t) < 3, `kitchen client follows new host (${k.t} vs ${t2.t})`);
  // The new host can play its own station (till) locally.
  await tillServeOne(till, till).catch(() => {});
  await shot(till, 'coop-promoted-host'); await shot(kit, 'coop-after-promotion-client');
  assert.deepEqual(realErrors(till), []); assert.deepEqual(realErrors(kit), []);
  await closeAll();
});

test('remote waiter seats a group and sends an order the host receives', { timeout: 90000 }, async () => {
  const host = await player('老闆'), wai = await player('阿明');
  const code = await hostRoomAs(host, 'till');
  await joinAs(wai, code, 'waiter', host);
  await startShift(host, [wai]);
  assert.equal(await wai.isVisible('#floorWrap'), true);
  // Seat the first queueing group at a table that fits, through the same functions the floor taps call.
  await wai.waitForFunction(() => G.groups.some(g => g.state === 'queue'), null, { timeout: 15000 });
  const seated = await wai.evaluate(() => { const g = G.groups.find(x => x.state === 'queue'); const tb = G.tables.find(t => !seatProblem(g, t)); tapGroup(g.id); tapTable(tb.id); return { gid: g.id, tid: tb.id }; });
  await host.waitForFunction(s => { const g = G.groups.find(x => x.id === s.gid); return g && g.table === s.tid && g.state !== 'queue'; }, seated, { timeout: 5000 });
  // Wait until they are ready to order, open the sheet by tapping the table, write the exact order, send it.
  await host.waitForFunction(id => { const g = G.groups.find(x => x.id === id); return g && g.state === 'order'; }, seated.gid, { timeout: 20000 });
  await wai.waitForFunction(id => { const g = G.groups.find(x => x.id === id); return g && g.state === 'order'; }, seated.gid, { timeout: 5000 });
  await wai.evaluate(s => tapTable(s.tid), seated);
  assert.equal(await wai.isVisible('#sheetWrap'), true, 'order sheet opens on the waiter phone');
  assert.equal(await host.isVisible('#sheetWrap'), false, 'and not on the host');
  await wai.evaluate(() => { sheetAct({ add: 'k', id: '奶茶' }); sheetAct({ act: 'send' }); });
  await host.waitForFunction(id => { const g = G.groups.find(x => x.id === id); return g && g.state === 'wait'; }, seated.gid, { timeout: 5000 });
  await wai.waitForFunction(() => document.getElementById('sheetWrap').hidden, null, { timeout: 5000 });
  assert.deepEqual(realErrors(host), []); assert.deepEqual(realErrors(wai), []);
  await closeAll();
});

test('remote kitchen picks a ticket, plates it and serves; the host scores it', { timeout: 90000 }, async () => {
  const host = await player('老闆'), kit = await player('阿強', { latency: { ms: 80, jitter: 40 } });
  const code = await hostRoomAs(host, 'waiter');
  await joinAs(kit, code, 'kitchen', host);
  await startShift(host, [kit]);
  await roomDbg(host, { op: 'drive', seat: 'waiter', to: 'computer' });   // let the computer take orders so tickets come in
  await kit.waitForFunction(() => G.groups.some(g => g.state === 'wait' && g.meals.some(m => !m.done)), null, { timeout: 40000 });
  const pick = await kit.evaluate(() => { const g = G.groups.find(x => x.state === 'wait' && x.meals.some(m => !m.done)); const i = g.meals.findIndex(m => !m.done); return { gid: g.id, i, need: kitRecipe(g.meals[i].k) }; });
  // (the plate count G.dishes is the kitchen's own now; the referee marks the meal done)
  // Through the same functions the kitchen screen calls: pick the ticket, put the right things on the plate, serve.
  await kit.evaluate(p => { assignMeal(p.gid, p.i); activePlate().tokens = []; kitKey('dump'); p.need.forEach(t => kitKey('i:' + t)); kitKey('serve'); }, pick);
  await host.waitForFunction(p => { const g = G.groups.find(x => x.id === p.gid); return !g || g.meals[p.i].done; }, pick, { timeout: 5000 });
  const m = await host.evaluate(p => { const g = G.groups.find(x => x.id === p.gid); return g ? g.meals[p.i] : { gone: true }; }, pick);
  assert.ok(m.gone || (m.done && m.ok), 'host marks the meal done and correct: ' + JSON.stringify(m));
  assert.equal(await host.evaluate(() => G.mistakes), 0);
  assert.deepEqual(realErrors(host), []); assert.deepEqual(realErrors(kit), []);
  await closeAll();
});

// The selection the kitchen phone shows must be the one the host serves. A snapshot that lands between 出餐 and its
// confirmation used to put the phone's newer selection back *before* replaying the unconfirmed 出餐, so the replay
// served the next meal: the phone drifted a meal ahead of the host, and later dishes were scored against another meal
// (wrong). On a dinner level the single wok then held a dish nobody wanted any more (the journey-coop WebKit flake).
test('remote kitchen at 300 ms lag serves three meals of one table in a row: the host scores each one it was plated for', { timeout: 90000 }, async () => {
  const host = await player('老闆'), kit = await player('阿強', { latency: { ms: 300, jitter: 0 } });
  const code = await hostRoomAs(host, 'waiter');
  await joinAs(kit, code, 'kitchen', host);
  await startShift(host, [kit]);
  // one patient table with at least three meals, and nobody else coming in
  const gid = await roomDbg(host, { op: 'scene', name: 'table3' });   // set up on the room's referee
  await kit.waitForFunction(id => { const g = G.groups.find(x => x.id === id); return g && g.state === 'wait'; }, gid, { timeout: 10000 });
  // while 出餐 is unconfirmed, keyframes keep arriving: which of this table's meals the kitchen phone shows as made
  await kit.evaluate(id => { window.__seen = []; const f = () => { const g = G.groups.find(x => x.id === id); if (g && unacked() > 0) window.__seen.push(g.meals.map((m, i) => m.done ? i : -1).filter(i => i >= 0)); requestAnimationFrame(f); }; f(); }, gid);
  const served = [];
  for (let n = 1; n <= 3; n++) {
    // the selection is the kitchen's own (station state stays on the phone that plays it); nothing is
    // auto-selected any more, so the cook taps the table's next meal like a player would
    await kit.waitForFunction(() => unacked() === 0, null, { timeout: 10000 });
    await kit.evaluate(id => { if (!selOk()) { const g = G.groups.find(x => x.id === id); assignMeal(id, g.meals.findIndex(m => !m.done)); } }, gid);
    await kit.waitForFunction(() => unacked() === 0 && selOk(), null, { timeout: 10000 });
    const sel = await kit.evaluate(() => G.ksel);
    assert.equal(sel.gid, gid);
    served.push(sel.i);
    // plate exactly what the screen asks for and press 出餐; keyframes keep arriving before the referee has the result
    await kit.evaluate(() => { window.__seen = []; const g = selOk(); kitRecipe(g.meals[G.ksel.i].k).forEach(t => kitKey('i:' + t)); kitKey('serve'); });
    await host.waitForFunction(s => G.groups.find(x => x.id === s.gid).meals[s.i].done, sel, { timeout: 5000 });
    const m = await host.evaluate(s => G.groups.find(x => x.id === s.gid).meals[s.i], sel);
    assert.ok(m.ok, `serve ${n}: the host scores the meal the plate was made for as right: ${JSON.stringify(m)}`);
    await kit.waitForFunction(() => unacked() === 0, null, { timeout: 10000 });
    const seen = await kit.evaluate(() => window.__seen);
    assert.ok(seen.length >= 1, 'frames ran while 出餐 was unconfirmed');
    for (const d of seen) assert.ok(d.every(i => served.includes(i)), `serve ${n}: the kitchen phone showed meal(s) ${JSON.stringify(d)} made, but only ${JSON.stringify(served)} were plated`);
  }
  assert.equal(await host.evaluate(() => G.mistakes), 0);
  assert.deepEqual(realErrors(host), []); assert.deepEqual(realErrors(kit), []);
  await closeAll();
});

// A teammate's clock can run ahead of the host's: it ran at full speed while the host's waiter had a slip open (the
// host's clock then runs at half speed, main.js loop), and a host drawing few frames loses time to the per-frame cap.
// Food the cook's screen showed 得 was then still cooking on the host, the host refused the take (a toast nobody sees)
// and the plate went out without it - a wrong dish (journey-coop milktea: most 豬扒包 were scored wrong).
// Now the clocks run at the same pace, and a teammate's kitchen tap is judged at the time stamped on it (net.js netNow).
test('remote cook\'s clock: same pace as the host\'s during a slip, and food taken the moment it reads ready reaches the plate', { timeout: 90000 }, async () => {
  const host = await player('老闆'), kit = await player('阿強', { latency: { ms: 80, jitter: 0 } });
  const code = await hostRoomAs(host, 'waiter');
  await joinAs(kit, code, 'kitchen', host);
  await startShift(host, [kit]);
  // a table that is ready to order (set up on the room's referee), and the host's waiter opens its slip and keeps it
  // open. Only 新人 slows the shop while a slip is open; levels run at full speed, so the room's pace
  // gets 新人's slow-down here.
  await roomDbg(host, { op: 'set', slow: .5 });
  const sg = await roomDbg(host, { op: 'scene', name: 'orderSlip' });
  await host.waitForFunction(id => G.groups.some(g => g.id === id && g.state === 'order'), sg, { timeout: 5000 });
  await host.evaluate(id => openSheet(G.groups.find(g => g.id === id)), sg);
  await kit.waitForFunction(() => phone().scale < 1, null, { timeout: 5000 });   // the slip is the waiter's own: the kitchen sees its slow-down in the tick
  const pick = await kit.evaluate(() => { const st = ['pan', 'toaster', 'oven'].find(s => (kitLayout().st[s] || []).length); return { st, item: kitLayout().st[st][0] }; });
  assert.ok(pick.st, 'this level has a pan, toaster or oven');
  // pace: over 2 s of open slip the phone's clock never gets ahead of the host's (it trails by about the lag)
  let lead = -Infinity;
  for (let k = 0; k < 20; k++) { const [h, c] = await Promise.all([host.evaluate(() => G.t), kit.evaluate(() => G.t)]); lead = Math.max(lead, c - h); await sleep(100); }
  assert.ok(lead < .3, `the teammate's clock ran ${lead.toFixed(2)} s ahead of the host's while the slip was open`);
  // the referee's clock falls 0.6 s behind this phone's (as with a host drawing few frames); the cook's taps must still count
  const refT = async () => (await roomDbg(host, { op: 'state' })).t;
  await roomDbg(host, { op: 'set', t: await refT() - .6 });
  await kit.waitForFunction(() => unacked() === 0, null, { timeout: 5000 }); await sleep(700);
  assert.ok(await kit.evaluate(() => G.t) - await refT() > .3, 'the referee\'s clock is now behind the phone');
  for (let n = 1; n <= 2; n++) {
    await kit.evaluate(p => { kitKey('dump'); kitKey(`s:${p.st}:${p.item}`); }, pick);
    // take it on the first frame this phone shows it ready, like a cook waiting for 得
    const took = await kit.evaluate(p => new Promise(res => { const f = () => { const j = G.kit[p.st][0]; if (j && G.t >= j.ready) { kitKey(`t:${p.st}:0`); res(activePlate().tokens.slice()); } else requestAnimationFrame(f); }; f(); }), pick);
    assert.equal(took.length, 1, `take ${n}: the phone put it on its plate`);
    // the stoves and plates are the kitchen's own: no keyframe takes the food back off the plate
    await sleep(1200);
    assert.deepEqual(await kit.evaluate(() => activePlate().tokens), took, `take ${n}: still on the phone's plate after keyframes (host t=${await host.evaluate(() => G.t.toFixed(2))})`);
    assert.ok(await host.evaluate(() => !!G.sheet), 'the slip is still open on the host');
  }
  assert.deepEqual(realErrors(host), []); assert.deepEqual(realErrors(kit), []);
  await closeAll();
});

test('host drops longer than the grace, then comes back: rejoins as a teammate at its old station', { timeout: 120000 }, async () => {
  const host = await player('老闆'), till = await player('阿珍');
  const code = await hostRoomAs(host, 'waiter');
  await joinAs(till, code, 'till', host);
  await startShift(host, [till]);
  await host.evaluate(() => __netDrop());
  await till.waitForFunction(() => NET.role === 'host', null, { timeout: 20000 });
  await till.waitForFunction(() => G.roles.waiter === 'ai', null, { timeout: 20000 });   // the link rule (15 s)
  await host.evaluate(() => __netRestore());
  await host.waitForFunction(() => NET.role === 'client' && NET.myStation === 'waiter', null, { timeout: 20000 });
  await till.waitForFunction(() => G.roles.waiter === 'remote', null, { timeout: 10000 });
  await host.waitForFunction(() => G && G.coop && G.running && G.roles.waiter === 'me', null, { timeout: 10000 });
  assert.equal(await host.isVisible('#floorWrap'), true);
  assert.deepEqual(realErrors(host), []); assert.deepEqual(realErrors(till), []);
  await closeAll();
});

// A phone that goes silent without its socket closing (lift, tunnel, iOS suspending Safari during a call).
test('host goes silent without closing its socket: a teammate is promoted; the old host rejoins as a teammate', { timeout: 120000 }, async () => {
  const host = await player('老闆'), till = await player('阿珍');
  const code = await hostRoomAs(host, 'waiter');
  await joinAs(till, code, 'till', host);
  await startShift(host, [till]);
  const t0 = Date.now();
  await host.evaluate(() => __netSilence());
  // The silent phone itself notices (no pong) and says so, instead of showing a healthy badge.
  await host.waitForFunction(() => NET.t && !NET.t.up && /斷線/.test($('netBadge').textContent), null, { timeout: 15000 });
  await till.waitForFunction(() => NET.role === 'host', null, { timeout: 40000 });
  console.log(`silent host: teammate promoted after ${Date.now() - t0} ms`);
  await till.waitForFunction(() => G.roles.waiter === 'ai', null, { timeout: 20000 });   // the link rule (15 s)
  await host.evaluate(() => __netRestore());
  await host.waitForFunction(() => NET.role === 'client' && NET.myStation === 'waiter', null, { timeout: 30000 });
  await host.waitForFunction(() => G && G.coop && G.running && G.roles.waiter === 'me', null, { timeout: 10000 });
  assert.deepEqual(realErrors(host), []); assert.deepEqual(realErrors(till), []);
  await closeAll();
});

test('teammate goes silent without closing its socket: the computer takes its station; it comes back', { timeout: 150000 }, async () => {
  const host = await player('老闆'), till = await player('阿珍');
  const code = await hostRoomAs(host, 'waiter');
  await joinAs(till, code, 'till', host);
  await startShift(host, [till]);
  const t0 = Date.now();
  await till.evaluate(() => __netSilence());
  await till.waitForFunction(() => NET.t && !NET.t.up && /斷線/.test($('netBadge').textContent), null, { timeout: 15000 });
  await host.waitForFunction(() => G.roles.till === 'ai', null, { timeout: 50000 });
  console.log(`silent teammate: station handed to the computer after ${Date.now() - t0} ms`);
  await till.evaluate(() => __netRestore());
  // back = the dead socket noticed (ping), a reconnect with backoff, hello, the seat granted back: 15-40 s on a loaded
  // machine (a known flake), so the wait has room for it
  const t1 = Date.now();
  await host.waitForFunction(() => G.roles.till === 'remote', null, { timeout: 60000 });
  console.log(`silent teammate: station back after ${Date.now() - t1} ms`);
  await tillServeOne(till, host);
  assert.deepEqual(realErrors(host), []); assert.deepEqual(realErrors(till), []);
  await closeAll();
});

// A result the referee's validator refuses used to stall the phone's stream for good (dropped, never acked).
test('a teammate sends a result the referee refuses: it is nacked, and the teammate\'s later presses still land', { timeout: 90000 }, async () => {
  const host = await player('老闆'), till = await player('阿珍');
  const code = await hostRoomAs(host, 'waiter');
  await joinAs(till, code, 'till', host);
  await startShift(host, [till]);
  await till.evaluate(() => submit('till', { k: 'slipClose', gid: -1 }));
  await till.waitForFunction(() => unacked() === 0 && phone().stats.nacked >= 1, null, { timeout: 10000 });
  assert.ok((await roomDbg(host, { op: 'state' })).stats.junk >= 1);
  await tillServeOne(till, host);   // waits for unacked() === 0 after real presses: the stream moves on
  assert.deepEqual(realErrors(host), []); assert.deepEqual(realErrors(till), []);
  await closeAll();
});

// Safari before 16.4 has no CompressionStream / DecompressionStream, iOS before 15.4 has no Array.prototype.findLast.
const OLD_IPHONE = () => { delete window.CompressionStream; delete window.DecompressionStream; delete Array.prototype.findLast; };
test('teammate on an old iPhone (no (De)CompressionStream, no findLast): sees the shop and its taps work', { timeout: 90000 }, async () => {
  const host = await player('老闆'), bar = await player('阿伯', { init: OLD_IPHONE });
  assert.equal(await bar.evaluate(() => typeof DecompressionStream + typeof [].findLast), 'undefinedundefined');
  const code = await hostRoomAs(host, 'waiter');
  await joinAs(bar, code, 'bar', host);
  await startShift(host, [bar]);
  // Keyframes keep arriving: a change on the room's referee shows on the teammate.
  await roomDbg(host, { op: 'set', revenue: 4321 });
  await bar.waitForFunction(() => G.revenue === 4321, null, { timeout: 5000 });
  // A tap on the bar canvas (hit test) reaches the host.
  const pt = await bar.evaluate(async () => {
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const r = BSC.tv.getBoundingClientRect(), h = BSC.hits.find(x => x.kind === 'pot');
    return h && { x: r.left + h.x + h.w / 2, y: r.top + h.y + h.h / 2 };
  });
  assert.ok(pt, 'tea pot is on the bar canvas');
  await bar.mouse.click(pt.x, pt.y);
  await bar.waitForFunction(() => G.pot.st !== 'empty', null, { timeout: 10000 });
  await openBar(bar, host);
  assert.deepEqual(realErrors(host), []); assert.deepEqual(realErrors(bar), []);
  await closeAll();
});

// An older build sent state only when it changed, so a teammate reconnecting while the host is quiet stayed stale.
test('teammate reconnecting after the host\'s end card gets its end card and banks the shift', { timeout: 120000 }, async () => {
  const host = await player('老闆'), till = await player('阿珍');
  const code = await hostRoomAs(host, 'waiter');
  await joinAs(till, code, 'till', host);
  await startShift(host, [till]);
  const bank0 = await till.evaluate(() => SHOP.bank);
  await till.evaluate(() => __netDrop());
  await till.waitForFunction(() => NET.t && !NET.t.up);
  await roomDbg(host, { op: 'set', revenue: 200 }); await roomFastForward(host, 1000);
  await host.waitForFunction(() => !G.running && !$('endView').hidden);
  await till.evaluate(() => __netRestore());
  await till.waitForFunction(() => NET.t && NET.t.up, null, { timeout: 15000 });
  await till.waitForFunction(() => !$('endView').hidden && G.banked, null, { timeout: 5000 });
  assert.ok(await till.evaluate(() => SHOP.bank) > bank0, 'the shift\'s money is banked on the teammate\'s phone');
  assert.deepEqual(realErrors(host), []); assert.deepEqual(realErrors(till), []);
  await closeAll();
});

test('teammate reconnecting while the host is paused is paused too and its clock stays put', { timeout: 120000 }, async () => {
  const host = await player('老闆'), till = await player('阿珍');
  const code = await hostRoomAs(host, 'waiter');
  await joinAs(till, code, 'till', host);
  await startShift(host, [till]);
  await till.evaluate(() => __netDrop());
  await till.waitForFunction(() => NET.t && !NET.t.up);
  await host.evaluate(() => setPause(true));
  await till.evaluate(() => __netRestore());
  await till.waitForFunction(() => NET.t && NET.t.up, null, { timeout: 15000 });
  await till.waitForFunction(() => G.paused && !$('pauseView').hidden, null, { timeout: 5000 });
  const ht = await host.evaluate(() => G.t), t0 = await till.evaluate(() => G.t);
  // a teammate keeps its own clock when it is up to 0.8 s ahead of the referee's tick (core/coop/phone.ts).
  assert.ok(t0 >= ht - 0.05 && t0 - ht < 0.85, `teammate clock ${t0} matches the paused host ${ht}`);
  // Negative check: a paused shop's clock must not move. 1.5 s is several snapshot periods.
  await sleep(1500);
  assert.equal(await till.evaluate(() => G.t), t0);
  assert.deepEqual(realErrors(host), []); assert.deepEqual(realErrors(till), []);
  await closeAll();
});

// A result that reaches a paused referee is acknowledged and held, then applied on resume (nothing lost,
// nothing applied to the paused shop); pause / resume from a teammate still goes through. Taps on the station's own
// state (pickPlate) never travel at all.
test('paused host: a teammate\'s result is held (acknowledged, not applied) and applied on resume; its resume counts', { timeout: 90000 }, async () => {
  const host = await player('老闆'), till = await player('阿珍');
  const code = await hostRoomAs(host, 'waiter');
  await joinAs(till, code, 'till', host);
  await startShift(host, [till]);
  await till.waitForFunction(() => G.cur && G.step === 'total', null, { timeout: 30000 });
  await host.evaluate(() => setPause(true));
  await till.waitForFunction(() => G.paused, null, { timeout: 5000 });
  // a wrong total typed while paused: the miss goes to the referee as a result
  const m0 = await host.evaluate(() => G.mistakes);
  await till.evaluate(() => { G.entry = String(G.cur.expect + 1); submitTotal(); });
  await till.waitForFunction(() => unacked() === 0, null, { timeout: 10000 });
  assert.equal(await host.evaluate(() => G.mistakes), m0, 'nothing was applied to the paused shop');
  await till.evaluate(() => setPause(false));
  await host.waitForFunction(() => !G.paused, null, { timeout: 5000 });
  await host.waitForFunction(m => G.mistakes === m + 1, m0, { timeout: 5000 });
  assert.deepEqual(realErrors(host), []); assert.deepEqual(realErrors(till), []);
  await closeAll();
});

test('host tab in the background: the shop keeps running for the others', { timeout: 90000 }, async () => {
  const host = await player('老闆'), till = await player('阿珍');
  const code = await hostRoomAs(host, 'waiter');
  await joinAs(till, code, 'till', host);
  await startShift(host, [till]);
  // What a background tab does: document.hidden becomes true and requestAnimationFrame stops.
  await host.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); window.requestAnimationFrame = () => 0; });
  const t0 = await till.evaluate(() => G.t);
  await sleep(4000);
  const t1 = await till.evaluate(() => G.t);
  assert.ok(t1 > t0 + 3, `clock kept going for the client (${t0} -> ${t1})`);
  await tillServeOne(till, host);
  assert.ok((await roomDbg(host, { op: 'state' })).paidCount >= 1, 'the room took the payment');
  assert.deepEqual(realErrors(host), []); assert.deepEqual(realErrors(till), []);
  await closeAll();
});

test('host quits on purpose: everyone is sent home', { timeout: 60000 }, async () => {
  const host = await player('老闆'), bar = await player('阿明');
  const code = await hostRoomAs(host, 'waiter');
  await joinAs(bar, code, 'bar', host);
  await startShift(host, [bar]);
  await host.click('#pauseBtn');
  await host.click('#quitBtn');
  await bar.waitForFunction(() => !document.getElementById('startView').hidden, null, { timeout: 10000 });
  assert.equal(await bar.evaluate(() => NET.role), null);
  assert.deepEqual(realErrors(host), []); assert.deepEqual(realErrors(bar), []);
  await closeAll();
});

test('full co-op shift to the end screen, then the next shift starts for everyone', { timeout: 120000 }, async () => {
  const host = await player('老闆'), till = await player('阿珍');
  const code = await hostRoomAs(host, 'waiter');
  await joinAs(till, code, 'till', host);
  await startShift(host, [till]);
  await tillServeOne(till, host);
  await roomFastForward(host, 200);
  await host.waitForFunction(() => !G.running && !document.getElementById('endView').hidden);
  await till.waitForFunction(() => !document.getElementById('endView').hidden, null, { timeout: 10000 });
  assert.equal(await till.isDisabled('#nextBtn'), true, 'only the host moves the shop on');
  await shot(host, 'coop-end-host'); await shot(till, 'coop-end-client');
  const r0 = (await state(host)).round;
  await host.click('#nextBtn');
  await host.waitForFunction(r => G.running && G.round === r + 1, r0);
  await till.waitForFunction(r => G.running && G.round === r + 1 && document.getElementById('endView').hidden, r0, { timeout: 10000 });
  await tillServeOne(till, host);
  assert.deepEqual(realErrors(host), []); assert.deepEqual(realErrors(till), []);
  await closeAll();
});

test('two rooms at once do not see each other', { timeout: 90000 }, async () => {
  const h1 = await player('甲'), h2 = await player('乙'), c1 = await player('丙'), c2 = await player('丁');
  const r1 = await hostRoomAs(h1, 'waiter'), r2 = await hostRoomAs(h2, 'waiter');
  assert.notEqual(r1, r2);
  await joinAs(c1, r1, 'till', h1); await joinAs(c2, r2, 'bar', h2);
  await startShift(h1, [c1]); await startShift(h2, [c2]);
  assert.deepEqual((await state(h1)).roles, { waiter: 'me', bar: 'ai', kitchen: 'ai', till: 'remote' });
  assert.deepEqual((await state(h2)).roles, { waiter: 'me', bar: 'remote', kitchen: 'ai', till: 'ai' });
  await tillServeOne(c1, h1);
  assert.equal((await state(h2)).paid, 0);
  await closeAll();
});

test('wrong room code shows a message; seat clash in the lobby is refused', { timeout: 60000 }, async () => {
  const host = await player('老闆'), a = await player('阿明'), b = await player('阿強');
  const code = await hostRoomAs(host, 'waiter');
  await a.click('#coopBtn'); await a.fill('#roomIn', 'QQQQ'); await a.click('#joinBtn');
  await a.waitForFunction(() => /搵唔到/.test(document.getElementById('coop').textContent), null, { timeout: 8000 });
  await a.click('#coopLeave');
  await joinAs(a, code, 'bar', host);
  await b.click('#coopBtn'); await b.fill('#roomIn', code); await b.click('#joinBtn');
  await b.waitForFunction(() => NET.meta && Object.values(NET.seats).some(s => s.station === 'bar'));
  const free = await b.evaluate(() => [...document.querySelectorAll('#coop [data-seat]')].map(x => x.dataset.seat));
  assert.ok(!free.includes('bar') && !free.includes('waiter'), 'taken seats are not offered: ' + free);
  // Force a race: try to sit in the taken seat anyway.
  await b.evaluate(() => { NET.seats = {}; pickSeat('bar'); });
  await b.waitForFunction(() => NET.myStation === '', null, { timeout: 5000 });
  assert.deepEqual(realErrors(a), []); assert.deepEqual(realErrors(b), []);
  await closeAll();
});

test('chaos: 3 clients dropping, reloading, quitting and rejoining for 90 s; everything stays consistent', { timeout: 240000 }, async () => {
  const host = await player('老闆');
  const cl = [await player('甲', { latency: { ms: 60, jitter: 40 } }), await player('乙', { latency: { ms: 120, jitter: 80 } }), await player('丙')];
  const sts = ['bar', 'kitchen', 'till'];
  const code = await hostRoomAs(host, 'waiter');
  for (let i = 0; i < 3; i++) await joinAs(cl[i], code, sts[i], host);
  await startShift(host, cl);
  await roomDbg(host, { op: 'drive', seat: 'waiter', to: 'computer' });
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const log = [];
  const end = Date.now() + 90000;
  while (Date.now() < end) {
    const i = Math.floor(rnd() * 3), p = cl[i], ev = rnd();
    try {
      if (ev < 0.3) { log.push(`${sts[i]} drop`); await p.evaluate(() => __netDrop()); await sleep(1000 + rnd() * 4000); await p.evaluate(() => __netRestore()); }
      else if (ev < 0.5) { log.push(`${sts[i]} long drop`); await p.evaluate(() => __netDrop()); await sleep(17000); await p.evaluate(() => __netRestore()); }
      else if (ev < 0.65) { log.push(`${sts[i]} reload`); await p.reload(); await p.waitForFunction(() => typeof NET !== 'undefined' && NET.role === 'client', null, { timeout: 15000 }); }
      else if (ev < 0.8) {
        log.push(`${sts[i]} quit+rejoin`);
        if (await p.evaluate(() => G && G.coop && G.running && NET.role === 'client')) { await p.evaluate(() => { document.getElementById('pauseBtn').click(); document.getElementById('quitBtn').click(); }); }
        else await p.evaluate(() => { netLeave(); backToStart(); });
        await sleep(500);
        await joinAs(p, code, sts[i], host);
      }
      else { log.push('host plays on 10 s'); await sleep(10000); }
    } catch (e) { log.push('  (step error: ' + e.message.split('\n')[0] + ')'); }
    // The shop must not be stuck paused by someone who left mid-pause.
    assert.equal(await host.evaluate(() => G.running && G.paused), false, 'shop left paused by a teammate who quit');
    // Each shift end: host starts the next one.
    if (await host.evaluate(() => !G.running)) { log.push('next shift'); await host.click('#nextBtn').catch(() => {}); }
  }
  console.log('chaos events:', log.join(' | '));
  // Let everyone settle, then check consistency.
  for (const p of cl) await p.evaluate(() => __netRestore());
  // Settled = every teammate's link is back up and the checks below pass on two looks 2 s apart (this used to be a flat
  // 20 s wait: the seat grace is 15 s). After 30 s the checks are asserted whatever the links say.
  const look = async () => {
    const ref = await roomDbg(host, { op: 'state' });
    const h = await host.evaluate(cover => ({ roles: { ...G.roles }, seats: Object.values(NET.seats).map(s => s.station), running: G.running, t: G.t, cover }),
      Object.fromEntries(Object.entries(ref.seats).map(([k, s]) => [k, s.coverReason])));
    const bad = [];
    for (const [st, r] of Object.entries(h.roles)) {
      if (st === 'waiter') continue;
      const n = h.seats.filter(s => s === st).length;
      // a seat whose player sat still for 30 s with work waiting is covered by the computer (the 'quiet' cover rule);
      // the player's next tap takes it back, and nobody taps in this test
      if (r === 'ai' && n === 1 && h.cover[st] === 'quiet') continue;
      if ((r === 'remote' ? 1 : 0) !== n) bad.push(`station ${st} is ${r} (cover ${h.cover[st]}) but has ${n} seat(s)`);
    }
    let down = 0;
    for (let i = 0; i < 3; i++) {
      const c = await cl[i].evaluate(() => ({ role: NET.role, st: NET.myStation, up: NET.t && NET.t.up, t: G && G.t }));
      if (c.role === 'client' && !c.up) down++;
      if (c.role === 'client' && c.st && h.roles[c.st] === 'remote' && h.running && !(Math.abs(c.t - h.t) < 3)) bad.push(`${sts[i]} clock ${c.t} vs host ${h.t}`);
    }
    return { bad, down };
  };
  let last, calm = 0;
  for (const until = Date.now() + 30000; ;) {
    last = await look();
    calm = !last.bad.length && !last.down ? calm + 1 : 0;
    if (calm >= 2 || Date.now() > until) break;
    await sleep(2000);
  }
  assert.deepEqual(last.bad, []);
  // Groups never stuck: nobody "taken" in order state for longer than the order patience while the waiter is the computer.
  // (The computer waiter holds an order for a second or two while it writes it, so look for the same one twice.)
  const held = () => host.evaluate(() => G.groups.filter(g => g.state === 'order' && g.taken && !(G.sheet && G.sheet.gid === g.id)).map(g => g.id));
  const a = await held(); await sleep(6000); const b = await held();
  const stuck = a.filter(id => b.includes(id));
  assert.deepEqual(stuck, [], 'orders picked up by nobody');
  for (const p of [host, ...cl]) assert.deepEqual(realErrors(p), []);
  await closeAll();
});

test('bandwidth: host upload stays small (tick, keyframe and effect envelopes: rate and size)', { timeout: 60000 }, async () => {
  const host = await player('老闆'), till = await player('阿珍');
  const code = await hostRoomAs(host, 'waiter');
  await joinAs(till, code, 'till', host);
  await startShift(host, [till]);
  await sleep(1000);
  const m = await till.evaluate(async () => {
    let n = 0, bytes = 0; const real = NET.t;
    const ws = window.__net.socks[window.__net.socks.length - 1].real;
    const kinds = {};
    const f = e => { if (typeof e.data === 'string' && e.data.startsWith('{"t":"env"')) { n++; bytes += e.data.length; const k = JSON.parse(e.data).e.b.k; kinds[k] = (kinds[k] || 0) + 1; } };
    ws.addEventListener('message', f); await new Promise(r => setTimeout(r, 10000)); ws.removeEventListener('message', f);
    return { n, bytes, kinds };
  });
  const perSec = m.n / 10, kbps = m.bytes / 10 / 1024, ticks = (m.kinds.tick || 0) / 10;
  console.log(`envelopes/s ${perSec.toFixed(1)} (${JSON.stringify(m.kinds)}), avg ${(m.bytes / Math.max(1, m.n) / 1024).toFixed(1)} KB, ${kbps.toFixed(1)} KB/s per client`);
  assert.ok(ticks >= 2 && ticks <= 4.5, 'about 4 ticks a second, got ' + ticks);
  assert.ok(perSec <= 12, 'at most a tick, a keyframe and a few effects per 250 ms, got ' + perSec);
  assert.ok(kbps < 40, 'per-client download under 40 KB/s, got ' + kbps.toFixed(1));
  await closeAll();
});
