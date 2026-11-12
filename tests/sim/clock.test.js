// The fixed-step clock (core/referee/clock.ts): real time in, whole 1/60 s steps out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshCore } from './core.js';
import { runShift } from './shift.js';

test('frames of any length become whole fixed steps; a stall plays at most 0.25 s; leftovers carry over', () => {
  const C = freshCore(), hs = [];
  const step = h => { hs.push(h); };
  assert.equal(C.advance(1 / 60, step), 1);
  assert.equal(C.advance(1 / 120, step), 0);           // half a step waits...
  assert.equal(C.advance(1 / 120, step), 1);           // ...and is played with the next half
  assert.equal(C.advance(1, step), 15);                 // a 1 s stall: 0.25 s of it, 15 steps
  assert.ok(hs.every(h => h === C.STEP));
  assert.equal(C.advance(-5, step), 0);                 // a clock that runs backwards (rAF before start) plays nothing
  C.resetClock(); assert.equal(C.clockLeft(), 0);
  // the background catch-up (net.ts hostTick) allows longer: 5 s
  assert.equal(C.advance(10, step, () => true, 5), 300);
  // stops when the shift does, and forgets the rest
  let n = 0; assert.equal(C.advance(.2, () => { n++; }, () => n < 3), 3); assert.equal(C.clockLeft(), 0);
});

test('the same seed plays the same shift at 30, 60, 144 fps and on a stuttering phone (the computer at every station)', () => {
  // no player (bot: false), so only the rules run: the shift must not depend on how the frames fall
  const rates = [() => 1 / 30, () => 1 / 60, () => 1 / 144, r => r() < .9 ? 1 / 60 : .2];
  for (const seed of [11, 12, 13]) {
    const ends = rates.map(f => { const r = runShift({ seed, station: 'waiter', slot: 'lunch', bot: false, frames: f }); assert.deepEqual(r.errs, []); return JSON.stringify(r.C.G, (k, v) => typeof v === 'function' ? undefined : v); });
    for (const e of ends.slice(1)) assert.equal(e, ends[0], `seed ${seed}: the end state depends on the frame rate`);
  }
});
