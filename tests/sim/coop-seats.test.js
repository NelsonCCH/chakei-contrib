// Seats as leases: cover when quiet with work waiting, cover at once when the
// phone goes away, the seat back on return, hand-back with the exact state, versions (請重新載入), viewers, the
// outbox never dropping a result over a long link loss, junk from the room, and a stations-next module
// (燒味 roast) registered with one plugin file and played end to end.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCoop } from './coop.js';
import { freshCore } from './core.js';

const FOUR = ['waiter', 'bar', 'kitchen', 'till'];
const covers = (r, seat) => r.driverLog.filter(d => d.seat === seat && d.driver === 'computer');

test('quiet 30 s with work waiting: the computer covers the seat; the player takes it back', () => {
  // when the bar's quiet-with-work began: the last time since t=40 that drinks started waiting (the referee's view)
  let workFrom = null, had = false, stop = false;
  const r = runCoop({ seed: 3, seats: FOUR, shape: 'lan', lazy: { 1: [40, 110] }, each: ({ t, ref }) => {
    const G = ref.C.G, waiting = G.groups.some(g => g.state === 'wait' && g.drinks && g.drinks.some(d => !d.done));
    if (t >= 40 && G.roles.bar !== 'remote') stop = true;
    if (t >= 40 && !stop){ if (waiting && !had) workFrom = t; had = waiting; }
  } });
  assert.deepEqual(r.errs, []);
  const c = covers(r, 'bar').find(d => d.why === 'quiet');
  assert.ok(c, 'the bar was covered for being quiet: ' + JSON.stringify(r.driverLog));
  assert.ok(c.t - workFrom >= 29 && c.t - workFrom <= 30 + 1.5, `covered ${(c.t - workFrom).toFixed(1)} s after work waited: within COVER_QUIET_S + 1 s (+ one status)`);
  assert.ok(r.driverLog.some(d => d.seat === 'bar' && d.driver === 'p1' && d.t > 110), 'the player took the bar back');
});

test('quiet with no work waiting: no cover', () => {
  // the bar has nothing to do before anyone orders: idle from the start, no cover
  const r = runCoop({ seed: 4, seats: ['till', 'bar'], shape: 'lan', lazy: { 1: [0, 30] }, maxSec: 200 });
  assert.deepEqual(r.errs, []);
  const early = covers(r, 'bar').filter(d => d.why === 'quiet' && d.t < 30);
  assert.deepEqual(early, [], 'no cover while there was no work');
});

test('a phone that goes away (lock, pagehide) is covered within 1 s, and gets its seat back on return', () => {
  const r = runCoop({ seed: 5, seats: FOUR, shape: '4g', events: [{ at: 50, kind: 'away', phone: 2, dur: 15 }] });
  assert.deepEqual(r.errs, []);
  const seat = FOUR[2], c = covers(r, seat).find(d => d.why === 'away');
  assert.ok(c && c.t - 50 <= 1, `covered ${c ? (c.t - 50).toFixed(2) + ' s' : 'never'} after going away`);
  assert.ok(r.driverLog.some(d => d.seat === seat && d.driver === 'p2' && d.t >= 65), 'back on return');
});

// The link rule at its real value (the browser tests only see it end to end, behind the reconnect timers).
test('a phone whose link goes dead is covered COVER_LINK_S (15 s) after it was last heard, and gets its seat back on reconnect', () => {
  const r = runCoop({ seed: 6, seats: FOUR, shape: 'lan', events: [{ at: 50, kind: 'down', phone: 3, dur: 25 }] });
  assert.deepEqual(r.errs, []);
  const seat = FOUR[3], c = covers(r, seat).find(d => d.why === 'link');
  assert.ok(c, 'covered for the lost link: ' + JSON.stringify(r.driverLog.filter(d => d.seat === seat)));
  // last heard just before t=50 (a status about every second): covered 14-15.5 s after the link went, not earlier
  assert.ok(c.t - 50 >= 14 && c.t - 50 <= 15.5, `covered ${(c.t - 50).toFixed(2)} s after the link went: COVER_LINK_S`);
  assert.ok(r.driverLog.some(d => d.seat === seat && d.driver === 'p3' && d.t >= 75), 'back on reconnect');
});

