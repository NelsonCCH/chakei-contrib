// 樓面's budget: a bundled role is ONE player's total load (what one 伙記 had before the merge:
// seating, orders, clearing at the level's own pace) shared across all its tasks, times the players on the role
// (core/work/load.ts floorBudget / floorShare); the rest of the floor's tasks the computer takes at once
// (core/work/floor.ts floorShareNow, poolStep). Without it 樓面 played as a 4-5 person job.
// Guard: a mid player alone on 樓面 (tests/sim/floor.js `mid`: the oldest open task of any kind, at the load table's mid
// seconds) serves at least the share a mid 伙記 serves on the same level with the computer at 傳菜 / 外賣 (runShift, the
// human model), within TOL; two players on the floor get about twice one player's work.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshCore } from './core.js';
import { runFloor } from './floor.js';
import { runShift } from './shift.js';
import { LEVELS } from './levels.js';

const C = freshCore();
/** Served-share tolerance, points: the floor player may serve this much less than the 伙記 (seed noise over 2 seeds). */
const TOL = 5;
const SEEDS = [1, 2];

test('the budget: one 伙記\'s load per player, shared over every floor task; 2 players twice 1, capped at all of it', () => {
  const booked = { seat: [10, 26], order: [10, 80], clear: [8, 24], carry: [9, 86], bag: [4, 70], deliver: [2, 40], drink: [20, 116] };
  assert.equal(C.floorBudget(1, booked), 130, 'seat + order + clear seconds');
  assert.equal(C.floorBudget(2, booked), 260);
  const all = 26 + 80 + 24 + 86 + 70 + 40;   // the bar's drinks are not the floor's
  assert.ok(Math.abs(C.floorShare(1, booked) - 130 / all) < 1e-12);
  assert.ok(Math.abs(C.floorShare(2, booked) - 2 * C.floorShare(1, booked)) < 1e-12, '2 players: twice the share');
  assert.equal(C.floorShare(3, booked), 1, 'never more than all of it');
  assert.equal(C.floorShare(1, {}), 1, 'nothing booked (屋邨, a lesson): all of it');
  assert.deepEqual([...C.WAITER_TASKS], ['seat', 'order', 'clear']);
});

test('the pool\'s 送外賣 runs come back: every bag it rides out is dropped at the mid pace (none left on the road)', { timeout: 60000 }, () => {
  for (const seed of SEEDS) {
    const r = runFloor({ seed, lv: 'typhoon', players: 1, mid: true, sec: 180, shape: 'clean' });
    assert.deepEqual(r.errs, []);
    const t = r.S.t, ride = C.taskSec('deliver', 0);
    const stuck = r.F.out.filter(o => o.rider?.startsWith(C.POOL) && t - r.F.away[o.rider] > ride + 1);
    assert.deepEqual(stuck, [], `seed ${seed}: pool riders still out past ${ride} s`);
    assert.ok(Object.keys(r.F.away).every(k => !k.startsWith(C.POOL) || t - r.F.away[k] <= ride + 1), `seed ${seed}: a pool hand stays away`);
    assert.ok(r.F.stats.drops > 0, `seed ${seed}: some bags were delivered`);
  }
});

for (const lv of ['mongkok', 'typhoon', 'newyear']) {
  test(`${LEVELS[lv].name}: a mid player alone on 樓面 serves like a mid 伙記 (within ${TOL} points); 2 players do about twice the work`, { timeout: 120000 }, () => {
    let waiter = 0, solo = 0, sec = 0;
    const work = { 1: 0, 2: 0 };
    for (const seed of SEEDS) {
      const w = runShift({ seed, station: 'waiter', slot: LEVELS[lv].slot, lv, roles: true, diff: 'pro', human: 'mid' });
      assert.deepEqual(w.errs, []);
      waiter += w.cust.servedPct / SEEDS.length; sec = w.C.CFG.gameSec;
      for (const n of [1, 2]) {
        const r = runFloor({ seed, lv, players: n, mid: true, count: true, sec, shape: 'clean' });
        assert.deepEqual(r.errs, [], `${lv} ${n} players seed ${seed}`);
        if (n === 1) solo += r.cust.servedPct / SEEDS.length;
        work[n] += r.phones.reduce((a, p) => a + (p.busy ?? 0), 0) / SEEDS.length;
      }
    }
    console.log(`${lv}: 伙記 served ${waiter.toFixed(1)}%, 樓面 alone ${solo.toFixed(1)}%; floor work 1 player ${work[1].toFixed(0)} s, 2 players ${work[2].toFixed(0)} s (x${(work[2] / work[1]).toFixed(2)})`);
    assert.ok(solo >= waiter - TOL, `樓面 alone ${solo.toFixed(1)}% vs 伙記 ${waiter.toFixed(1)}%`);
    assert.ok(work[1] / sec < 0.9, `one player is not flat out: ${(100 * work[1] / sec).toFixed(0)}% of the shift`);
    // with 2 floor seats (旺角) two players are the whole floor: no budget, all of its work (more than twice one)
    const k = work[2] / work[1];
    if (C.workSpecFor(lv).floor > 2) assert.ok(k >= 1.6 && k <= 2.6, `2 players: x${k.toFixed(2)} one player's work`);
    else assert.ok(k >= 1.6, `2 players on a 2-seat floor do all of it: x${k.toFixed(2)}`);
  });
}
