// The playtest pace sliders (core/playtest/): 5 is today's setting exactly; a moved slider scales its
// station's customer flow and patience, and the extra seats' own knobs (runner floor, roast / takeaway tier,
// takeaway people per order) follow it; a teammate's `pace` result sets only its own seat's slider.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshCore, simPort } from './core.js';

/** A shop (solo at `kind`, or the waiter) with these sliders set before the shift, played `sec` seconds. */
function shop(kind, paces = {}, sec = 3) {
  const C = freshCore(), port = simPort(C);
  C.setRng(C.mulberry32(7)); C.setPort(port);
  C.setStation('waiter'); C.setSlot('lunch'); C.setDiff('pro');
  for (const [k, v] of Object.entries(paces)) C.setPace(k, v);
  C.newGame(); C.resetClock();
  if (kind) C.soloSeatStart(kind, 0);
  let now = 0;
  for (let i = 0; i < sec * 60; i++) {
    C.advance(1 / 60, h => kind ? C.coopStep(h) : C.CORE_HOOK.update(h), () => C.G.running);
    if (kind) C.coopFrame(now);
    now += 1000 / 60;
  }
  return C;
}

test('the mapping: 5 is today exactly, x1.15 a step, tiers move one per two steps', () => {
  const C = freshCore();
  assert.equal(C.paceK(5), 1);
  assert.equal(C.gapMul('waiter'), 1); assert.equal(C.patMul('till'), 1);
  assert.ok(Math.abs(C.paceK(10) - 1.15 ** 5) < 1e-12);
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(C.tierShift), [-2, -2, -1, -1, 0, 0, 1, 1, 2, 2]);
  assert.equal(C.runnerFloor('pro', 1), 'first'); assert.equal(C.runnerFloor('first', 10), 'pro');
  assert.deepEqual(C.roastKnob(5), { pcs: 0, snap: 1 }, 'roast at 5: today');
  assert.equal(C.roastKnob(10).pcs, 5); assert.ok(Math.abs(C.roastKnob(10).snap - 1 / 1.15 ** 5) < 1e-12, 'roast at 10: five more pieces, snap / 1.15^5');
  assert.deepEqual([5, 7, 9].map(v => C.packPeople(v)), [1, 2, 3]);
});

test('the waiter slider: customers come closer together and wait less, by the same factor', () => {
  const a = shop(null), b = shop(null, { waiter: 10 }), r = () => .5;
  const k = b.spawnGap(60, r) / a.spawnGap(60, r);
  assert.ok(Math.abs(k - 1 / 1.15 ** 5) < 1e-9, 'spawn gap scaled: ' + k);
  const ga = a.makeGroup(undefined, false, () => .3), gb = b.makeGroup(undefined, false, () => .3);
  assert.ok(Math.abs(gb.max / ga.max - 1 / 1.15 ** 5) < 1e-9, 'queue patience scaled');
});

test('extra seats: the station-own knobs follow the slider, and back at 5 are today again', () => {
  const r0 = shop('roast').roastState();
  assert.equal(r0.tier, 1, 'untouched: 熟手 cutting tier'); assert.deepEqual(r0.knob, { pcs: 0, snap: 1 }, 'untouched: no knob');
  const r1 = shop('roast', { roast: 1 }).roastState(), r10 = shop('roast', { roast: 10 }).roastState();
  assert.equal(r1.tier, 1, 'the slider keeps the tier'); assert.equal(r1.knob.pcs, -4); assert.ok(r1.knob.snap > 1.7, 'wider snap');
  assert.equal(r10.knob.pcs, 5); assert.ok(r10.knob.snap < 0.5, 'about half the snap');
  const r = shop('runner', { runner: 1 });
  assert.equal(r.runnerState().dk, 'first', 'the floor plan is the simple tier');
  const t = shop('takeaway', { takeaway: 10 }, 40);
  assert.equal(t.takeawayState().knot, 10, "knot tier: 熟手's 5 plus five steps");
  const packs = t.G.groups.filter(g => g.via === 'pack');
  assert.ok(packs.length > 0 && packs.every(g => g.items.length >= 3), 'orders for three people: ' + packs.map(g => g.items.length));
  t.setPace('takeaway', 5); t.paceStep();
  assert.equal(t.takeawayState().knot, 5, "back at 5: today's knot tier");
});

test('co-op: a pace result sets only the slider of the seat that sent it', () => {
  const C = shop('roast');
  assert.equal(C.isResult({ k: 'pace', st: 'roast', v: 3 }), true);
  assert.equal(C.isResult({ k: 'pace', st: 'roast', v: 11 }), false);
  assert.equal(C.applyResult('waiter', { k: 'pace', st: 'roast', v: 3 }), false);
  assert.equal(C.paceOf('roast'), 5);
  assert.equal(C.applyResult('roast', { k: 'pace', st: 'roast', v: 3 }), true);
  assert.equal(C.paceOf('roast'), 3);
});
