// Co-op room protocol tests: the Durable Object's lobby (seats, late join, reconnect, owner hand-over) and its referee.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, roomSocket, sleep } from './helpers/server.js';

let srv;
before(async () => { srv = await startServer(); });
after(async () => { await srv?.stop(); });

let n = 0;
const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const code = () => { n++; return A[n % 32] + A[(n * 7) % 32] + A[(n * 13) % 32] + 'Z'; };
const meta = (hostStation = 'waiter', state = 'lobby') => ({ host: 'h', hostName: '老闆', hostStation, slot: 'lunch', diff: 'rookie', state, level: 'estate', round: 0, at: Date.now() });

async function hostWithMeta(c, id = 'host0001', st = 'waiter') {
  const h = roomSocket(srv.url, c, id, 'host');
  await h.opened;
  await h.wait(m => m.t === 'hello');
  h.send({ t: 'meta', meta: meta(st) });
  await sleep(100);
  return h;
}

test('bad room code, bad id, bad role and plain http are refused', async () => {
  for (const q of ['/api/room/ab1?id=abcd1234&role=host', '/api/room/ABCD?id=X&role=host', '/api/room/ABCD?id=abcd1234&role=admin']) {
    assert.equal((await fetch(srv.url + q)).status, 400, q);
  }
  assert.equal((await fetch(srv.url + '/api/room/ABCD?id=abcd1234&role=host')).status, 426);
});

test('client joining a room nobody opened is told no_room', async () => {
  const c = roomSocket(srv.url, code(), 'cli00001', 'client');
  await c.opened;
  await c.wait(m => m.t === 'error' && m.error === 'no_room');
  c.close();
});

test('lobby: late joiner gets meta and seats at once; seats broadcast; seat clash refused', async () => {
  const c0 = code();
  const h = await hostWithMeta(c0);
  const a = roomSocket(srv.url, c0, 'cliaaaa1', 'client');
  const hello = await a.wait(m => m.t === 'hello');
  assert.equal(hello.you, 'client');
  assert.equal(hello.meta.hostStation, 'waiter');
  a.send({ t: 'seat', seat: { name: '阿明', station: 'bar' } });
  const s1 = await h.wait(m => m.t === 'seats' && m.seats.cliaaaa1);
  assert.equal(s1.seats.cliaaaa1.station, 'bar');
  assert.equal(s1.seats.cliaaaa1.name, '阿明');

  const b = roomSocket(srv.url, c0, 'clibbbb1', 'client');
  const hb = await b.wait(m => m.t === 'hello');
  assert.equal(hb.seats.cliaaaa1.station, 'bar', 'late joiner sees existing seats');
  b.send({ t: 'seat', seat: { name: '阿強', station: 'bar' } });
  await b.wait(m => m.t === 'error' && m.error === 'seat_taken');
  b.send({ t: 'seat', seat: { name: '阿強', station: 'waiter' } });
  await b.wait(m => m.t === 'error' && m.error === 'seat_taken' && m.station === 'waiter', 3000);
  b.send({ t: 'seat', seat: { name: '阿強', station: 'till' } });
  await h.wait(m => m.t === 'seats' && m.seats.clibbbb1 && m.seats.clibbbb1.station === 'till');
  [h, a, b].forEach(s => s.close());
});


test('client drop: seat kept through the grace period and resumed on reconnect', async () => {
  const c0 = code();
  const h = await hostWithMeta(c0);
  let a = roomSocket(srv.url, c0, 'cliaaaa3', 'client');
  await a.wait(m => m.t === 'hello');
  a.send({ t: 'seat', seat: { name: '阿明', station: 'kitchen' } });
  await h.wait(m => m.t === 'seats' && m.seats.cliaaaa3);
  a.close();
  await sleep(2000);
  a = roomSocket(srv.url, c0, 'cliaaaa3', 'client');
  const hello = await a.wait(m => m.t === 'hello');
  assert.equal(hello.seats.cliaaaa3.station, 'kitchen', 'seat survives a short drop');
  await sleep(15000);
  assert.ok(!h.msgs.some(m => m.t === 'seats' && !m.seats.cliaaaa3), 'reconnected client keeps its seat past the grace time');
  [h, a].forEach(s => s.close());
});

