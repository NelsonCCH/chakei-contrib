// 送外賣 traffic guard: faster traffic in rows of 1-2 vehicles, quick runs and
// breathing room, and ALWAYS a reachable open lane.
// - The numbers: closing speed 2-3x the playtested build's at every gear; the guard's skilled timing is the human model's.
// - The generator, checked independently: many seeds on every tier and bag load, every row the road made is 1-2
//   vehicles with an open lane, and every open lane a rider can be in as a row goes by reaches an open lane of the next
//   row in the gap (and in sight), for a skilled rider at the top gear with that many bags.
// - The proof by riding: a skilled rider (human.js PROFILES.skilled, exact timing, seeing only what the screen shows)
//   rides every tier at every gear cap including the rocket, with 1 and 3 bags: never a crash.
// - Not regular: gaps vary (quick runs and breathing room), rows are 1 or 2 vehicles.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadStation, countingRng, ctxFor } from '../helpers/stations-sim.js';
import { PROFILES } from './human.js';
import { makeRider, rideRun, blockedOf } from './deliver-rider.js';
import { runFloor } from './floor.js';

const M = await loadStation('deliver');
const { TUNE, TOP } = M;
const OLD_CLOSE = [2, 5, 8, 11.5, 15, 21];   // the playtested build's closing speeds (gears 5..24 m/s, traffic 3 m/s)

test('traffic closes in 2-3x faster at every gear; the guard uses the human model\'s skilled timing', () => {
  TUNE.gears.forEach((v, g) => {
    const k = (v - TUNE.vTraffic) / (OLD_CLOSE[g] ?? 1);
    assert.ok(k >= 2 && k <= 3, `gear ${g}: closing ${v - TUNE.vTraffic} m/s is ${k.toFixed(2)}x the old ${OLD_CLOSE[g]}`);
  });
  assert.equal(TUNE.reach.react, PROFILES.skilled.react, 'react = human.js skilled react');
  assert.ok(Math.abs(TUNE.reach.tap - 1 / PROFILES.skilled.stream) < 1e-9, 'tap gap = 1 / human.js skilled stream');
  // a one-lane move fits the sight limit even at the rocket with 3 bags (so every row can be made reachable)
  assert.ok(Number.isFinite(M.reachGap(1, 3)), 'one lane at the rocket with 3 bags is reachable');
});

// independent of core's reachGap: the same two limits written out from the tuning and the human model
const V = TUNE.gears[TOP] - TUNE.vTraffic, H = PROFILES.skilled;
const slide = bags => 1 / (TUNE.laneRate * TUNE.bags.lane[bags - 1]);
const canMove = (d, gap, bags) => d === 0 || ((TUNE.reach.view - TUNE.riderLen / 2) / V >= H.react + d * slide(bags) && (gap - TUNE.riderLen) / V >= 1 / H.stream + d * slide(bags));
/** Lanes a rider may be in as a row goes by: the lanes no steady (non-changing) vehicle holds. */
const startsOf = r => [0, 1, 2].filter(L => !r.cars.some(c => c.plan < 0 && c.lane === L));

test('the generator: every row has an open lane, reachable from wherever the row before left the rider (all tiers, 1-3 bags, many seeds)', () => {
  const stats = { rows: 0, pairs: 0, chg: 0, gaps: [] };
  for (let tier = 1; tier <= 8; tier++) for (let bags = 1; bags <= 3; bags++) for (let k = 0; k < 12; k++) {
    const seed = 9000 + tier * 131 + bags * 17 + k * 7, rng = countingRng(seed);
    // the rocket rider: the road is made the same whatever the rider does, so ride it hard and look at every row
    const r = rideRun(M, { tier, bags, seed, rng, ctxFor, rider: makeRider(M, { profile: 'skilled', gear: TOP, exact: true }) });
    assert.ok(r.rows.length > 10, `tier ${tier} bags ${bags} seed ${seed}: a road with traffic (${r.rows.length} rows)`);
    r.rows.forEach((row, i) => {
      const blocked = blockedOf(row), free = [0, 1, 2].filter(L => !blocked.has(L));
      assert.ok(row.cars.length >= 1 && row.cars.length <= 2, `row of ${row.cars.length}`);
      assert.ok(free.length >= 1, `tier ${tier} seed ${seed} row ${i}: an open lane`);
      if (row.cars.length === 2) assert.equal(free.length, 1, 'a 2-vehicle row leaves exactly one lane');
      stats.rows++; if (row.cars.length === 2) stats.pairs++; if (row.cars.some(c => c.plan >= 0)) stats.chg++;
      const prev = r.rows[i - 1];
      if (!prev) return;
      const gap = row.front - prev.rear;
      assert.ok(gap >= TUNE.reach.minGap - 1e-6, `rows do not overlap (gap ${gap.toFixed(2)})`);
      stats.gaps.push(gap);
      for (const a of startsOf(prev)) {
        assert.ok(free.some(b => canMove(Math.abs(a - b), gap, bags)),
          `tier ${tier} bags ${bags} seed ${seed} row ${i}: from lane ${a} no open lane of [${free}] is reachable in ${gap.toFixed(1)} m at the rocket`);
      }
    });
    assert.equal(r.crashes, 0, `tier ${tier} bags ${bags} seed ${seed}: the skilled rider at the rocket never crashes (${r.crashes})`);
  }
  // not regular: both kinds of rows, quick gaps and breathing room
  const g = stats.gaps, mean = g.reduce((a, b) => a + b, 0) / g.length, sd = Math.sqrt(g.reduce((a, b) => a + (b - mean) ** 2, 0) / g.length);
  const quick = g.filter(x => x < 16).length / g.length, room = g.filter(x => x > 25).length / g.length;
  assert.ok(stats.pairs / stats.rows > 0.2 && stats.pairs / stats.rows < 0.7, `2-vehicle rows ${(100 * stats.pairs / stats.rows).toFixed(0)}%`);
  assert.ok(quick > 0.2 && room > 0.3 && sd / mean > 0.4, `gaps vary: ${(100 * quick).toFixed(0)}% quick, ${(100 * room).toFixed(0)}% roomy, cv ${(sd / mean).toFixed(2)}`);
  console.log(`# rows ${stats.rows}: ${(100 * stats.pairs / stats.rows).toFixed(0)}% pairs, ${(100 * stats.chg / stats.rows).toFixed(0)}% lane changers; gap mean ${mean.toFixed(1)} m sd ${sd.toFixed(1)}, ${(100 * quick).toFixed(0)}% < 16 m`);
});

