// Junk inside a phone's own stream: a phone sends a result the referee's validator refuses (a station bug, or
// a hostile page). It takes its place in the phone's seq order and is refused in its turn (nack 'invalid'), so what the
// phone does afterwards still applies, the junk never applies, the outbox drains and the invariants hold. Plus the
// memory bounds: a flood of far-ahead seqs or of results to a paused shift never grows the referee's buffers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCoop } from './coop.js';
import { freshCore, mulberry32 } from './core.js';

const FOUR = ['waiter', 'bar', 'kitchen', 'till'];
const SEEDS = Number(process.env.SIM_SEEDS) || 2;
/** Results that fail proto/validate.ts isResult, yet apply as a harmless no-op on the sending phone's replica. */
const JUNK = [
  { k: 'slipClose', gid: -1 },
  { k: 'seat', gid: 1.5, table: 0 },
  { k: 'bogus', gid: 3 },
  { k: 'tillTake', cid: -3 },
  { k: 'order', gid: -1, keys: 'not a list', peeked: false },
];
const isJunk = r => JUNK.some(j => JSON.stringify(j) === JSON.stringify(r));

/**
 * A co-op shift where teammates' phones send junk results through their real station path (`submit`, so they go in the
 * outbox with a seq and are resent until acked). `when(ph, t, rnd)` says whether phone `ph` sends one this frame.
 */
function junkShift(o, when) {
  const sent = [], seen = [], rnd = mulberry32((o.seed ?? 1) * 1013);
  let hooked = false;
  const r = runCoop({ ...o, each: x => {
    if (!hooked){ hooked = true; x.ref.C.onRefEvent(e => seen.push(e)); }
    for (const ph of x.phones) {
      if (ph === x.ref || !ph.seat || !ph.alive || ph.frozenUntil) continue;
      const G = ph.C.G, P = ph.C.phone();
      if (!P || !G.running || G.paused || G.roles[ph.seat] !== 'me' || !when(ph, x.t, rnd)) continue;
      const j = JUNK[Math.floor(rnd() * JUNK.length)];
      ph.C.submit(ph.seat, j);
      sent.push({ id: ph.id, seq: P.seq, t: x.t });
    }
    if (o.each) o.each(x);
  } });
  return { r, sent, seen };
}

/** The checks every junk shift must pass. */
function checkJunk({ r, sent, seen }, label, after = false) {
  assert.deepEqual(r.errs, [], label);   // includes: every phone's outbox drained (unacked() === 0)
  assert.ok(sent.length > 0, `${label}: junk was sent`);
  assert.ok(!seen.some(e => isJunk(e.r)), `${label}: a junk result reached the shop`);
  assert.equal(r.R.stats.applied + r.R.stats.nacked, r.sentRes, `${label}: every result sent was applied or refused (${r.R.stats.applied} + ${r.R.stats.nacked} vs ${r.sentRes})`);
  assert.ok(r.R.stats.nacked >= sent.length, `${label}: every junk result was refused`);
  // no result applied twice
  const keys = seen.filter(e => e.ok === null).map(e => `${e.player}:${e.seq}`);
  assert.equal(new Set(keys).size, keys.length, `${label}: a result was applied twice`);
  for (const ph of r.phones) {
    if (ph === r.ref || !ph.alive || ph.role !== 'player' || !ph.seat) continue;
    const P = ph.C.phone(), mine = sent.filter(s => s.id === ph.id);
    // the referee took everything this phone sent (its stream never stalled)
    assert.equal(r.R.acks[ph.id], P.seq, `${label}: ${ph.id} acked ${r.R.acks[ph.id]} of ${P.seq}`);
    // and what it did after its last junk result was applied
    const last = Math.max(0, ...mine.map(s => s.seq));
    if (after && last) assert.ok(seen.some(e => e.player === ph.id && e.seq > last && e.ok === true), `${label}: ${ph.id} had nothing applied after its junk (seq ${last})`);
  }
}