test('client gone for good: seat freed after ~15 s', { timeout: 40000 }, async () => {
  const c0 = code();
  const h = await hostWithMeta(c0);
  const a = roomSocket(srv.url, c0, 'cliaaaa4', 'client');
  await a.wait(m => m.t === 'hello');
  a.send({ t: 'seat', seat: { name: '阿明', station: 'till' } });
  await h.wait(m => m.t === 'seats' && m.seats.cliaaaa4);
  const t0 = Date.now();
  a.close();
  await h.wait(m => m.t === 'seats' && !m.seats.cliaaaa4, 25000);
  const took = Date.now() - t0;
  assert.ok(took >= 14000 && took < 22000, 'freed after the grace period, took ' + took);
  h.close();
});

test('host drop and return within grace: stays host, nobody promoted', async () => {
  const c0 = code();
  let h = await hostWithMeta(c0, 'hostbbb1');
  const a = roomSocket(srv.url, c0, 'cliaaaa5', 'client');
  await a.wait(m => m.t === 'hello');
  a.send({ t: 'seat', seat: { name: '阿明', station: 'bar' } });
  await h.wait(m => m.t === 'seats' && m.seats.cliaaaa5);
  h.close();
  await sleep(2500);
  h = roomSocket(srv.url, c0, 'hostbbb1', 'host');
  const hello = await h.wait(m => m.t === 'hello');
  assert.equal(hello.you, 'host');
  assert.equal(hello.seats.cliaaaa5.station, 'bar', 'room state survived');
  await sleep(6000);
  assert.ok(!a.msgs.some(m => m.t === 'promote'));
  [h, a].forEach(s => s.close());
});

test('host gone: longest-seated connected client is promoted and others told', { timeout: 30000 }, async () => {
  const c0 = code();
  const h = await hostWithMeta(c0, 'hostccc1');
  const a = roomSocket(srv.url, c0, 'cliaaaa6', 'client');
  await a.wait(m => m.t === 'hello');
  a.send({ t: 'seat', seat: { name: '先到', station: 'bar' } });
  await h.wait(m => m.t === 'seats' && m.seats.cliaaaa6);
  await sleep(50);
  const b = roomSocket(srv.url, c0, 'clibbbb6', 'client');
  await b.wait(m => m.t === 'hello');
  b.send({ t: 'seat', seat: { name: '後到', station: 'till' } });
  await h.wait(m => m.t === 'seats' && m.seats.clibbbb6);
  h.close();
  const pr = await a.wait(m => m.t === 'promote', 12000);
  assert.equal(pr.station, 'bar');
  assert.ok(!pr.seats.cliaaaa6, 'new host leaves its seat (it is the host now)');
  const hm = await b.wait(m => m.t === 'host' && m.id === 'cliaaaa6', 3000);
  assert.ok(hm);
  // (the referee is the room's, not the host's: see below)
  // The old host coming back cannot take the room over.
  const old = roomSocket(srv.url, c0, 'hostccc1', 'host');
  await old.wait(m => m.t === 'error' && m.error === 'taken');
  [a, b, old].forEach(s => s.close());
});

// Lobby duty goes to a seated player only, never to a phone without a seat or a viewer (TV).
test('host gone with nobody seated: no owner while a player is here; the first to sit becomes the owner', { timeout: 30000 }, async () => {
  const c0 = code();
  const h = await hostWithMeta(c0, 'hostddd1');
  const watcher = roomSocket(srv.url, c0, 'watch001', 'client'), tv = roomSocket(srv.url, c0, 'tvddd001', 'viewer');
  await watcher.wait(m => m.t === 'hello'); await tv.wait(m => m.t === 'hello');
  h.close();
  await sleep(9000);   // past the owner's grace (6 s) and an alarm or two
  assert.ok(!watcher.msgs.some(m => m.t === 'promote' || m.t === 'closed'), 'a seatless phone is not made owner, the room stays');
  assert.ok(!tv.msgs.some(m => m.t === 'promote' || m.t === 'closed'), 'a viewer is never owner');
  watcher.send({ t: 'seat', seat: { name: '阿明', station: 'bar' } });
  const pr = await watcher.wait(m => m.t === 'promote', 5000);
  assert.equal(pr.station, 'bar');
  await tv.wait(m => m.t === 'host' && m.id === 'watch001', 3000);
  [watcher, tv].forEach(s => s.close());
});

