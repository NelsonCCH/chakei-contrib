// Co-op stress: four real (headless, muted) browsers tapping as fast as fingers can for a minute, over a laggy network,
// with drops and reloads mixed in. Every result a teammate's station reports must be taken by the referee (the host's
// phone) exactly once and acknowledged, and in the end every screen must show the same shared shop.
// Also: a slow host phone, and the room server under 8 sockets of load.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { startServer, sleep, roomSocket, ROOT } from './helpers/server.js';
import { launch, openGame, veteran, realErrors, WEBKIT } from './helpers/browser.js';

const BOTS = readFileSync(join(ROOT, 'tests', 'helpers', 'bots.browser.js'), 'utf8');
let srv, browser;
const pages = [];
before(async () => { srv = await startServer(); browser = await launch(); });
after(async () => { await browser?.close(); await srv?.stop(); });

async function player(nick, opts = {}) {
  const p = await openGame(browser, srv.url, { storage: veteran(nick), ...opts });
  await p.addScriptTag({ content: BOTS });
  pages.push(p);
  return p;
}
async function hostRoomAs(p, st) {
  await p.evaluate(s => { station = s; saveSet('ckf-station', s); buildMenus(); }, st);
  await p.click('#coopBtn'); await p.click('#hostBtn');
  await p.waitForFunction(() => NET.t && NET.t.up && NET.code);
  return p.evaluate(() => NET.code);
}
async function joinAs(p, code, st, host) {
  if (await p.isHidden('#coopView')) await p.click('#coopBtn');
  await p.fill('#roomIn', code); await p.click('#joinBtn');
  await p.waitForFunction(() => NET.meta);
  await p.click(`#coop [data-seat="${st}"]`);
  if (host) await host.waitForFunction(s => Object.values(NET.seats).some(x => x.station === s), st);
}
async function startShift(host, clients) {
  await host.click('#hostGo');
  await host.waitForFunction(() => G.coop && G.running);
  for (const c of clients) await c.waitForFunction(() => G && G.coop && G.running && G.roles[NET.myStation] === 'me', null, { timeout: 10000 });
  for (const p of [host, ...clients]) await p.evaluate(() => { CFG.gameSec = 1e6; });   // no shift end in the middle of a storm
}
async function openBar(bar, host) {
  await bar.evaluate(() => barKey('pot'));
  await bar.waitForFunction(() => G.pot.st === 'pull', null, { timeout: 15000 });   // the pot is the bar's own
  for (let i = 0; i < 12 && await host.evaluate(() => G.phase !== 'open'); i++) { await bar.evaluate(() => barKey('pot')); await sleep(200); }
  await host.waitForFunction(() => G.phase === 'open', null, { timeout: 5000 });
}
async function closeAll() { for (const p of pages.splice(0)) { try { await p.context().close(); } catch {} } }

/** In-page storm: `rate` taps a second. Half are the station bot's sensible moves (real buttons), half are a seeded
 *  random finger on anything visible for the station (buttons, the pixel canvases, keys). Never pause / quit. */
const storm = (p, rate, seed) => p.evaluate(([rate, seed]) => {
  let a = seed >>> 0;
  const rnd = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const SEL = '#sheet button, #board button, #pad button, #barPad button, #kitPad button, #kplate button, #krail button, #rail button, #queue button, #floor button, #cust button, #kpop button';
  const CANVAS = ['#ktv', '#bscene .txl', '#tscene .txl', '#fscene .txl'];
  const KEYS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '+', '=', 'Backspace', 'Enter', 'a'];
  const SKIP = /pause|quit|home|next|again|share|coop|resume|decor/i;
  window.__taps = 0;
  const tap = () => {
    if (!G || !G.running || G.paused) return;
    window.__taps++;
    try {
      const r = rnd();
      if (r < .5) { Bot.tick(); return; }
      if (r < .85) {
        const els = [...document.querySelectorAll(SEL)].filter(e => e.offsetParent !== null && !e.disabled && !SKIP.test(e.id));
        if (els.length) els[Math.floor(rnd() * els.length)].click();
      } else if (r < .95) {
        const cvs = CANVAS.map(s => document.querySelector(s)).filter(c => c && c.offsetParent !== null);
        if (cvs.length) { const c = cvs[Math.floor(rnd() * cvs.length)], b = c.getBoundingClientRect(); c.dispatchEvent(new PointerEvent('pointerdown', { clientX: b.left + rnd() * b.width, clientY: b.top + rnd() * b.height, bubbles: true, pointerType: 'touch' })); }
      } else dispatchEvent(new KeyboardEvent('keydown', { key: KEYS[Math.floor(rnd() * KEYS.length)], bubbles: true }));
    } catch (e) { (window.__stormErr = window.__stormErr || []).push(e.message); }
  };
  clearInterval(window.__storm); window.__storm = setInterval(tap, 1000 / rate);
}, [rate, seed]);
const calm = p => p.evaluate(() => clearInterval(window.__storm));