test('hand-back with no time passing returns the exact station state, for every station', () => {
  for (const [i, seat] of FOUR.entries()) {
    if (i === 0) continue;
    let before = null, after = null, phase = 0, at = 0;
    const r = runCoop({ seed: 6 + i, seats: FOUR, shape: 'lan', each: ({ t, now, phones, ref }) => {
      const ph = phones[i], C = ph.C;
      if (phase === 0 && t >= 60) { ref.C.setPaused(true); phase = 1; at = now; }
      else if (phase === 1 && now - at > 500) { before = JSON.stringify(C.blobOf(C.G, seat)); C.release(seat); ph.claimed = true; ph.lastClaim = now + 1e9; phase = 2; at = now; }
      else if (phase === 2 && now - at > 1500) { C.claim(seat); phase = 3; at = now; }
      else if (phase === 3 && now - at > 1500) { after = JSON.stringify(C.blobOf(C.G, seat)); ph.lastClaim = 0; ref.C.setPaused(false); phase = 4; }
    } });
    assert.deepEqual(r.errs, []);
    assert.ok(before && after, `${seat}: the round trip ran`);
    if (seat === 'till') {
      // the till gives the customer it was serving back to the queue for the computer (a documented exception)
      const b = JSON.parse(before), a = JSON.parse(after);
      for (const k of ['step', 'entry', 'give']) assert.ok(k in a.s && k in b.s);
    } else assert.equal(after, before, `${seat}: state after player -> computer -> player`);
  }
});

test('an older page is told to reload (請重新載入); a full room refuses a ninth player; a viewer cannot take a seat', () => {
  const C = freshCore(), P = freshCore();
  for (const X of [C, P]) { X.setStation('waiter'); X.newGame(); }
  const sent = [];
  C.refStart({ room: 'R1', me: 'host', name: 'h', send: e => sent.push(e), seed: 1, round: 1, now: 0 });
  const hello = (from, proto, role = 'player') => ({ p: proto, room: 'R1', from, round: 0, seq: 0, at: 0, b: { k: 'hello', proto, build: 'x', caps: { z: false, cs: true, ptt: false }, role, name: from, player: from, resume: null } });
  C.refReceive(hello('old', C.PROTO - 1), 0);
  assert.equal(sent.at(-1).b.k, 'reject'); assert.equal(sent.at(-1).b.reason, 'proto'); assert.equal(sent.at(-1).b.newer, false, 'an older page: reload');
  for (let i = 0; i < 7; i++) C.refReceive(hello('p' + i, C.PROTO), 0);
  sent.length = 0; C.refReceive(hello('p9', C.PROTO), 0);
  assert.equal(sent.at(-1).b.k, 'reject', 'the ninth player is refused'); assert.equal(sent.at(-1).b.reason, 'full');
  C.refReceive(hello('tv', C.PROTO, 'viewer'), 0);
  sent.length = 0;
  C.refReceive({ p: C.PROTO, room: 'R1', from: 'tv', round: 1, seq: 1, at: 0, b: { k: 'claim', seat: 'bar' } }, 0);
  assert.equal(sent.at(-1).b.k, 'nack'); assert.equal(sent.at(-1).b.reason, 'viewer');
  // the phone side: a reject for the protocol shows 請重新載入 (the page reads phone().rejected)
  P.phoneJoin({ room: 'R1', me: 'old', name: 'o', send: () => {}, now: 0 });
  P.phoneReceive({ p: C.PROTO, room: 'R1', from: 'ref', to: 'old', round: 1, seq: 9, at: 0, b: { k: 'reject', reason: 'proto', newer: false } }, 0);
  assert.deepEqual(P.phone().rejected, { reason: 'proto', newer: false });
});