test('only a viewer left: the room closes (a TV keeps no room open)', { timeout: 20000 }, async () => {
  const c0 = code();
  const h = await hostWithMeta(c0, 'hostddd2');
  const tv = roomSocket(srv.url, c0, 'tvddd002', 'viewer');
  await tv.wait(m => m.t === 'hello');
  h.close();
  await tv.wait(m => m.t === 'closed', 15000);
  assert.ok(!tv.msgs.some(m => m.t === 'promote'));
  tv.close();
});

// The host compresses snapshots only if every seated phone says it can unpack them (old pages send no flag).
test('seat carries whether the phone can unpack compressed snapshots', async () => {
  const c0 = code();
  const h = await hostWithMeta(c0, 'hostzzz1');
  const a = roomSocket(srv.url, c0, 'cliz0001', 'client'), b = roomSocket(srv.url, c0, 'cliz0002', 'client');
  await a.wait(m => m.t === 'hello'); await b.wait(m => m.t === 'hello');
  a.send({ t: 'seat', seat: { name: '新機', station: 'bar', z: true } });
  b.send({ t: 'seat', seat: { name: '舊機', station: 'till' } });
  const s = await h.wait(m => m.t === 'seats' && m.seats.cliz0001 && m.seats.cliz0002);
  assert.equal(s.seats.cliz0001.z, true);
  assert.equal(s.seats.cliz0002.z, false);
  [h, a, b].forEach(x => x.close());
});

// (A phone that connects gets the state at once, the referee's last keyframe: tested below.)

// A phone that goes silent without closing its socket (lift, iOS suspending Safari) must be noticed by the room.
test('host silent with its socket left open: room promotes a teammate', { timeout: 60000 }, async () => {
  const c0 = code();
  const h = await hostWithMeta(c0, 'hostsil1');
  const a = roomSocket(srv.url, c0, 'clisil01', 'client');
  await a.wait(m => m.t === 'hello');
  a.send({ t: 'seat', seat: { name: '阿明', station: 'bar' } });
  await h.wait(m => m.t === 'seats' && m.seats.clisil01);
  const t0 = Date.now();
  h.goSilent();
  const pr = await a.wait(m => m.t === 'promote', 40000);
  console.log(`silent host: promoted after ${Date.now() - t0} ms`);
  assert.equal(pr.station, 'bar');
  [h, a].forEach(s => s.close());
});

test('seated client silent with its socket left open: seat freed for the computer', { timeout: 60000 }, async () => {
  const c0 = code();
  const h = await hostWithMeta(c0, 'hostsil2');
  const a = roomSocket(srv.url, c0, 'clisil02', 'client');
  await a.wait(m => m.t === 'hello');
  a.send({ t: 'seat', seat: { name: '阿明', station: 'till' } });
  await h.wait(m => m.t === 'seats' && m.seats.clisil02);
  const t0 = Date.now();
  a.goSilent();
  await h.wait(m => m.t === 'seats' && !m.seats.clisil02, 45000);
  console.log(`silent client: seat freed after ${Date.now() - t0} ms`);
  [h, a].forEach(s => s.close());
});