test('one junk result in the middle of a stream is refused; the results after it apply, the outbox drains', () => {
  for (const shape of ['clean', '4g']) {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const fired = new Set();
      const out = junkShift({ seed, seats: FOUR, shape }, (ph, t) => {
        if (t < 40 || fired.has(ph.id)) return false;
        fired.add(ph.id); return true;
      });
      checkJunk(out, `${shape} seed ${seed}`, true);
      assert.equal(out.sent.length, 4, 'one junk result from each player');
      assert.ok(out.r.S.served > 2);
    }
  }
});

test('fuzz: junk interleaved at random on a lossy, reordering, duplicating link, plus garbage from a stranger', () => {
  for (let seed = 1; seed <= SEEDS + 1; seed++) {
    const g = mulberry32(seed * 77);
    let stranger = 0;
    const out = junkShift({ seed, seats: FOUR, shape: 'bad', each: ({ bus, frames }) => {
      if (frames === 1) bus.add({ id: 'zz', deliver: () => {} });
      if (g() >= .05) return;
      // what a stranger (never said hello) or a broken page puts in the room: bad heads, bad bodies, any seq
      const seq = [0, 1, 2, 65, 1e6, -1, 1.5][Math.floor(g() * 7)];
      const pick = [
        '{not json', 'null', '[]', JSON.stringify({ p: 1 }),
        JSON.stringify({ p: 1, room: 'SIM1', round: 1, seq, at: 0, b: { k: 'res', seat: 'bar', epoch: 1, r: { k: 'slipClose', gid: -1 } } }),
        JSON.stringify({ p: 1, room: 'SIM1', round: 1, seq, at: 0, b: { k: 'claim', seat: 'bar' } }),
        JSON.stringify({ p: 1, room: 'XX', round: 1, seq, at: 0, b: { k: 'status', seats: {} } }),
      ][Math.floor(g() * 7)];
      stranger++; bus.send('zz', pick);
    } }, (ph, t, rnd) => t > 5 && rnd() < .004);
    checkJunk(out, `bad seed ${seed}`);
    assert.ok(stranger > 50, 'the stranger sent garbage all shift');
    assert.ok(!('zz' in out.r.R.players), 'a stranger never became a player');
    assert.ok(out.sent.length >= 3, `seed ${seed}: only ${out.sent.length} junk results`);
  }
});

/** A referee with one teammate (p1) who drives the bar (epoch 2), for the flood tests. */
function oneTeammate() {
  const C = freshCore();
  C.setStation('waiter'); C.newGame();
  const sent = [];
  C.refStart({ room: 'R1', me: 'host', name: 'h', send: e => sent.push(e), seed: 1, round: 1, now: 0 });
  const env = (seq, b) => ({ p: C.PROTO, room: 'R1', from: 'p1', round: 1, seq, at: 0, b });
  C.refReceive(env(0, { k: 'hello', proto: C.PROTO, build: 'x', caps: { z: false, cs: true, ptt: false }, role: 'player', name: 'p1', player: 'p1', resume: null }), 0);
  C.refReceive(env(1, { k: 'claim', seat: 'bar' }), 0);
  assert.equal(C.referee().seats.bar.epoch, 2);
  return { C, sent, env };
}

test('junk with a good envelope from a known player is nacked "invalid" in its turn, even when it came early', () => {
  const { C, sent, env } = oneTeammate();
  const R = () => C.referee(), m0 = C.G.mistakes;
  // seq 3 (valid) arrives before seq 2 (junk): it waits, then the junk is refused and seq 3 applies
  C.refReceive(env(3, { k: 'res', seat: 'bar', epoch: 2, r: { k: 'tillMiss', cid: 1, loss: 0 } }), 0);
  assert.equal(R().acks.p1, 1, 'seq 3 waits for seq 2');
  C.refReceive(env(2, { k: 'res', seat: 'bar', epoch: 2, r: { k: 'slipClose', gid: -1 } }), 0);
  assert.equal(R().acks.p1, 3);
  assert.equal(C.G.mistakes, m0 + 1, 'the valid result after the junk applied');
  const nack = sent.find(e => e.b.k === 'nack');
  assert.deepEqual(nack.b, { k: 'nack', player: 'p1', seq: 2, reason: 'invalid' });
  // the junk resent (the nack was lost): a duplicate, never applied, never nacked again
  const n0 = sent.length;
  C.refReceive(env(2, { k: 'res', seat: 'bar', epoch: 2, r: { k: 'slipClose', gid: -1 } }), 0);
  assert.equal(sent.length, n0); assert.equal(R().stats.dup, 1);
  assert.equal(R().stats.junk, 2, 'both copies counted as junk');
});

