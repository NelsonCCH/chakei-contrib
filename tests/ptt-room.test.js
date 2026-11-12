// Push-to-talk floor in the room Durable Object, over raw sockets:
// grant / busy / release with two and four players, the keep-alive, the 12 s limit, the holder leaving, dropping or
// going silent mid-turn, press spam, and the audio relay (holder only, its turn only, size and rate budget, mute).
// Invariant after every scenario: the floor ends free (a fresh phone joining is told nobody holds it).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, roomSocket, sleep } from './helpers/server.js';

const FLOOR_MAX_MS = 12000, FLOOR_SILENT_MS = 2500;
let srv;
before(async () => { srv = await startServer(); });
after(async () => { await srv?.stop(); });

let n = 0;
const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const code = () => { n++; return 'P' + A[n % 32] + A[(n * 7) % 32] + A[(n * 11) % 32]; };
const meta = () => ({ host: 'h', hostName: '老闆', hostStation: 'waiter', slot: 'lunch', diff: 'rookie', state: 'playing', level: 'estate', round: 1, at: Date.now() });

/** A room with a host and `k` seated clients; returns the sockets, host first. */
async function room(k) {
  const c = code();
  const h = roomSocket(srv.url, c, 'host' + c.toLowerCase(), 'host');
  await h.wait(m => m.t === 'hello');
  h.send({ t: 'meta', meta: meta() });
  await sleep(50);
  const st = ['bar', 'kitchen', 'till'];
  const all = [h];
  for (let i = 0; i < k; i++) {
    const s = roomSocket(srv.url, c, `cli${i}${c.toLowerCase()}`, 'client');
    await s.wait(m => m.t === 'hello');
    s.send({ t: 'seat', seat: { name: '阿' + i, station: st[i] } });
    all.push(s);
  }
  await h.wait(m => m.t === 'seats' && Object.keys(m.seats).length === k);
  return { c, all };
}
/** The holder's id in the last floor message a socket got. */
const lastFloor = s => [...s.msgs].reverse().find(m => m.t === 'floor');
/** Waits for a floor message after `from` messages that matches pred. */
const floorAfter = (s, from, pred, ms = 5000) => s.wait(m => s.msgs.indexOf(m) >= from && m.t === 'floor' && pred(m), ms);

let probes = 0;
/** The invariant: a phone joining now is told the floor is free, within `ms` (polls; each probe is a fresh player). */
async function endsFree(c, ms = 2000) {
  const t0 = Date.now();
  for (;;) {
    const p = roomSocket(srv.url, c, 'probe' + (++probes), 'client');
    const hello = await p.wait(m => m.t === 'hello');
    p.close();
    if (hello.floor === null) return Date.now() - t0;
    if (Date.now() - t0 > ms) assert.fail(`floor still held after ${ms} ms: ${JSON.stringify(hello.floor)}`);
    await sleep(300);
  }
}
const closeAll = socks => socks.forEach(s => s.close());

/** An audio frame as src/ptt/codec.ts writes it: magic, turn (u32 LE), frame number (u16 LE), mu-law samples. */
function frame(turn, seq, samples = 640) {
  const b = new Uint8Array(7 + samples), v = new DataView(b.buffer);
  b[0] = 0xa1; v.setUint32(1, turn, true); v.setUint16(5, seq, true);
  for (let i = 7; i < b.length; i++) b[i] = (i * 37) & 0xff;
  return b;
}

test('two players: grant to everyone, busy answer names the talker, release frees, then the other can talk', async () => {
  const { c, all: [h, a] } = await room(1);
  h.send({ t: 'floorReq', name: '老闆' });
  const g = await a.wait(m => m.t === 'floor' && m.holder);
  assert.equal(g.holder, 'host' + c.toLowerCase());
  assert.equal(g.name, '老闆');
  assert.ok(g.left > FLOOR_MAX_MS - 1500 && g.left <= FLOOR_MAX_MS, 'left ' + g.left);
  await h.wait(m => m.t === 'floor' && m.holder);
  a.send({ t: 'floorReq', name: '阿明' });
  const no = await a.wait(m => m.t === 'floorNo');
  assert.equal(no.why, 'busy');
  assert.equal(no.name, '老闆');
  assert.ok(no.left > 0);
  assert.ok(!h.msgs.some(m => m.t === 'floorNo'), 'the refusal goes only to the one who asked');
  const k = a.msgs.length;
  h.send({ t: 'floorRelease', turn: g.turn });
  const free = await floorAfter(a, k, m => m.holder === null);
  assert.equal(free.why, 'release');
  a.send({ t: 'floorReq', name: '阿明' });
  const g2 = await h.wait(m => m.t === 'floor' && m.name === '阿明');
  assert.ok(g2.turn > g.turn, 'turn numbers only grow');
  a.send({ t: 'floorRelease', turn: g2.turn });
  await endsFree(c);
  closeAll([h, a]);
});