test('host closes the room on purpose: everyone told, state wiped, code reusable', async () => {
  const c0 = code();
  const h = await hostWithMeta(c0, 'hosteee1');
  const a = roomSocket(srv.url, c0, 'cliaaaa7', 'client');
  await a.wait(m => m.t === 'hello');
  a.send({ t: 'seat', seat: { name: '阿明', station: 'bar' } });
  await h.wait(m => m.t === 'seats' && m.seats.cliaaaa7);
  h.send({ t: 'close' });
  await a.wait(m => m.t === 'closed');
  await sleep(300);
  const h2 = roomSocket(srv.url, c0, 'hostfff1', 'host');
  const hello = await h2.wait(m => m.t === 'hello');
  assert.equal(hello.you, 'host');
  assert.equal(hello.meta, null);
  assert.deepEqual(hello.seats, {});
  h2.close();
});

test('second host on a live room code is told taken', async () => {
  const c0 = code();
  const h = await hostWithMeta(c0, 'hostggg1');
  const h2 = roomSocket(srv.url, c0, 'hostggg2', 'host');
  await h2.wait(m => m.t === 'error' && m.error === 'taken');
  h.close();
});

test('room holds at most 8 sockets', async () => {
  const c0 = code();
  const h = await hostWithMeta(c0, 'hosthhh1');
  const socks = [];
  for (let i = 0; i < 7; i++) { const s = roomSocket(srv.url, c0, 'full000' + i, 'client'); await s.wait(m => m.t === 'hello'); socks.push(s); }
  // The 9th socket is refused at the handshake (HTTP 429): it never opens and never gets a hello.
  const ninth = roomSocket(srv.url, c0, 'full0009', 'client');
  const opened = await Promise.race([ninth.opened.then(() => true, () => false), sleep(3000).then(() => 'timeout')]);
  assert.equal(opened, false, 'ninth socket must not open');
  assert.ok(!ninth.msgs.some(m => m.t === 'hello'));
  [h, ...socks].forEach(s => s.close());
});

test('oversize client message is ignored, ping is answered', async () => {
  const c0 = code();
  const h = await hostWithMeta(c0, 'hostiii1');
  const a = roomSocket(srv.url, c0, 'cliaaaa8', 'client');
  await a.wait(m => m.t === 'hello');
  a.send({ t: 'env', e: { p: 1, room: c0, from: 'x', round: 1, seq: 1, at: 0, b: { k: 'status', pad: 'x'.repeat(20000) } } });
  await sleep(300);
  assert.ok(!h.msgs.some(m => m.t === 'env'));
  const pong = new Promise(res => a.ws.addEventListener('message', e => { if (e.data === 'pong') res(); }));
  a.ws.send('ping');
  await pong;
  [h, a].forEach(s => s.close());
});

// Envelopes and the viewer role: the room runs the referee itself (worker/room-core.js), every phone's envelopes go to
// it and its own go to every phone (or one). There is no referee phone to relay to.
const BUILD = '2026.11.10-c';   // core/proto/messages.ts BUILD (the referee checks PROTO only)
const env = (c, b, extra = {}) => ({ t: 'env', e: { p: 1, room: c, from: 'x', round: 1, seq: 0, at: 0, b, ...extra } });
const hello = (c, id, role = 'player') => env(c, { k: 'hello', proto: 1, build: BUILD, caps: { z: false, cs: true, ptt: false }, role, name: id.slice(0, 6), player: id, resume: null });
/** The owner starts a free-play shift in the room (no level), with the lobby's seats. */
async function startShift(h, extra = []) {
  h.send({ t: 'start', level: '', lv: null, slot: 'lunch', diff: 'pro', extra, port: { rank: 2, rlv: {}, names: {} } });
  return h.wait(m => m.t === 'meta' && m.meta.state === 'playing', 3000);
}
const dbg = async (s, d) => { const id = Math.floor(Math.random() * 1e9); s.send({ t: 'dbg', id, d }); return (await s.wait(m => m.t === 'dbg' && m.id === id, 3000)).res; };