/**
 * What every screen must agree on once the shop is paused and the last keyframe is in: the shared shift. The
 * stations' own state (the tea pot, the stoves, the till's customer) is each phone's, so it is not compared.
 */
const shared = p => p.evaluate(() => JSON.stringify({
  revenue: G.revenue, tips: G.tips | 0, paid: G.paidCount, mistakes: G.mistakes, angry: G.angry, loss: G.loss,
  groups: G.groups.map(g => [g.id, g.state, g.taken ? 1 : 0]), payQ: G.payQ.map(c => c.expect), phase: G.phase,
}));

/** Pause the shop from the host, let every phone's results be acknowledged and the last keyframe arrive, and compare. */
async function assertConverged(host, clients) {
  await host.evaluate(() => setPause(true));
  for (const c of clients) await c.waitForFunction(() => unacked() === 0, null, { timeout: 15000 }).catch(() => {});
  await sleep(2500);   // a keyframe at least every 2 s
  const h = await shared(host);
  for (const c of clients) assert.equal(await shared(c), h, `${await c.evaluate(() => NET.myStation)} screen differs from the host`);
  await host.evaluate(() => setPause(false));
}

/**
 * The result audit. A tap changes the station on its own phone; what the station did (a
 * result) goes to the referee. On each teammate a sampler notes every result in its outbox (seq, kind, when first
 * seen) and when the referee's tick acknowledged it; on the host the referee reports each result it takes, by sender
 * and seq, applied or refused (test-surface onRefEvent). `auditStart` opens the window (and auditReset()); a phone's
 * window starts after the seq it had then, on both sides, so nothing on the way at that moment is miscounted.
 */
async function auditStart(ps) {
  await Promise.all(ps.map(auditOpen));
}
const auditOpen = p => p.evaluate(() => {
  auditReset();
  if (referee()) { window.__refSeen = []; onRefEvent(e => { if (e.ok !== null) window.__refSeen.push([e.player, e.seq, e.ok]); }); }
  const log = window.__audit = new Map(), from = window.__auditFrom = phone() ? phone().seq : 0;
  clearInterval(window.__auditT);
  window.__auditT = setInterval(() => {
    const P = phone(); if (!P) return;
    const now = performance.now();
    for (const o of [...P.outbox, ...P.waiting]) if (o.seq > from && o.e.b.k === 'res' && !log.has(o.seq)) log.set(o.seq, { at: now, ack: null, k: o.e.b.r.k });
    for (const [s, x] of log) if (x.ack === null && s <= P.acked) x.ack = now;
  }, 10);
});

/**
 * Every result each teammate sent in the window: taken by the referee (applied or refused) exactly once (a
 * resend the referee already had is a dup, never applied twice), acknowledged, with ack times.
 */