test('four players asking at once: exactly one gets the floor, three are told busy', async () => {
  const { c, all } = await room(3);
  all.forEach((s, i) => s.send({ t: 'floorReq', name: 'p' + i }));
  await Promise.all(all.map(s => s.wait(m => m.t === 'floor' && m.holder)));
  await sleep(300);
  const grants = all.flatMap(s => s.msgs.filter(m => m.t === 'floor' && m.holder));
  assert.equal(new Set(grants.map(m => m.turn)).size, 1, 'one turn');
  const nos = all.filter(s => s.msgs.some(m => m.t === 'floorNo' && m.why === 'busy'));
  assert.equal(nos.length, 3, 'three refused');
  const winner = grants[0];
  // a release from a non-holder, or with an old / wrong turn, frees nothing
  for (const s of all) s.send({ t: 'floorRelease', turn: winner.turn + 1 });
  all[1].send({ t: 'floorRelease', turn: winner.turn });
  await sleep(400);
  assert.ok(!all.some(s => s.msgs.some(m => m.t === 'floor' && m.holder === null && m.why)), 'still held');
  const holder = all.find((s, i) => winner.name === 'p' + i);
  holder.send({ t: 'floorRelease', turn: winner.turn });
  await Promise.all(all.map(s => s.wait(m => m.t === 'floor' && m.holder === null && m.why === 'release')));
  await endsFree(c);
  closeAll(all);
});

test('keep-alive: held while floorHold comes every second, freed ~2.5 s after it stops', async () => {
  const { c, all: [h, a] } = await room(1);
  a.send({ t: 'floorReq', name: '阿明' });
  const g = await a.wait(m => m.t === 'floor' && m.holder);
  for (let i = 0; i < 5; i++) { await sleep(1000); a.send({ t: 'floorHold', turn: g.turn }); }
  assert.ok(!h.msgs.some(m => m.t === 'floor' && m.holder === null), 'held through 5 s of keep-alives');
  const t0 = Date.now();
  const free = await h.wait(m => m.t === 'floor' && m.holder === null, 6000);
  const took = Date.now() - t0;
  assert.equal(free.why, 'silent');
  assert.ok(took >= FLOOR_SILENT_MS - 1100 && took < FLOOR_SILENT_MS + 1500, 'freed after ' + took + ' ms');
  // a late keep-alive for the dead turn is answered with the floor as it is (free), so the phone stops talking
  const k = a.msgs.length;
  a.send({ t: 'floorHold', turn: g.turn });
  await floorAfter(a, k, m => m.holder === null);
  await endsFree(c);
  closeAll([h, a]);
});

test('forced release at the 12 s limit even with keep-alives, then the same player can ask again', { timeout: 30000 }, async () => {
  const { c, all: [h, a] } = await room(1);
  a.send({ t: 'floorReq', name: '阿明' });
  const g = await a.wait(m => m.t === 'floor' && m.holder);
  const t0 = Date.now();
  const keep = setInterval(() => a.send({ t: 'floorHold', turn: g.turn }), 1000);
  try {
    const free = await h.wait(m => m.t === 'floor' && m.holder === null, FLOOR_MAX_MS + 4000);
    const took = Date.now() - t0;
    assert.equal(free.why, 'limit');
    assert.ok(took >= FLOOR_MAX_MS - 700 && took < FLOOR_MAX_MS + 1500, 'limit hit after ' + took + ' ms');
    await a.wait(m => m.t === 'floor' && m.holder === null && m.why === 'limit');
  } finally { clearInterval(keep); }
  a.send({ t: 'floorReq', name: '阿明' });
  const g2 = await h.wait(m => m.t === 'floor' && m.holder && m.turn !== g.turn);
  a.send({ t: 'floorRelease', turn: g2.turn });
  await endsFree(c);
  closeAll([h, a]);
});