test('the owner starts the shift; the room referees it (ticks with nobody sending, welcome to the phone that says hello)', async () => {
  const c0 = code();
  const h = await hostWithMeta(c0, 'hostref1');
  const a = roomSocket(srv.url, c0, 'clirefa1', 'client');
  await a.wait(m => m.t === 'hello');
  a.send({ t: 'seat', seat: { name: '阿明', station: 'bar' } });
  await h.wait(m => m.t === 'seats' && m.seats.clirefa1);
  const st = await startShift(h);
  assert.equal(st.meta.round, 1, 'the room counts the rounds');
  await a.wait(m => m.t === 'meta' && m.meta.state === 'playing');
  // the room's clock: ticks four times a second although no phone has sent anything yet
  await sleep(1100);
  const ticks = a.msgs.filter(m => m.t === 'env' && m.e.b.k === 'tick');
  assert.ok(ticks.length >= 3, 'ticks from the room: ' + ticks.length);
  assert.equal(ticks[0].e.from, 'ref');
  a.send(hello(c0, 'clirefa1'));
  const w = await a.wait(m => m.t === 'env' && m.e.b.k === 'welcome' && m.e.to === 'clirefa1');
  assert.equal(w.e.b.key.seats.bar.driver.player, 'clirefa1', 'the lobby seat is this phone\'s');
  // the owner's seat (meta hostStation: waiter) is the owner's, on the room's referee
  assert.equal(w.e.b.key.seats.waiter.driver.player, 'hostref1');
  // a new phone connecting mid-shift gets the referee's last keyframe at once
  await sleep(2200);
  const late = roomSocket(srv.url, c0, 'clirefb1', 'client');
  await late.wait(m => m.t === 'hello');
  const k = await late.wait(m => m.t === 'env', 3000);
  assert.equal(k.e.b.k, 'keyframe', 'the last keyframe first, not a tick');
  [h, a, late].forEach(s => s.close());
});

test('a phone cannot speak for the referee or for another phone; only the owner starts a shift', async () => {
  const c0 = code();
  const h = await hostWithMeta(c0, 'hostref2');
  const a = roomSocket(srv.url, c0, 'clirefa2', 'client'), b = roomSocket(srv.url, c0, 'clirefb2', 'client');
  await a.wait(m => m.t === 'hello'); await b.wait(m => m.t === 'hello');
  a.send({ t: 'start', level: '', lv: null, slot: 'lunch', diff: 'pro', extra: [], port: { rank: 2, rlv: {}, names: {} } });
  await sleep(400);
  assert.ok(!b.msgs.some(m => m.t === 'meta' && m.meta.state === 'playing'), 'a teammate\'s start is ignored');
  await startShift(h);
  // a phone's referee-shaped envelope (even a tick) reaches no phone; the old snap/act messages are not relayed
  a.send(env(c0, { k: 'tick', v: 'evil' }, { from: 'ref' }));
  a.send({ t: 'snap', v: 'evil' }); a.send({ t: 'act', a: { seq: 1 } });
  a.send({ t: 'meta', meta: { state: 'closed' } });
  // a phone pretending to be another: the room stamps the real sender, so the referee answers the real one
  a.send(hello(c0, 'clirefb2'));
  await a.wait(m => m.t === 'env' && m.e.b.k === 'welcome' && m.e.to === 'clirefa2');
  await sleep(300);
  assert.ok(![...b.msgs, ...h.msgs].some(m => m.v === 'evil' || m.t === 'act' || m.t === 'snap' || (m.t === 'env' && m.e.b.v === 'evil')), 'nothing a phone sends reaches another phone');
  assert.ok(!b.msgs.some(m => m.t === 'env' && m.e.to === 'clirefb2'), 'no welcome for the phone that was impersonated');
  assert.ok(!b.msgs.some(m => m.t === 'meta' && m.meta.state === 'closed'));
  const s = await dbg(h, { op: 'state' });
  assert.ok(s.players.includes('clirefa2') && !s.players.includes('clirefb2'), 'the referee knows the real sender only: ' + JSON.stringify(s.players));
  [h, a, b].forEach(x => x.close());
});

