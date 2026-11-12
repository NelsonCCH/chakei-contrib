// 傳菜 work arrives steadily. A 屋邨 co-op shift at the runner, seen in play: a dish at 15 s and at 50 s,
// nothing for 43 s, then the pass climbed to 6. Two causes: the shop's arrival curve (8.5 s base before 35 s and after
// 135 s, 6 s between) and, on 中環, tables that order drinks only (drinks skip the pass). With a person carrying the
// dishes (the 傳菜 seat, or a 樓面 floor seat) the base is flat (customers.ts RUNNER_BASE, the same expected
// number of groups) and every table has a dish (work.ts workDine). Guards: the longest wait between two dishes reaching
// the pass, the wait for the first one, and the most dishes on the pass at once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runSeat } from './xseat.js';
import { runFloor } from './floor.js';

/** Bounds at the human mid profile (seconds, dishes). The pass holds 6 (PASS_CAP); before the fix these runs reached 41 s,
 *  a first dish at 38 s, and 6. */
export const RUNNER_FLOW = { maxGap: 30, first: 22, peak: 5 };
/** 中環 co-op is a 樓面 level: one person on the floor (the floor sims' brain, which seats and takes orders
 *  too, slower than the human model), the computer on the other floor seat. Before the fix: first dish up to 41 s. */
export const FLOOR_FLOW = { maxGap: 34, first: 26, peak: 5 };
const SEEDS = [1, 2, 3, 4];

function watch() {
  const seen = new Set(), at = [];
  let peak = 0;
  return {
    at, get peak() { return peak; },
    probe(C) {
      for (const g of C.G.groups) {
        if (g.take || g.table === null) continue;
        for (const x of C.linesOf(g)) if (x.l.passT !== undefined) { const k = `${g.id}:${x.dest}:${x.i}`; if (!seen.has(k)) { seen.add(k); at.push(x.l.passT); } }
      }
      peak = Math.max(peak, C.passCount());
    },
  };
}
function check(name, w, b = RUNNER_FLOW) {
  const s = [...w.at].sort((a, b) => a - b);
  assert.ok(s.length >= 8, `${name}: only ${s.length} dishes reached the pass`);
  let gap = 0;
  for (let i = 1; i < s.length; i++) gap = Math.max(gap, s[i] - s[i - 1]);
  assert.ok(s[0] <= b.first, `${name}: the first dish came at ${s[0].toFixed(1)} s (bound ${b.first})`);
  assert.ok(gap <= b.maxGap, `${name}: ${gap.toFixed(1)} s with nothing new on the pass (bound ${b.maxGap}); dishes at ${s.map(x => x.toFixed(0)).join(' ')}`);
  assert.ok(w.peak <= b.peak, `${name}: ${w.peak} dishes on the pass at once (bound ${b.peak})`);
  return { gap: +gap.toFixed(1), first: +s[0].toFixed(1), peak: w.peak, n: s.length };
}

for (const lv of ['estate', 'central']) {
  test(`${lv}, solo seat at 傳菜 (mid player): dishes reach the pass steadily`, () => {
    const out = [];
    for (const seed of SEEDS) {
      const w = watch();
      const r = runSeat({ seed, kind: 'runner', lv, human: 'mid', each: C => w.probe(C) });
      assert.deepEqual(r.errs, []);
      out.push(check(`${lv} solo seed ${seed}`, w));
    }
    console.log(lv, 'solo', JSON.stringify(out));
  });
}
// The estate co-op run with a person at a 傳菜 seat is gone: 屋邨 is a 樓面 level now, with
// no 傳菜 seat and no pass (傳菜 joins the floor at level 2); the 中環 floor run below covers a room's pass.
test('central, co-op room (樓面) with one person on the floor: dishes reach the pass steadily', () => {
  const out = [];
  for (const seed of SEEDS) {
    const w = watch();
    const r = runFloor({ seed, lv: 'central', players: 1, sec: 180, each: ({ room }) => w.probe(room.C) });
    assert.deepEqual(r.errs, []);
    out.push(check(`central floor seed ${seed}`, w, FLOOR_FLOW));
  }
  console.log('central floor', JSON.stringify(out));
});