// A bug: the till phone's last status of a level, sent just before it saw the next one, became the new level's
// checkpoint; the grant gave the phone back its old customer, who was then paid in the new level.
test('a status from the last shift never becomes the new shift checkpoint: the seat is granted fresh', () => {
  const C = freshCore();
  C.setStation('waiter'); C.newGame();
  const sent = [];
  C.refStart({ room: 'R1', me: 'host', name: 'h', send: e => sent.push(e), seed: 1, round: 2, now: 0, seated: { till: { player: 'p1', name: 'p' } } });
  const old = { kind: 'till', v: 1, s: { ...C.blobOf(C.G, 'till').s, cur: { id: 4, expect: 38 }, step: 'cash' } };
  C.refReceive({ p: C.PROTO, room: 'R1', from: 'p1', round: 1, seq: 0, at: 59, b: { k: 'status', seats: { till: { inputs: 1, waiting: 1, load: 0, ckpt: old } } } }, 10);
  C.refReceive({ p: C.PROTO, room: 'R1', from: 'p1', round: 1, seq: 0, at: 0, b: { k: 'hello', proto: C.PROTO, build: 'x', caps: { z: false, cs: true, ptt: false }, role: 'player', name: 'p', player: 'p1', resume: { round: 1, seq: 4, ack: 4 } } }, 20);
  const grant = sent.find(e => e.b.k === 'grant' && e.b.seat === 'till');
  assert.ok(grant, 'the lobby seat is granted on hello');
  assert.equal(grant.b.state.s.cur, null, 'the grant carries the new shift\'s till, not the last shift\'s customer');
});

test('junk from the room never throws and is counted (at run time)', () => {
  const C = freshCore(), P = freshCore();
  for (const X of [C, P]) { X.setStation('waiter'); X.newGame(); }
  C.refStart({ room: 'R1', me: 'host', name: 'h', send: () => {}, seed: 1, round: 1, now: 0 });
  P.phoneJoin({ room: 'R1', me: 'p1', name: 'p', send: () => {}, now: 0 });
  const junk = [null, 1, 'x', [], {}, { p: 1 }, { p: 1, room: 'R1', from: 'p1', round: 1, seq: 1, at: 0, b: { k: 'res', seat: 'bar', epoch: 1, r: { k: 'lineDone' } } },
    { p: 1, room: 'R1', from: 'ref', round: 1, seq: 1, at: 0, b: { k: 'keyframe', key: { rseq: 1 } } }];
  for (const j of junk) { assert.doesNotThrow(() => C.refReceive(j, 0)); assert.doesNotThrow(() => P.phoneReceive(j, 0)); }
  assert.equal(C.referee().stats.junk, junk.length);
  assert.equal(P.phone().stats.junk, junk.length);
});

test('a long link loss while the station keeps working loses no result (the outbox never drops)', () => {
  const r = runCoop({ seed: 8, seats: FOUR, shape: 'lan', events: [{ at: 20, kind: 'down', phone: 1, dur: 100 }] });
  assert.deepEqual(r.errs, []);
  assert.equal(r.R.stats.applied + r.R.stats.nacked, r.sentRes, 'every result sent was applied or refused');
});

test('flow (walk-ins, director, demand) sits at the parity values through a co-op shift: nothing steered, no walk-ins', () => {
  const r = runCoop({ seed: 10, seats: FOUR, shape: 'lan' });
  assert.deepEqual(r.errs, []);
  assert.deepEqual(r.ref.C.flowState(), r.ref.C.parityFlow());
  assert.equal(r.ref.C.directorBias('g'), 'g');
  assert.equal(r.ref.C.demandGap(7.25), 7.25);
});

test('燒味 roast registered with one plugin file: the computer plays it on the referee, a phone claims it and plays it, the referee books every roast', () => {
  let roastPaid = 0;
  const r = runCoop({ seed: 9, seats: ['waiter', 'roast', 'bar'], extraSeats: ['roast'], shape: 'lan', events: [{ at: 90, kind: 'release', phone: 1, dur: 20 }],
    each: ({ ref }) => { roastPaid = ref.C.referee().stats.applied; } });
  assert.deepEqual(r.errs, []);
  const log = r.driverLog.filter(d => d.seat === 'roast').map(d => d.driver);
  assert.ok(log.includes('p1') && log.includes('computer'), 'the roast seat went phone -> computer -> phone: ' + log.join(' '));
  assert.ok(r.phones[1].C.roastState().served > 0, 'the phone served roast');
  assert.ok(roastPaid > 0);
  assert.ok(r.bus.stats.bytesByKind.res > 0);
});