test('the shift goes on when the owner leaves: a teammate keeps playing and is promoted, the computer covers the owner\'s seat (link rule, 15 s)', { timeout: 60000 }, async () => {
  const c0 = code();
  const h = await hostWithMeta(c0, 'hostref3');
  const a = roomSocket(srv.url, c0, 'clirefa3', 'client');
  await a.wait(m => m.t === 'hello');
  a.send({ t: 'seat', seat: { name: '阿明', station: 'bar' } });
  await h.wait(m => m.t === 'seats' && m.seats.clirefa3);
  await startShift(h);
  a.send(hello(c0, 'clirefa3'));
  await a.wait(m => m.t === 'env' && m.e.b.k === 'welcome');
  // the teammate's phone keeps talking to the referee (a real phone sends its status every second); the owner never did
  const alive = setInterval(() => a.send(env(c0, { k: 'status', seats: { bar: { inputs: 1, waiting: 0, load: 0 } } })), 2000);
  h.close();
  const pr = await a.wait(m => m.t === 'promote', 15000);
  assert.equal(pr.station, 'bar');
  // the referee did not stop or restart: the ticks still come and the round is the same
  const before = a.msgs.filter(m => m.t === 'env' && m.e.b.k === 'tick').length;
  await sleep(1100);
  const ticks = a.msgs.filter(m => m.t === 'env' && m.e.b.k === 'tick');
  assert.ok(ticks.length >= before + 3, 'ticks go on after the owner left');
  assert.equal(ticks[ticks.length - 1].e.round, 1);
  let s = await dbg(a, { op: 'state' });
  for (let i = 0; i < 40 && s.seats.waiter.driver.type !== 'computer'; i++) { await sleep(500); s = await dbg(a, { op: 'state' }); }
  clearInterval(alive);
  assert.equal(s.seats.waiter.driver.type, 'computer', 'the owner\'s seat went to the computer (link lost)');
  assert.equal(s.seats.waiter.coverReason, 'link');
  assert.equal(s.seats.bar.driver.player, 'clirefa3', 'the teammate keeps the bar');
  // the old owner coming back cannot take the room over
  const old = roomSocket(srv.url, c0, 'hostref3', 'host');
  await old.wait(m => m.t === 'error' && m.error === 'taken');
  [a, old].forEach(x => x.close());
});

test('env: an oversize phone envelope (> 16 KB) is refused; a burst of 300 is applied complete and in order', async () => {
  const c0 = code();
  const h = await hostWithMeta(c0, 'hostenv3');
  const a = roomSocket(srv.url, c0, 'clienva3', 'client');
  await a.wait(m => m.t === 'hello');
  a.send({ t: 'seat', seat: { name: '阿明', station: 'bar' } });
  await h.wait(m => m.t === 'seats' && m.seats.clienva3);
  await startShift(h);
  a.send(hello(c0, 'clienva3'));
  await a.wait(m => m.t === 'env' && m.e.b.k === 'welcome');
  await dbg(h, { op: 'pause', on: true });   // the bar's results are judged later; here only their order and count matter
  const res = seq => env(c0, { k: 'res', seat: 'bar', epoch: 1, r: { k: 'pot', level: 0, st: 'empty', until: 0, pulls: 0 } }, { round: 1, seq });
  a.send({ ...res(1), e: { ...res(1).e, pad: 'x'.repeat(17000) } });
  for (let i = 1; i <= 300; i++) a.send(res(i));
  await dbg(h, { op: 'pause', on: false });
  // every result arrived, in order: the referee acknowledged all 300 (a gap would hold the acks back)
  const ack = await a.wait(m => m.t === 'env' && m.e.b.k === 'tick' && m.e.b.acks.clienva3 === 300, 10000);
  assert.ok(ack);
  const s = await dbg(h, { op: 'state' });
  assert.equal(s.stats.applied + s.stats.nacked, 300, 'all 300 judged once: ' + JSON.stringify(s.stats));
  [h, a].forEach(x => x.close());
});