async function tapAudit(host, clients) {
  const seen = await host.evaluate(() => window.__refSeen || []);
  const ref = await host.evaluate(() => ({ ...referee().stats }));
  const phones = [];
  for (const c of clients) {
    const { id, st, from, sent, stats } = await c.evaluate(() => ({ id: NET.id, st: NET.myStation, from: window.__auditFrom, stats: { ...phone().stats }, sent: [...window.__audit.entries()].map(([seq, x]) => ({ seq, k: x.k, ms: x.ack === null ? null : x.ack - x.at })) }));
    const mine = new Map(); for (const [p, seq, ok] of seen) if (p === id && seq > from) mine.set(seq, [...(mine.get(seq) || []), ok]);
    const lost = sent.filter(s => !mine.has(s.seq)), twice = [...mine.values()].filter(v => v.length > 1).length;
    const refused = [...mine.values()].filter(v => v.includes(false)).length;
    const unacked = sent.filter(s => s.ms === null);
    const ms = sent.map(s => s.ms).filter(x => x !== null).sort((a, b) => a - b);
    const q = f => ms.length ? Math.round(ms[Math.min(ms.length - 1, Math.floor(f * ms.length))]) : null;
    phones.push({ st, sent: sent.length, kinds: [...new Set(sent.map(s => s.k))], lost: lost.length, lostKinds: [...new Set(lost.map(s => s.k))], twice, refused, unacked: unacked.length, unackedKinds: [...new Set(unacked.map(s => s.k))], resent: stats.resent, p50: q(.5), p95: q(.95), max: q(1) });
  }
  const sum = k => phones.reduce((n, a) => n + a[k], 0);
  return { phones, ref, sent: sum('sent'), lost: sum('lost'), twice: sum('twice') };
}

async function fourPlayers(lat) {
  const host = await player('老闆');
  const cl = [await player('甲', { latency: lat[0] }), await player('乙', { latency: lat[1] }), await player('丙', { latency: lat[2] })];
  const sts = ['bar', 'kitchen', 'till'];
  const code = await hostRoomAs(host, 'waiter');
  for (let i = 0; i < 3; i++) await joinAs(cl[i], code, sts[i], host);
  await startShift(host, cl);
  await openBar(cl[0], host);
  return { host, cl, code, sts };
}
async function finalChecks(host, all) {
  const v = await host.evaluate(() => Bot.check());
  assert.deepEqual(v, [], 'host game invariants');
  for (const p of all) assert.deepEqual(realErrors(p), []);
  for (const p of all) assert.deepEqual(await p.evaluate(() => window.__stormErr || []), [], 'a tap threw');
}

test('storm: 4 players tapping ~20/s each for 60 s at 80±40 ms lag: no tap lost or doubled, every screen agrees', { timeout: 240000 }, async () => {
  const L = { ms: 80, jitter: 40 };
  const { host, cl } = await fourPlayers([L, L, L]);
  await auditStart([host, ...cl]);
  await Promise.all([host, ...cl].map((p, i) => storm(p, 20, 101 + i)));
  for (let s = 0; s < 6; s++) { await sleep(10000); assert.equal(await host.evaluate(() => G.running), true); }
  await Promise.all([host, ...cl].map(calm));
  await sleep(2500);
  const audit = await tapAudit(host, cl);
  console.log('results per station:', JSON.stringify(audit));
  const taps = await Promise.all([host, ...cl].map(p => p.evaluate(() => window.__taps)));
  console.log('taps tried (host, bar, kitchen, till):', taps.join(', '));
  assert.equal(audit.lost, 0, `${audit.lost} of ${audit.sent} results never reached the referee`); assert.equal(audit.twice, 0, `${audit.twice} results taken twice`);
  for (const a of audit.phones) {
    assert.ok(a.sent > 0, `${a.st} really sent results: ${a.sent}`);
    assert.equal(a.unacked, 0, `${a.st}: results never acknowledged (${a.unackedKinds})`);
    assert.ok(a.p95 < 1000, `${a.st}: 95% of results confirmed within 1 s, got ${a.p95} ms`);
  }
  await assertConverged(host, cl);
  await finalChecks(host, [host, ...cl]);
  await closeAll();
});

