// Every order or task handed to a player starts from zero. If the computer (a seat it
// covers, the 樓面 pool or a computer floor worker) has started it, the computer finishes it. Seen in play: back
// at 燒味 on 年廿八 after the computer covered it, the ticket had ✓白飯 and a meat sat on the board.
// The guard (core/coop/fresh.ts) checks every hand-out: a seat taken back from the computer (the station's started()
// after toPlayer), a floor job's mini-game at its start, and a player's claim of a 樓面 task a computer hand began.
// Here a player keeps leaving their seat to the computer and taking it back, at random moments, across seeds, levels and
// seats; on the floor they also grab and drop tasks as fast as they appear. Not one hand-out may hold begun work.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshCore, simPort, mulberry32 } from './core.js';
import { installLevel } from './levels.js';

const PRESS = { roast: 'roastBotPress', runner: 'runnerBotPress', takeaway: 'takeawayBotPress' };
const ME = { type: 'player', player: 'me' }, CPU = { type: 'computer' };

/** One shift with the player's seat `seat` changing hands every few seconds. `kind`: a solo seat (roast / runner /
 *  takeaway) or 'floor' (樓面 at floor1). Returns the guard's record and how often the computer had work in hand. */
function run({ seed, kind, lv }) {
  const C = freshCore(), port = simPort(C), rnd = mulberry32(seed ^ 0xF4E5);
  C.setRng(C.mulberry32(seed)); C.setPort(port); C.setStation('waiter'); C.setSlot('lunch'); C.setDiff('pro');
  const lvSet = lv ? installLevel(C, port, lv) : null;
  C.newGame(); C.resetClock(); if (lvSet) lvSet();
  const seat = kind === 'floor' ? 'floor1' : kind;
  if (kind === 'floor') assert.ok(C.soloShopStart(0, 'floor'), 'the floor runs'); else C.soloSeatStart(kind, 0);
  C.handOutsReset();
  const G = C.G, press = C[PRESS[kind]];
  let now = 0, next = 2 + rnd() * 4, busyAtHandBack = 0, backs = 0, hold = null;
  for (let f = 0; f < 60 * 400 && (G.running || !G.t); f++) {
    if (G.running && !G.paused) C.advance(1 / 60, h => C.coopStep(h), () => G.running && !G.paused);
    C.coopFrame(now);
    const mine = G.running && G.roles[seat] === 'me';
    if (G.running && G.t >= next) {
      next = G.t + 2 + rnd() * 7;
      if (mine) C.setDriver(seat, CPU, 'release');
      else {
        // the computer is mid-order now (the case seen in play): the hand-back must still give untouched work
        if (C.stationOf(kind)?.started?.()) busyAtHandBack++;
        if (kind === 'floor' && G.floor.tasks.some(x => x.by === '#cpu:floor1')) busyAtHandBack++;
        C.setDriver(seat, ME, 'claim'); backs++;
      }
    }
    if (mine && press && rnd() < .4) press();
    if (mine && kind === 'floor') {
      // grab the oldest open task at once, hold it a moment, drop it (返樓面): the claims race the computer's hands
      if (hold && (G.t >= hold.until || C.taskOf(hold.id)?.by !== 'me')) { if (C.taskOf(hold.id)?.by === 'me') C.taskRelease('me', hold.id); hold = null; }
      if (!hold) { const x = G.floor.tasks.find(y => y.by === null); if (x && C.taskClaim('me', x.id)) hold = { id: x.id, until: G.t + .5 + rnd() * 2.5 }; }
    } else hold = null;
    C.drainFx();
    now += 1000 / 60;
  }
  return { ...C.handOuts(), busyAtHandBack, backs, ended: !G.running };
}

const CASES = [
  ...[1, 2, 3, 4, 5, 6].flatMap(seed => [
    { seed, kind: 'roast', lv: 'newyear' }, { seed, kind: 'roast', lv: 'latenight' }, { seed, kind: 'roast' },
    { seed, kind: 'runner' }, { seed, kind: 'takeaway' },
    { seed, kind: 'floor', lv: 'newyear' }, { seed, kind: 'floor', lv: 'typhoon' }, { seed, kind: 'floor', lv: 'central' },
  ]),
];
test('no order or task handed to a player has prior progress (seats and 樓面, many seeds and levels)', () => {
  const by = {};
  for (const c of CASES) {
    const r = run(c), key = c.kind + (c.lv ? '@' + c.lv : '');
    assert.ok(r.ended, `${key} seed ${c.seed}: the shift ended`);
    assert.deepEqual(r.stale, [], `${key} seed ${c.seed}: begun work handed to the player`);
    const b = by[key] ??= { checked: 0, busy: 0, backs: 0 };
    b.checked += r.checked; b.busy += r.busyAtHandBack; b.backs += r.backs;
  }
  // the runs did exercise the case: hand-backs while the computer had work in hand, and every hand-out was checked
  for (const [key, b] of Object.entries(by)) {
    assert.ok(b.backs >= 30, `${key}: ${b.backs} hand-backs`);
    assert.ok(b.checked >= b.backs, `${key}: ${b.checked} hand-outs checked`);
    assert.ok(b.busy >= 3, `${key}: the computer had begun work at ${b.busy} hand-backs`);
  }
});