test('env: a phone\'s round trip to the room\'s referee stays small (median < 30 ms over 50)', async () => {
  const c0 = code();
  const h = await hostWithMeta(c0, 'hostenv4');
  await startShift(h);
  const a = roomSocket(srv.url, c0, 'clienva4', 'client');
  await a.wait(m => m.t === 'hello');
  const times = [];
  for (let i = 1; i <= 50; i++) {
    const t0 = performance.now(), id = i;
    a.send({ t: 'dbg', id, d: { op: 'pause', on: false } });
    await a.wait(m => m.t === 'dbg' && m.id === id);
    times.push(performance.now() - t0);
  }
  times.sort((x, y) => x - y);
  assert.ok(times[25] < 30, 'median ' + times[25]);
  [h, a].forEach(x => x.close());
});

test('viewers: two TVs watch beside 8 players, a third is refused; a viewer gets the referee\'s envelopes but cannot sit, talk or act', async () => {
  const c0 = code();
  const h = await hostWithMeta(c0, 'hostview');
  const socks = [];
  for (let i = 0; i < 7; i++) { const s = roomSocket(srv.url, c0, 'plyr000' + i, 'client'); await s.wait(m => m.t === 'hello'); socks.push(s); }
  const tv1 = roomSocket(srv.url, c0, 'tvview01', 'viewer'), tv2 = roomSocket(srv.url, c0, 'tvview02', 'viewer');
  assert.equal((await tv1.wait(m => m.t === 'hello')).you, 'viewer');
  await tv2.wait(m => m.t === 'hello');
  const tv3 = roomSocket(srv.url, c0, 'tvview03', 'viewer');
  assert.equal(await Promise.race([tv3.opened.then(() => true, () => false), sleep(3000).then(() => 'timeout')]), false, 'a third viewer is refused');
  // the ninth player is still refused with two viewers in the room
  const ninth = roomSocket(srv.url, c0, 'plyr0009', 'client');
  assert.equal(await Promise.race([ninth.opened.then(() => true, () => false), sleep(3000).then(() => 'timeout')]), false);
  await startShift(h);
  await tv1.wait(m => m.t === 'env' && m.e.b.k === 'tick');
  tv1.send(hello(c0, 'tvview01', 'viewer'));
  await tv1.wait(m => m.t === 'env' && m.e.b.k === 'welcome' && m.e.to === 'tvview01');
  tv1.send({ t: 'seat', seat: { name: 'TV', station: 'bar' } });
  tv1.send({ t: 'act', a: { seq: 1 } });
  tv1.send({ t: 'floorReq', name: 'TV' });
  tv1.send({ t: 'start', level: '', lv: null, slot: 'lunch', diff: 'pro', extra: [], port: { rank: 2, rlv: {}, names: {} } });
  await sleep(300);
  assert.ok(!h.msgs.some(m => m.t === 'act' || (m.t === 'seats' && m.seats.tvview01)), 'a viewer never sits or taps');
  assert.ok(!h.msgs.some(m => m.t === 'floor' && m.holder === 'tvview01'), 'a viewer never holds the floor');
  assert.ok(!h.msgs.some(m => m.t === 'meta' && m.meta.round === 2), 'a viewer never starts a shift');
  [h, ...socks, tv1, tv2].forEach(s => s.close());
});

test('once the books close the room says lobby again; a late joiner is not told a shift is running', { timeout: 30000 }, async () => {
  const c0 = code();
  const h = await hostWithMeta(c0, 'hostlob1');
  await startShift(h);
  await dbg(h, { op: 'ff', sec: 2000 });
  const m = await h.wait(x => x.t === 'meta' && x.meta.state === 'lobby', 10000);
  assert.equal(m.meta.round, 1, 'the round count stays');
  const late = roomSocket(srv.url, c0, 'clilob01', 'client');
  const hi = await late.wait(x => x.t === 'hello');
  assert.equal(hi.meta.state, 'lobby');
  [h, late].forEach(s => s.close());
});