test('storm with drops: phones lose the network for 1-4 s while still tapping; nothing tapped offline is lost', { timeout: 300000 }, async () => {
  const { host, cl, sts } = await fourPlayers([{ ms: 40, jitter: 30 }, { ms: 120, jitter: 80 }, { ms: 60, jitter: 20 }]);
  await auditStart([host, ...cl]);
  await Promise.all([host, ...cl].map((p, i) => storm(p, 15, 201 + i)));
  let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const log = [], end = Date.now() + 60000;
  while (Date.now() < end) {
    const i = Math.floor(rnd() * 3), off = 1000 + Math.round(rnd() * 3000);
    log.push(`${sts[i]} ${off}ms`);
    await cl[i].evaluate(() => __netDrop()); await sleep(off); await cl[i].evaluate(() => __netRestore());
    await sleep(1000 + rnd() * 3000);
  }
  console.log('drops:', log.join(' | '));
  await Promise.all([host, ...cl].map(calm));
  for (const c of cl) await c.waitForFunction(() => NET.t.up, null, { timeout: 15000 });
  await sleep(4000);
  const audit = await tapAudit(host, cl);
  console.log('results per station:', JSON.stringify(audit));
  assert.equal(audit.lost, 0, `${audit.lost} of ${audit.sent} results never reached the referee`); assert.equal(audit.twice, 0, `${audit.twice} results taken twice`);
  for (const a of audit.phones) assert.equal(a.unacked, 0, `${a.st}: results never acknowledged (${a.unackedKinds})`);
  assert.deepEqual(await host.evaluate(() => ({ ...G.roles })), { waiter: 'me', bar: 'remote', kitchen: 'remote', till: 'remote' }, 'nobody lost their station');
  await assertConverged(host, cl);
  await finalChecks(host, [host, ...cl]);
  await closeAll();
});

test('reload in the middle of a storm (bar): taps after the reload count straight away', { timeout: 180000 }, async () => {
  const { host, cl } = await fourPlayers([{ ms: 50, jitter: 20 }, { ms: 50, jitter: 20 }, { ms: 50, jitter: 20 }]);
  const bar = cl[0];
  await Promise.all([host, ...cl].map((p, i) => storm(p, 15, 301 + i)));
  await sleep(15000);   // plenty of taps before the reload
  await bar.reload();
  await bar.waitForFunction(() => typeof NET !== 'undefined' && NET.role === 'client' && G && G.coop && G.roles[NET.myStation] === 'me', null, { timeout: 15000 });
  await bar.addScriptTag({ content: BOTS });
  // the audit window opens after the reload, on every phone (a till or kitchen also reports on its own, e.g. the next
  // customer); the bar's lineDone results, counted at the station, all reach the referee
  await Promise.all([host, ...cl].map(calm)); await sleep(1000);
  await auditStart([host, ...cl]);
  await Promise.all([host, ...cl].map((p, i) => storm(p, 15, 399 + i)));
  await sleep(15000);
  await Promise.all([host, ...cl].map(calm));
  await sleep(2500);
  const audit = await tapAudit(host, cl), [a] = audit.phones;
  console.log('after the reload:', JSON.stringify(audit), JSON.stringify(await bar.evaluate(() => ({ taps: window.__taps, running: G.running, paused: G.paused, role: NET.role, st: NET.myStation, roles: G.roles }))));
  assert.ok(a.sent > 0 && a.kinds.includes('lineDone'), 'the bar made drinks after the reload: ' + JSON.stringify(a));
  assert.equal(audit.lost, 0, `${audit.lost} of ${audit.sent} results never reached the referee`); assert.equal(audit.twice, 0, `${audit.twice} results taken twice`);
  for (const p of audit.phones) assert.equal(p.unacked, 0, `${p.st}: results never acknowledged`);
  await assertConverged(host, cl);
  await finalChecks(host, [host, ...cl]);
  await closeAll();
});