test('a skilled rider never crashes at any gear cap, tier or bag load (sight of the smallest screen, human-model timing)', () => {
  for (let tier = 1; tier <= 8; tier++) for (const bags of [1, 3]) for (let gear = 1; gear <= TOP; gear++) for (let k = 0; k < 2; k++) {
    const seed = 400 + tier * 53 + bags * 11 + gear * 5 + k, rng = countingRng(seed);
    const r = rideRun(M, { tier, bags, seed, rng, ctxFor, rider: makeRider(M, { profile: 'skilled', gear, exact: true }) });
    assert.equal(r.crashes, 0, `tier ${tier}, ${bags} bags, gear cap ${gear}, seed ${seed}: ${r.crashes} crashes`);
    assert.equal(r.drops.length, bags, 'every bag dropped');
  }
});

test('the rocket pays: a clean rocket run drops its bags on the rocket and beats gear 4 by a clear margin', () => {
  for (const tier of [1, 4, 8]) {
    const seed = 77 + tier, top = rideRun(M, { tier, bags: 3, seed, rng: countingRng(seed), ctxFor, rider: makeRider(M, { gear: TOP, exact: true }) });
    const g4 = rideRun(M, { tier, bags: 3, seed, rng: countingRng(seed), ctxFor, rider: makeRider(M, { gear: 4, exact: true }) });
    assert.equal(top.fast, 3, `tier ${tier}: all three bags on the rocket`);
    assert.equal(g4.fast, 0, 'none at gear 4');
    assert.ok(top.secs < g4.secs * 0.85, `tier ${tier}: rocket ${top.secs.toFixed(1)} s vs gear 4 ${g4.secs.toFixed(1)} s`);
  }
  // the gamble: a rocket rider who never steers crashes, and a leg with a crash pays no rocket tip
  const blind = (s) => (s.st === 'ride' && s.gear < TOP && s.gearCd <= 0 ? { t: 'gear' } : null);
  let legs = 0;
  for (let k = 0; k < 6; k++) {
    const seed = 300 + k, r = rideRun(M, { tier: 6, bags: 3, seed, rng: countingRng(seed), ctxFor, rider: blind });
    assert.ok(r.crashes > 0, 'the blind rocket crashes');
    let from = 0;
    for (const d of r.drops) {
      const crashed = r.out.some(x => x.kind === 'crash' && x.at >= from && x.at <= d.at);
      if (crashed) { legs++; assert.equal(d.fast, false, `seed ${seed}: a leg with a crash pays no rocket tip`); }
      from = d.at;
    }
  }
  assert.ok(legs >= 6, `legs with a crash were checked (${legs})`);
});

test('the referee pays the rocket tip: a hot bag dropped `fast` tips x2 on top of the bag bonus', () => {
  const got = {};
  const each = ({ room }) => {
    const C = room.C, R = C.G, F = R.floor;
    if (!F || !R.running || R.t < 20 || got.done) return;
    for (const [k, fast] of [[0, false], [1, true]]) {
      const gid = 95001 + k;
      F.out.push({ gid, no: 71 + k, cold: R.t + 120, items: 2, rider: null });
      const tips = R.tips ?? 0;
      assert.ok(C.rideOut('rocketeer', [gid]) && C.dropOff('rocketeer', gid, fast) && C.rideBack('rocketeer'), 'ride, drop, back');
      got[fast ? 'fast' : 'slow'] = (R.tips ?? 0) - tips;
    }
    got.done = true;
  };
  runFloor({ seed: 11, players: 3, shape: ['lan', 'lan', 'lan'], sec: 25, each });
  assert.equal(got.slow, M.TUNE.bags.bonus[0] * 5, 'a plain 1-bag drop pays DELIVER_TIP');
  assert.equal(got.fast, got.slow * TUNE.rocket.tip, 'on the rocket: x2');
  assert.ok(M.TUNE.rocket.tip >= 2, 'the rocket\'s reward is clearly higher');
});