test('a party night over the room: open, join, seats, vote, ready, countdown, the round\'s shift, its end card', { timeout: 60000 }, async () => {
  const c0 = code();
  const h = await hostWithMeta(c0, 'hostpty1');
  const a = roomSocket(srv.url, c0, 'clipty01', 'client');
  await a.wait(m => m.t === 'hello');
  a.send({ t: 'partyOpen', name: 'x' });   // only the owner opens a night
  h.send({ t: 'partyOpen', name: '老闆' });
  const n0 = await a.wait(m => m.t === 'party' && m.night, 3000);
  assert.equal(n0.night.host, 'hostpty1');
  assert.equal(n0.night.players.length, 1, 'the client\'s open was ignored, the owner\'s opened it');
  await a.wait(m => m.t === 'meta' && m.meta.party === true, 3000);
  const night = s => [...s.msgs].reverse().find(m => m.t === 'party' && m.night)?.night;
  const phase = (s, ph, ms = 10000) => s.wait(m => m.t === 'party' && m.night && m.night.phase === ph, ms);
  a.send({ t: 'party', ev: { k: 'join', name: '阿明', player: 'hostpty1' } });   // `player` is the room's to stamp
  await a.wait(m => m.t === 'party' && m.night?.players.some(p => p.id === 'clipty01'), 3000);
  a.send({ t: 'party', ev: { k: 'seat', seat: 'till' } });
  h.send({ t: 'party', ev: { k: 'seat', seat: 'waiter' } });
  a.send({ t: 'party', ev: { k: 'start' } });   // not the host: refused to the sender only
  const no = await a.wait(m => m.t === 'party' && m.why, 3000);
  assert.ok(no.why);
  assert.ok(!h.msgs.some(m => m.t === 'party' && m.why), 'a refusal goes to the presser only');
  h.send({ t: 'party', ev: { k: 'start' } });
  await phase(a, 'vote');
  h.send({ t: 'party', ev: { k: 'vote', card: 0 } }); a.send({ t: 'party', ev: { k: 'vote', card: 0 } });
  await phase(a, 'ready', 10000);   // the room's clock ran the change window
  h.send({ t: 'party', ev: { k: 'ready', on: true } }); a.send({ t: 'party', ev: { k: 'ready', on: true } });
  h.send({ t: 'party', ev: { k: 'start' } });
  await phase(a, 'countdown');
  await phase(a, 'round', 10000);
  const mp = await a.wait(m => m.t === 'meta' && m.meta.state === 'playing' && m.meta.round === 1, 3000);
  assert.equal(mp.meta.party, true);
  a.send(hello(c0, 'clipty01'));
  const w = await a.wait(m => m.t === 'env' && m.e.b.k === 'welcome' && m.e.to === 'clipty01', 3000);
  assert.equal(w.e.b.key.seats.till.driver.player, 'clipty01', 'the night\'s seat is this phone\'s on the referee');
  assert.equal(w.e.b.key.seats.waiter.driver.player, 'hostpty1');
  assert.ok(w.e.b.key.shared.party, 'the keyframe carries the party round (its pace)');
  // mid-round: the client stands up, the room hands its seat to the computer
  const k0 = a.msgs.length;
  a.send({ t: 'party', ev: { k: 'watch' } });
  await a.wait(m => a.msgs.indexOf(m) >= k0 && m.t === 'party' && (m.why || m.night?.seats.till === null), 3000);
  assert.equal(night(a).seats.till, null, JSON.stringify(a.msgs.slice(k0).filter(m => m.t === 'party')));
  const st = await dbg(h, { op: 'state' });
  assert.equal(st.seats.till.driver.type, 'computer');
  await dbg(h, { op: 'ff', sec: 2000 });
  await phase(a, 'endcard', 10000);
  await a.wait(m => m.t === 'meta' && m.meta.state === 'lobby', 3000);
  assert.equal(night(a).history.length, 1, 'the round\'s report reached the night');
  // a late joiner gets the night at once
  const late = roomSocket(srv.url, c0, 'clipty02', 'client');
  await late.wait(m => m.t === 'hello');
  assert.equal((await late.wait(m => m.t === 'party' && m.night, 3000)).night.phase, 'endcard');
  // the owner closes the night only in its lobby or after 散水
  h.send({ t: 'partyClose' });
  await sleep(300);
  assert.ok(night(a), 'not mid-night');
  [h, a, late].forEach(s => s.close());
});