test('slow host phone (CPU 6x slower): 4 players storming for 30 s still get every tap confirmed quickly', { timeout: 200000, skip: WEBKIT && 'CPU throttling needs Chromium DevTools' }, async () => {
  const L = { ms: 60, jitter: 30 };
  const { host, cl } = await fourPlayers([L, L, L]);
  const cdp = await host.context().newCDPSession(host);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });
  // the gap between the referee's ticks as they leave the host (TICK_MS 250), and the frame times
  await host.evaluate(() => {
    window.__tick = []; const T = NET.t, send = T.sendEnv.bind(T);
    T.sendEnv = e => { if (e && e.b && e.b.k === 'tick') window.__tick.push(performance.now()); send(e); };
    window.__frames = []; let last = performance.now();
    (function f(t) { window.__frames.push(t - last); last = t; requestAnimationFrame(f); })(last);
  });
  await auditStart([host, ...cl]);
  await host.evaluate(() => { window.__tick = []; });
  await Promise.all([host, ...cl].map((p, i) => storm(p, 20, 401 + i)));
  await sleep(30000);
  await Promise.all([host, ...cl].map(calm));
  await sleep(3000);
  const audit = await tapAudit(host, cl);
  const perf = await host.evaluate(() => {
    const q = (a, f) => { const s = [...a].sort((x, y) => x - y); return Math.round(s[Math.floor(f * (s.length - 1))] * 10) / 10; };
    const gaps = __tick.slice(1).map((t, i) => t - __tick[i]);
    return { ticks: __tick.length, gapP50: q(gaps, .5), gapP95: q(gaps, .95), gapMax: q(gaps, 1), frameP50: q(__frames.slice(5), .5), frameP95: q(__frames.slice(5), .95) };
  });
  console.log('slow host:', JSON.stringify(perf), 'results:', JSON.stringify(audit));
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  assert.equal(audit.lost, 0, `${audit.lost} of ${audit.sent} results never reached the referee`); assert.equal(audit.twice, 0, `${audit.twice} results taken twice`);
  for (const a of audit.phones) { assert.equal(a.unacked, 0); assert.ok(a.p95 < 1500, `${a.st}: p95 ${a.p95} ms`); }
  assert.ok(perf.gapP95 <= 400, 'the referee keeps the room fed on a slow phone: 95% of tick gaps within 400 ms, got ' + perf.gapP95 + ' ms');
  await assertConverged(host, cl);
  await finalChecks(host, [host, ...cl]);
  await closeAll();
});

// Results are never dropped (an older build kept a pending list capped at 200 that dropped further taps). A station's presses are its own now and
// never wait on the link; what does wait is its results. They are never dropped: 512 travel at once, the rest wait
// on the phone, and once the link is back the referee takes every one exactly once, in order.
test('teammate working while cut off: no result is dropped (outbox of 512, the rest waiting), all taken after the reconnect', { timeout: 90000 }, async () => {
  const host = await player('老闆'), kit = await player('阿強');
  const code = await hostRoomAs(host, 'waiter');
  await joinAs(kit, code, 'kitchen', host);
  await startShift(host, [kit]);
  await auditStart([host, kit]);
  await kit.evaluate(() => __netDrop());
  await kit.waitForFunction(() => NET.t && !NET.t.up);
  // presses on the station's own state still work while cut off
  await kit.evaluate(() => { for (let i = 0; i < 500; i++) pickPlate(i % 2); });
  assert.equal(await kit.evaluate(() => G.pi), 1, 'the last press is the kitchen\'s state, link or not');
  // 600 results (put-aways of a slip that does not exist: harmless, refused by the referee once each), beside whatever
  // the station itself queued meanwhile
  const u0 = await kit.evaluate(() => unacked());
  await kit.evaluate(() => { for (let i = 0; i < 600; i++) submit('kitchen', { k: 'slipClose', gid: 999999 }); });
  assert.deepEqual(await kit.evaluate(() => ({ outbox: phone().outbox.length, waiting: phone().waiting.length, unacked: unacked() })), { outbox: 512, waiting: u0 + 600 - 512, unacked: u0 + 600 });
  await kit.evaluate(() => __netRestore());
  await kit.waitForFunction(() => NET.t && NET.t.up, null, { timeout: 15000 });
  await kit.waitForFunction(() => unacked() === 0, null, { timeout: 20000 });
  await sleep(500);   // (the referee's tick with the last ack)
  const audit = await tapAudit(host, [kit]);
  assert.ok(audit.sent >= 600, 'every result left the phone: ' + audit.sent);
  assert.equal(audit.lost, 0, "the referee took each one: " + JSON.stringify(audit)); assert.equal(audit.twice, 0, "and none twice");
  await kit.evaluate(() => submit('kitchen', { k: 'slipClose', gid: 999999 }));
  assert.equal(await kit.evaluate(() => unacked()), 1, 'results are taken again');
  await kit.waitForFunction(() => unacked() === 0, null, { timeout: 5000 });
  assert.deepEqual(realErrors(host), []); assert.deepEqual(realErrors(kit), []);
  await closeAll();
});