test('holder leaves mid-turn: leaving the seat frees it, closing the socket frees it, for a client and for the host', async () => {
  const { c, all: [h, a, b] } = await room(2);
  a.send({ t: 'floorReq', name: '阿明' });
  await b.wait(m => m.t === 'floor' && m.holder);
  a.send({ t: 'seat', seat: null });
  const f1 = await b.wait(m => m.t === 'floor' && m.holder === null);
  assert.equal(f1.why, 'leave');

  b.send({ t: 'floorReq', name: '阿強' });
  await h.wait(m => m.t === 'floor' && m.name === '阿強');
  const k = h.msgs.length;
  const t0 = Date.now();
  b.close();
  const f2 = await floorAfter(h, k, m => m.holder === null);
  assert.equal(f2.why, 'gone');
  assert.ok(Date.now() - t0 < 1500, 'freed on the close, not by the timeout');

  h.send({ t: 'floorReq', name: '老闆' });
  await a.wait(m => m.t === 'floor' && m.name === '老闆');
  const k2 = a.msgs.length;
  h.close();
  const f3 = await floorAfter(a, k2, m => m.holder === null);
  assert.equal(f3.why, 'gone');
  await endsFree(c);
  closeAll([a]);
});

test('network drop mid-turn: a half-open holder (no close, no pings, no keep-alive) loses the floor within 2.5 s + slack', async () => {
  const { c, all: [h, a] } = await room(1);
  a.send({ t: 'floorReq', name: '阿明' });
  const g = await h.wait(m => m.t === 'floor' && m.holder);
  const t0 = Date.now();
  a.goSilent();
  const f = await h.wait(m => m.t === 'floor' && m.holder === null, 8000);
  assert.equal(f.why, 'silent');
  assert.ok(Date.now() - t0 < FLOOR_SILENT_MS + 1500, 'freed after ' + (Date.now() - t0));
  assert.ok(g.turn > 0);
  await endsFree(c);
  closeAll([h, a]);
});

test('holder reconnects with the same id mid-turn: the old turn is over', async () => {
  const { c, all: [h, a] } = await room(1);
  a.send({ t: 'floorReq', name: '阿明' });
  await h.wait(m => m.t === 'floor' && m.holder);
  const a2 = roomSocket(srv.url, c, 'cli0' + c.toLowerCase(), 'client');
  const hello = await a2.wait(m => m.t === 'hello');
  assert.equal(hello.floor, null, 'the reconnected phone is told the floor is free');
  const f = await h.wait(m => m.t === 'floor' && m.holder === null);
  assert.equal(f.why, 'gone');
  await endsFree(c);
  closeAll([h, a, a2]);
});

test('a phone joining mid-turn is told who is talking in its hello', async () => {
  const { c, all: [h, a] } = await room(1);
  a.send({ t: 'floorReq', name: '阿明' });
  const g = await h.wait(m => m.t === 'floor' && m.holder);
  const late = roomSocket(srv.url, c, 'latecomer1', 'client');
  const hello = await late.wait(m => m.t === 'hello');
  assert.equal(hello.floor.name, '阿明');
  assert.equal(hello.floor.turn, g.turn);
  a.send({ t: 'floorRelease', turn: g.turn });
  await late.wait(m => m.t === 'floor' && m.holder === null);
  await endsFree(c);
  closeAll([h, a, late]);
});

test('press spam: request / release as fast as possible, from two players at once; slowed down, never stuck', async () => {
  const { c, all: [h, a, b] } = await room(2);
  for (let i = 0; i < 40; i++) {
    for (const s of [a, b]) {
      s.send({ t: 'floorReq', name: s === a ? '阿明' : '阿強' });
      const f = lastFloor(s);
      s.send({ t: 'floorRelease', turn: f && f.turn });
    }
    if (i % 8 === 0) await sleep(20);
  }
  // releases racing the grants may miss (they carry the turn the phone knew); a phone releases again once it hears it
  await sleep(500);
  for (const s of [a, b]) { const f = lastFloor(s); if (f && f.holder) s.send({ t: 'floorRelease', turn: f.turn }); }
  assert.ok([a, b].some(s => s.msgs.some(m => m.t === 'floorNo' && m.why === 'slow')), 'spam is slowed down');
  const took = await endsFree(c, FLOOR_SILENT_MS + 2000);
  // a third player who did not spam gets the floor at once
  h.send({ t: 'floorReq', name: '老闆' });
  const g = await a.wait(m => m.t === 'floor' && m.name === '老闆', 3000);
  h.send({ t: 'floorRelease', turn: g.turn });
  await endsFree(c);
  assert.ok(took >= 0);
  closeAll([h, a, b]);
});

