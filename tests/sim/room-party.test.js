// A party night through the room's core: the same module the Durable Object runs (worker/room-core.js is
// src/core/coop/room-worker.ts), driven the way worker/index.ts drives it. The night (room-party.ts) asks for each
// round's shift (roundStart), the room's referee plays it (roomStart / roomAdvance) and closes its books, and the round's
// report goes back to the night (partyResult). One night is played from the lobby through five rounds, the vote, the
// ready check and the countdown of each, the end cards, 收舖, 再開一日 and a second night to 散水.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshCore } from './core.js';
import { runCoop } from './coop.js';

/** The Worker's side, as worker/index.ts does it: act on what the night asks for; start, run and close shifts. */
function room(C) {
  const R = { C, now: 1_000_000, owner: null, round: 0, sent: [], rejects: [], shifts: [], phases: [] };
  const opts = () => ({ room: 'PRTY', now: R.now, round: R.round, seed: 1000 + R.round, send: e => { R.sent.push(e); } });
  R.outs = outs => {
    let plan = null;
    for (const o of outs) {
      if (o.k === 'reject') R.rejects.push(o.why);
      else if (o.k === 'host') R.owner = o.player ?? R.owner;
      else if (o.k === 'drive') C.roomDrive(o.seat, o.player);
      else if (o.k === 'roundStart') plan = o.plan;
    }
    const ph = C.partyNight()?.phase;
    if (ph && R.phases.at(-1) !== ph) R.phases.push(ph);
    if (plan) { R.round++; C.roomStart(opts(), C.partyShift(plan)); R.shifts.push(plan); }
  };
  R.in = (player, ev) => R.outs(C.partyIn(ev, player));
  /** The night's clock (the Worker's 4 Hz timer while partyTimed), `sec` seconds of it. */
  R.tick = sec => { for (let i = 0; i < sec * 4; i++) { if (C.partyTimed()) R.outs(C.partyTick(.25)); R.now += 250; } };
  /** The shift runs (the Worker's beat) until its books close; then the round's report goes to the night. */
  R.playShift = () => {
    let n = 0; const t0 = R.now;
    while (!C.roomStatus().closed) { R.now += 250; C.roomAdvance(R.now); assert.ok(++n < 4 * 600, 'the shift closes its books'); }
    assert.ok(R.now - t0 >= R.shifts.at(-1).sec * 1000, 'the shift ran its whole length: ' + (R.now - t0) + ' ms');
    R.outs(C.partyResult());
  };
  return R;
}

test('a party night over the room: lobby, five rounds (vote, ready, countdown, shift, end card), 收舖, 再開一日, 散水', { timeout: 120000 }, () => {
  const C = freshCore(), R = room(C);
  const P = ['p0', 'p1', 'p2', 'p3', 'p4'];
  R.outs(C.partyOpen(7, 'p0', '老闆'));
  assert.equal(C.partyNight().host, 'p0', 'the owner who opened the night is its host');
  for (const p of P.slice(1)) R.in(p, { k: 'join', name: '阿' + p });
  ['floor1', 'bar', 'kitchen', 'till'].forEach((seat, i) => R.in(P[i], { k: 'seat', seat }));
  R.in('p4', { k: 'seat', seat: 'bar' });   // taken: refused, p4 watches
  assert.deepEqual(R.rejects, ['that seat is taken']);
  R.rejects.length = 0;
  R.in('p1', { k: 'setup', cfg: { days: 1 } });   // only the host sets up
  assert.equal(R.rejects.length, 1); R.rejects.length = 0;
  R.in('p0', { k: 'setup', cfg: { shop: 'estate', days: 1, chooser: 'vote' } });
  R.in('p0', { k: 'start' });
  const banks = [C.partyNight().bank];
  while (C.partyNight().phase !== 'close') {
    const s = C.partyNight();
    if (s.phase === 'endcard') { for (const p of ['p0', 'p1', 'p2', 'p3']) R.in(p, { k: 'next' }); continue; }
    assert.equal(s.phase, 'vote', 'each round opens on the vote');
    for (const p of ['p0', 'p1', 'p2', 'p3']) R.in(p, { k: 'vote', card: (s.round % 3) });
    R.tick(6);   // the change window
    assert.equal(C.partyNight().phase, 'ready');
    for (const p of ['p0', 'p1', 'p2', 'p3']) R.in(p, { k: 'ready', on: true });
    R.in('p0', { k: 'start' });
    assert.equal(C.partyNight().phase, 'countdown');
    const before = R.shifts.length;
    R.tick(6);
    assert.equal(C.partyNight().phase, 'round');
    assert.equal(R.shifts.length, before + 1, 'the countdown started the round\'s shift in the room');
    const st = C.roomStatus();
    assert.ok(st.running && !st.closed);
    assert.equal(C.G.party.shop, 'estate', 'the shop plays at the party shop\'s pace');
    assert.equal(C.CFG.gameSec, R.shifts.at(-1).sec, 'and for the round\'s length');
    R.playShift();
    assert.equal(C.partyNight().phase, 'endcard', 'the closed books end the round on its end card');
    banks.push(C.partyNight().bank);
    assert.ok(C.partyNight().history.length === R.shifts.length, 'one result per round');
  }
  assert.deepEqual(R.rejects, [], 'nothing the night was asked was refused');
  assert.equal(R.shifts.length, 5, 'five shifts in one day');
  assert.deepEqual(R.shifts.map(p => p.kind), ['breakfast', 'lunch', 'tea', 'dinner', 'late']);
  assert.ok(new Set(banks).size > 1, 'the till moved: ' + banks.join(' '));
  for (const ph of ['lobby', 'vote', 'ready', 'countdown', 'round', 'endcard', 'close']) assert.ok(R.phases.includes(ph) || ph === 'lobby', 'phase ' + ph);
  // 收舖: the host decides; 再開一日 opens the next night in the lobby, 散水 ends it
  R.in('p2', { k: 'again' });
  assert.equal(C.partyNight().phase, 'close', 'only the host decides');
  R.rejects.length = 0;
  R.in('p0', { k: 'again' });
  assert.equal(C.partyNight().phase, 'lobby', '再開一日');
  assert.equal(C.partyNight().nights, 2, 'the second night');
  R.in('p0', { k: 'start' });
  assert.equal(C.partyNight().phase, 'vote', 'the second night starts like the first');
  R.in('p0', { k: 'bye' });
  // 散水 is for the close screen: refused mid-night, or the night ends; either way the room can close it after
  if (C.partyNight().phase !== 'done') {
    while (C.partyNight().phase !== 'close') {
      const s = C.partyNight();
      if (s.phase === 'endcard') { for (const p of ['p0', 'p1', 'p2', 'p3']) R.in(p, { k: 'next' }); continue; }
      for (const p of ['p0', 'p1', 'p2', 'p3']) R.in(p, { k: 'vote', card: 0 });
      R.tick(6);
      for (const p of ['p0', 'p1', 'p2', 'p3']) R.in(p, { k: 'ready', on: true });
      R.in('p0', { k: 'start' }); R.tick(6); R.playShift();
    }
    R.in('p0', { k: 'bye' });
  }
  assert.equal(C.partyNight().phase, 'done', '散水');
  C.partyDrop();
  assert.equal(C.partyNight(), null, 'the owner closed the night: plain shifts again');
});