// The room relays envelopes under load, counted by body kind (`b.k`): results one way, ticks the other.
test('room server under load: 7 teammates sending 20 results/s each for 20 s, the referee ticking 4/s to all 8', { timeout: 120000 }, async () => {
  const code = 'STR' + 'ABCDEFGHJKMNPQRSTUVWXYZ'[Math.floor(Math.random() * 23)];
  const host = roomSocket(srv.url, code, 'host0001', 'host'); await host.opened;
  host.send({ t: 'meta', meta: { state: 'lobby', host: 'h' } });
  const cls = [];
  for (let i = 0; i < 7; i++) { const c = roomSocket(srv.url, code, 'cl' + i + 'zzzz', 'client'); await c.opened; c.id = 'cl' + i + 'zzzz'; cls.push(c); }
  const on = (s, f) => s.ws.addEventListener('message', e => { if (e.data !== 'pong') f(JSON.parse(e.data)); });
  const recv = new Map(), lat = [], kinds = {};
  on(host, m => { if (m.t === 'env') { kinds[m.e.b.k] = (kinds[m.e.b.k] || 0) + 1; const arr = recv.get(m.e.from) || []; arr.push(m.e.seq); recv.set(m.e.from, arr); lat.push(Date.now() - m.e.at); } });
  let ticks = 0; for (const c of cls) on(c, m => { if (m.t === 'env' && m.e.b.k === 'tick') ticks++; });
  await sleep(300);
  let rseq = 0;
  const tickT = setInterval(() => host.send({ t: 'env', e: { p: 1, room: code, from: 'host0001', round: 1, seq: ++rseq, at: Date.now(), b: { k: 'tick', round: 1, t: rseq / 4, rt: rseq / 4, paused: false, scale: 1, acks: {}, pad: 'x'.repeat(400) } } }), 250);
  const end = Date.now() + 20000; let seq = 0;
  while (Date.now() < end) {
    seq++;
    for (const c of cls) c.send({ t: 'env', e: { p: 1, room: code, from: 'forged', round: 1, seq, at: Date.now(), b: { k: 'res', seat: 'till', epoch: 1, r: { k: 'tillMiss', cid: seq, loss: 0 } } } });
    await sleep(50);
  }
  clearInterval(tickT);
  await sleep(1500);
  for (const c of cls) { const got = recv.get(c.id) || []; assert.equal(got.length, seq, `${c.id}: ${got.length} of ${seq} results arrived (sender stamped by the room)`); assert.ok(got.every((s, i) => s === i + 1), `${c.id}: out of order`); }
  assert.equal(recv.has('forged'), false, 'the room stamps `from`; a phone cannot name another');
  lat.sort((a, b) => a - b);
  console.log(`room relay: ${seq * 7} results (${JSON.stringify(kinds)}), p50 ${lat[Math.floor(lat.length / 2)]} ms, p95 ${lat[Math.floor(lat.length * .95)]} ms, max ${lat[lat.length - 1]} ms; ticks delivered ${ticks} (expected ~${7 * 80})`);
  assert.deepEqual(Object.keys(kinds), ['res']);
  assert.ok(ticks >= 7 * 70, 'ticks reached all teammates');
  for (const s of [host, ...cls]) s.close();
});