test('audio: the holder\'s frames reach everyone else as sent; a non-holder\'s, a wrong turn\'s and oversize frames are dropped', async () => {
  const { c, all: [h, a, b, d] } = await room(3);
  a.send({ t: 'floorReq', name: '阿明' });
  const g = await a.wait(m => m.t === 'floor' && m.holder);
  for (let i = 0; i < 5; i++) { a.ws.send(frame(g.turn, i)); await sleep(80); }
  for (const s of [h, b, d]) {
    for (let t0 = Date.now(); s.bins.length < 5 && Date.now() - t0 < 3000;) await sleep(50);
    assert.equal(s.bins.length, 5, 'every listener got the 5 frames');
    assert.deepEqual([...s.bins[3]], [...frame(g.turn, 3)], 'byte for byte');
  }
  assert.equal(a.bins.length, 0, 'never echoed to the talker');
  b.ws.send(frame(g.turn, 9));                       // not the holder
  a.ws.send(frame(g.turn + 1, 10));                  // wrong turn
  a.ws.send(frame(g.turn, 11, 2000));                // oversize
  const bad = frame(g.turn, 12); bad[0] = 0x00; a.ws.send(bad);   // not an audio frame
  a.ws.send(new Uint8Array([0xa1, 1, 2]));           // shorter than the header
  await sleep(500);
  for (const s of [h, b, d]) assert.equal(s.bins.length, 5, 'nothing else got through');
  a.send({ t: 'floorRelease', turn: g.turn });
  await h.wait(m => m.t === 'floor' && m.holder === null);
  a.ws.send(frame(g.turn, 13));                      // after the turn
  await sleep(400);
  for (const s of [h, b, d]) assert.equal(s.bins.length, 5, 'no audio after the release');
  await endsFree(c);
  closeAll([h, a, b, d]);
});

test('audio flood: a talker cannot push more than its budget through the room', async t => {
  const { c, all: [h, a] } = await room(1);
  a.send({ t: 'floorReq', name: '阿明' });
  const g = await a.wait(m => m.t === 'floor' && m.holder);
  const keep = setInterval(() => a.send({ t: 'floorHold', turn: g.turn }), 1000);
  t.after(() => clearInterval(keep));
  for (let i = 0; i < 200; i++) a.ws.send(frame(g.turn, i));   // 200 frames (16 s of audio) at once
  await sleep(800);
  const got = h.bins.length;
  assert.ok(got >= 10 && got <= 30, `a burst of ~1.5 s passes, the rest is dropped (got ${got})`);
  // at the normal rate it flows again
  await sleep(1500);
  const before = h.bins.length;
  for (let i = 0; i < 10; i++) { a.ws.send(frame(g.turn, 300 + i)); await sleep(80); }
  await sleep(300);
  assert.equal(h.bins.length - before, 10, 'normal-rate frames all pass');
  a.send({ t: 'floorRelease', turn: g.turn });
  await endsFree(c);
  closeAll([h, a]);
});

test('mute: a phone that switched the radio off gets no audio, but still sees who is talking', async () => {
  const { c, all: [h, a, b] } = await room(2);
  b.send({ t: 'pttMute', on: true });
  await sleep(100);
  a.send({ t: 'floorReq', name: '阿明' });
  const g = await b.wait(m => m.t === 'floor' && m.holder);
  for (let i = 0; i < 4; i++) { a.ws.send(frame(g.turn, i)); await sleep(80); }
  await sleep(400);
  assert.equal(h.bins.length, 4);
  assert.equal(b.bins.length, 0, 'muted phone gets nothing');
  b.send({ t: 'pttMute', on: false });
  await sleep(100);
  a.ws.send(frame(g.turn, 5));
  await sleep(300);
  assert.equal(b.bins.length, 1, 'unmuted: audio again');
  a.send({ t: 'floorRelease', turn: g.turn });
  await endsFree(c);
  closeAll([h, a, b]);
});

test('the host closing the room mid-turn leaves no floor behind', async () => {
  const { c, all: [h, a] } = await room(1);
  a.send({ t: 'floorReq', name: '阿明' });
  await h.wait(m => m.t === 'floor' && m.holder);
  h.send({ t: 'close' });
  await a.closed;
  await endsFree(c);
});