test('host duty in a room night: the owner leaving mid-round hands it to a seated player, never to an onlooker', () => {
  const C = freshCore(), R = room(C);
  R.outs(C.partyOpen(3, 'own', '老闆'));
  R.in('tv', { k: 'join', name: '睇戲' });
  R.in('a', { k: 'join', name: '阿A' });
  R.in('a', { k: 'seat', seat: 'till' });
  R.in('own', { k: 'start' });
  R.in('a', { k: 'vote', card: 0 }); R.tick(6);
  R.in('a', { k: 'ready', on: true }); R.in('own', { k: 'start' }); R.tick(6);
  assert.equal(C.partyNight().phase, 'round');
  R.outs(C.partyLeave('own'));
  assert.equal(R.owner, 'a', 'the seated player is the owner now, not the onlooker who joined first');
  R.outs(C.partyLeave('a'));
  assert.equal(C.partyNight().host, null, 'nobody seated: no host');
  R.in('tv', { k: 'seat', seat: 'bar' });
  assert.equal(C.partyNight().host, 'tv', 'the first to sit takes host duty');
  assert.equal(R.owner, 'tv');
});

// The round report's per-person counters come from each player's own results, as the referee applies them
// (core/coop/tally.ts): mistakes counted against the seat they drove, the till's bills with no wrong total or change,
// the cook's burns (from the kitchen's checkpoint), the longest clean run. 幫 / 催 stay 0 until the pings exist.
function partyRound(events) {
  let burned = false;
  const r = runCoop({
    seed: 3, seats: ['floor1', 'bar', 'kitchen', 'till'], party: { shop: 'estate', sec: 120, round: 0 }, maxSec: 140, events,
    // one dish left on the stove too long: the cook's next take of it burns it (stations/kitchen.ts kitTake)
    each: ({ t, phones }) => {
      if (burned || t < 40) return;
      const G = phones[2].C.G;
      for (const slots of Object.values(G.kit)) for (const j of slots) if (j && j.burnAt !== undefined && j.ready !== undefined) { j.burnAt = j.ready; burned = true; return; }
    },
  });
  assert.deepEqual(r.errs, []);
  assert.ok(burned, 'a dish was set to burn');
  return { r, rep: r.room.C.roomReport() };
}
function checkCounts({ r, rep }) {
  const by = Object.fromEntries(rep.players.map(p => [p.player, p]));
  assert.deepEqual(Object.keys(by).sort(), ['p0', 'p1', 'p2', 'p3'], 'every seated player has a line');
  assert.equal(rep.players.reduce((a, p) => a + p.mistakes, 0), rep.team.mistakes, 'every mistake is someone\'s: ' + JSON.stringify(rep.players.map(p => p.mistakes)));
  assert.ok(by.p3.exact > 0 && by.p3.exact <= r.S.paidCount, 'the till\'s exact bills: ' + by.p3.exact + ' of ' + r.S.paidCount);
  for (const p of ['p0', 'p1', 'p2']) assert.equal(by[p].exact, 0, 'only the till gives change');
  assert.ok(by.p2.burnt >= 1, 'the cook\'s burn is counted: ' + by.p2.burnt);
  for (const p of ['p0', 'p1', 'p3']) assert.equal(by[p].burnt, 0, 'only the cook burns');
  for (const p of rep.players) {
    assert.ok(p.streak > 0, p.player + ' had a clean run');
    assert.equal(p.helps + p.hurries, 0, 'no pings yet');
  }
}

test('party round: per-person mistakes, exact change, burns and clean runs come from each player\'s own results', { timeout: 120000 }, () => {
  checkCounts(partyRound([]));
});

test('party round: the per-person counts carry over a room restart (the room\'s save)', { timeout: 120000 }, () => {
  const x = partyRound([{ at: 70, kind: 'restart' }]);
  assert.equal(x.r.restarts, 1);
  checkCounts(x);
});