test('a flood of far-ahead seqs and of results to a paused shift never grows the referee', () => {
  const { C, env } = oneTeammate();
  const R = () => C.referee(), m0 = C.G.mistakes;
  for (let s = 3; s < 20000; s++) C.refReceive(env(s, { k: 'res', seat: 'bar', epoch: 2, r: { k: 'tillMiss', cid: 1, loss: 0 } }), 0);
  assert.ok(R().players.p1.buf.size <= C.AHEAD_MAX, `buffer of ${R().players.p1.buf.size}`);
  assert.equal(R().stats.ahead, 20000 - 3 - (C.AHEAD_MAX - 1), 'seqs 3..AHEAD_MAX+1 held, the rest dropped');
  for (let s = 3; s < 20000; s++) C.refReceive(env(s, { k: 'bogus' }), 0);   // junk bodies far ahead: also bounded
  assert.ok(R().players.p1.buf.size <= C.AHEAD_MAX);
  assert.equal(C.G.mistakes, m0);
  // seq 2 arrives: the window drains in order, the rest come again with the resend (a real phone resends every RESEND_MS)
  C.refReceive(env(2, { k: 'res', seat: 'bar', epoch: 2, r: { k: 'tillMiss', cid: 1, loss: 0 } }), 0);
  assert.equal(R().acks.p1, 2 + C.AHEAD_MAX - 1);
  assert.equal(R().players.p1.buf.size, 0);
  assert.equal(C.G.mistakes, m0 + C.AHEAD_MAX, 'each applied once');
  // paused: results are held up to HELD_MAX, the rest refused
  C.setPaused(true);
  const from = R().acks.p1 + 1, sent = [];
  C.referee().send = e => sent.push(e);
  for (let s = from; s < from + 2000; s++) C.refReceive(env(s, { k: 'res', seat: 'bar', epoch: 2, r: { k: 'tillMiss', cid: 1, loss: 0 } }), 0);
  assert.equal(R().held.length, C.HELD_MAX);
  assert.equal(sent.filter(e => e.b.k === 'nack' && e.b.reason === 'paused-queue').length, 2000 - C.HELD_MAX);
  const m1 = C.G.mistakes;
  C.setPaused(false);
  assert.equal(R().held.length, 0);
  assert.equal(C.G.mistakes, m1 + C.HELD_MAX, 'the held results applied once each on resume');
});

test('a sequenced message too big for the room is never sent, and does not use up a seq', () => {
  const P = freshCore();
  P.setStation('waiter'); P.newGame();
  const out = [];
  P.phoneJoin({ room: 'R1', me: 'p1', name: 'p', send: e => out.push(e), now: 0 });
  P.claim('bar');
  P.submit('bar', { k: 'order', gid: 1, keys: Array.from({ length: 40 }, () => 'x'.repeat(80)), peeked: false });   // ~3.4 KB: fine
  P.submit('bar', { k: 'tillMiss', cid: 1, loss: 0, pad: 'x'.repeat(17000) });   // over 16 KB
  P.release('bar');
  assert.deepEqual(out.filter(e => e.seq > 0).map(e => e.seq), [1, 2, 3], 'seqs stay contiguous');
  assert.equal(P.phone().stats.tooBig, 1);
  assert.ok(out.every(e => JSON.stringify(e).length <= 16 * 1024));
});
