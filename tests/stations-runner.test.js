// 傳菜 runner station core (src/stations-next/runner/core.ts), in memory: the bot plays whole shifts on many seeds at
// every difficulty while invariants are checked every step; the state survives a JSON hand-over mid-trip and the run
// continues identically; the referee seam (work events, carried results, nothing lost); purity (no clock, no
// Math.random). The 1:1 check against the original prototype page (same floor plans, same physics) is in
// stations-runner-page.test.js, which needs that page in a browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadStation, countingRng, ctxFor } from './helpers/stations-sim.js';

const core = await loadStation('runner');
const { runner } = core;
const maze = await loadStation('runner', 'maze');
const { TUNE } = maze;
const DIFFS = ['rookie', 'pro', 'ace'];
const STEP = 1 / 60;

/** Plays with the bot until the shift ends (or maxT); checks invariants every step. Returns { s, results, t }. */
function play(s, { rng = countingRng(1), t = 0, maxT = 900, bot = runner.bot.next, until = () => false, results = [] } = {}) {
  while (s.st !== 'end' && t < maxT && !until(s, t)) {
    const ctx = ctxFor(t, rng);
    const c = bot(s, ctx); if (c) results.push(...runner.command(s, c, ctx));
    results.push(...runner.step(s, STEP, ctx));
    t += STEP;
    invariants(s, results);
  }
  return { s, results, t };
}
function invariants(s, results) {
  const r = s.run;
  assert.equal(r.points, r.log.reduce((a, x) => a + x.pts, 0), 'points = sum of trip points');
  assert.ok(r.done + r.failed <= TUNE.orders || !s.selfFeed, 'never more than the shift orders');
  const o = s.trip;
  assert.ok(o.hp >= 0 && o.hp <= TUNE.hp, 'health in range');
  assert.ok(o.ball.x >= 0 && o.ball.x <= TUNE.grid.w && o.ball.y >= 0 && o.ball.y <= TUNE.grid.h, 'ball on the floor');
  assert.ok(Math.hypot(s.tilt.x, s.tilt.y) <= 1 + 1e-9, 'tilt within full tilt');
  const refs = results.flatMap(x => x.refs);
  assert.equal(new Set(refs).size, refs.length, 'no order carried or missed twice');
}

test('the bot completes shifts on many seeds at every difficulty, with consistent points and no lost orders', () => {
  for (const dk of DIFFS) {
    let perfect = 0;
    for (let k = 0; k < 8; k++) {
      const seed = 9000 + k * 131;
      const s = runner.init({ difficulty: dk, seed, players: 1 }, 's1');
      const { results } = play(s, { rng: countingRng(seed) });
      assert.equal(s.st, 'end', `${dk} seed ${seed}: shift ended`);
      assert.equal(s.run.done + s.run.failed, TUNE.orders, 'every order delivered or missed');
      const carried = results.filter(x => x.kind === 'carried'), missed = results.filter(x => x.kind === 'missed');
      assert.equal(carried.length, s.run.done, 'one carried result per delivered order');
      assert.equal(missed.length, s.run.failed, 'one missed result per missed order');
      assert.deepEqual([...carried, ...missed].flatMap(x => x.refs).sort(), Array.from({ length: TUNE.orders }, (_, i) => `w${i + 1}`).sort(), 'every order made is accounted once');
      assert.ok(s.run.done >= TUNE.orders - 1, `${dk} seed ${seed}: the bot delivers (${s.run.done})`);
      assert.equal(s.run.crashes, 0, 'the bot never knocks itself out');
      assert.ok(s.run.stars >= 1, 'the bot earns a star');
      if (s.run.done === TUNE.orders) perfect++;
    }
    assert.ok(perfect >= 6, `${dk}: most bot shifts deliver everything (${perfect}/8)`);
  }
});

test('a hand-over by value mid-trip (JSON) continues the run identically', () => {
  for (const dk of DIFFS) {
    const seed = 4242, s = runner.init({ difficulty: dk, seed, players: 1 }, 's1'), rng = countingRng(seed);
    // stop in the middle of a trip, with orders on the tray and the ball moving
    play(s, { rng, until: (st, t) => t > 25 && st.st === 'play' && Math.hypot(st.trip.ball.vx, st.trip.ball.vy) > 0.5 });
    const t0 = s.clock, copy = JSON.parse(JSON.stringify(s));
    assert.ok(runner.validate(copy), 'the copy passes validate');
    assert.equal(JSON.stringify(copy), JSON.stringify(s), 'the state is plain JSON');
    const a = play(s, { rng, t: t0, maxT: t0 + 60 }), b = play(copy, { rng: countingRng(seed, rng.n), t: t0, maxT: t0 + 60 });
    assert.equal(JSON.stringify(b.s), JSON.stringify(a.s), `${dk}: identical after 60 s`);
    assert.deepEqual(b.results, a.results);
  }
});

test('validate refuses broken hand-overs', () => {
  const s = runner.init({ difficulty: 'pro', seed: 5, players: 1 }, 's1');
  assert.ok(runner.validate(s));
  for (const bad of [null, 1, {}, { ...s, v: 2 }, { ...s, dk: 'boss' }, { ...s, st: 'nap' }, { ...s, trip: { ...s.trip, ball: null } }, { ...s, pass: [{ ref: 1 }] }, { ...s, trip: { ...s.trip, walkers: [] } }])
    assert.equal(runner.validate(bad), false);
});

test('referee seam: with selfFeed off the pass is filled by work events, every ref is carried once, a timeout puts orders back', () => {
  const seed = 77, rng = countingRng(seed);
  const s = runner.init({ difficulty: 'pro', seed, players: 2, selfFeed: false }, 's2');
  // nothing to carry: the runner waits at the pass, idle grows, the bot does nothing
  let res = play(s, { rng, maxT: 3 });
  assert.equal(s.st, 'pick');
  assert.equal(runner.status(s, ctxFor(3, rng)).waiting, 0);
  assert.ok(runner.status(s, ctxFor(3, rng)).idleFor > 2.5);
  assert.equal(runner.bot.next(s, ctxFor(3, rng)), null);
  // work arrives: two refs for table 8, one each for 3, 12 and 5
  const items = [{ ref: 'a1', table: 8 }, { ref: 'a2', table: 3 }, { ref: 'a3', table: 8 }, { ref: 'a4', table: 12 }, { ref: 'a5', table: 5 }];
  runner.onEvent(s, { kind: 'work', items }, ctxFor(3, rng));
  runner.onEvent(s, { kind: 'work', items: [{ ref: 'a1', table: 8 }, { bad: true }] }, ctxFor(3, rng));   // a resend and junk change nothing
  assert.deepEqual(s.trip.nos, [8, 3, 12], 'the trip offers the first three tables at the pass');
  assert.equal(runner.status(s, ctxFor(3, rng)).waiting, 5);
  // a trip that runs out of time: take two tables and never move
  runner.command(s, { t: 'pick', n: 2 }, ctxFor(3, rng));
  assert.deepEqual(s.pass.map(w => w.ref), ['a4', 'a5']);
  res = play(s, { rng, t: 3, bot: () => null, until: st => st.st === 'toast' });
  assert.equal(res.results.length, 0, 'nothing carried, nothing reported missed');
  assert.deepEqual(s.pass.map(w => w.ref).sort(), ['a1', 'a2', 'a3', 'a4', 'a5'], 'the timed-out orders are back on the pass');
  // the bot now carries everything; each ref exactly once, table by table
  res = play(s, { rng, t: res.t, maxT: res.t + 600, until: st => st.pass.length === 0 && st.st === 'pick' });
  const carried = res.results.filter(x => x.kind === 'carried');
  assert.deepEqual(carried.flatMap(x => x.refs).sort(), ['a1', 'a2', 'a3', 'a4', 'a5']);
  assert.deepEqual(carried.find(x => x.table === 8).refs.sort(), ['a1', 'a3'], 'one result per table, with all its refs');
  for (const x of carried) assert.ok(typeof x.at === 'number');
  assert.equal(s.st, 'pick');
  assert.notEqual(s.st, 'end', 'the referee ends the shift, not the station');
});

test('fed by the shop: oldest table to the nearest pocket, short breaks, the weight eases down, level 1 floors', () => {
  const seed = 31, rng = countingRng(seed);
  const s = runner.init({ difficulty: 'pro', seed, players: 2, selfFeed: false }, 's2');
  runner.onEvent(s, { kind: 'work', items: [{ ref: 'b1', table: 4 }, { ref: 'b2', table: 9 }, { ref: 'b3', table: 2 }] }, ctxFor(0, rng));
  const L = core.layoutOf(s), near = [0, 1, 2].reduce((a, b) => (L.targets[b].len < L.targets[a].len ? b : a), 0);
  assert.equal(core.tableNo(s, near), 4, 'the oldest table is labelled on the nearest pocket');
  runner.command(s, { t: 'pick', n: 3 }, ctxFor(0, rng));
  assert.equal(s.trip.orders[0].ti, near);
  assert.equal(s.trip.readyT, TUNE.fed.ready);
  assert.equal(s.trip.m, TUNE.mass[2], 'three tables: the full weight from the start');
  // deliver one by hand: the weight eases toward two tables' weight, not a jump
  s.trip.orders[0].done = true; s.st = 'play'; s.trip.readyT = 0;
  runner.step(s, 0.1, ctxFor(0, rng));
  assert.ok(s.trip.m < TUNE.mass[2] && s.trip.m > TUNE.mass[1], `eased, not stepped (${s.trip.m})`);
  runner.step(s, 3, ctxFor(0.1, rng));
  assert.ok(Math.abs(s.trip.m - TUNE.mass[1]) < 0.01 || s.st !== 'play', 'settles at two tables\' weight');
  // the level 1 tier: smaller and simpler than rookie on the same seeds, no walkers or puddles, always a plan
  for (let k = 1; k <= 40; k++) {
    const a = maze.gen(k * 977, 'first'), b = maze.gen(k * 977, 'rookie');
    assert.ok(a && b, 'a floor plan for every seed');
    assert.ok(a.walls.length < b.walls.length && a.walkers.length === 0 && a.puddles.length === 0, `seed ${k * 977}: simpler`);
  }
  const f = runner.init({ difficulty: 'pro', floor: 'first', seed, players: 2, selfFeed: false }, 's2');
  assert.ok(runner.validate(JSON.parse(JSON.stringify(f))), 'a level 1 hand-over validates');
});

test('the core is pure: no clock and no Math.random while it runs', () => {
  const keep = { random: Math.random, now: Date.now, perf: performance.now };
  Math.random = () => { throw new Error('Math.random in core'); };
  Date.now = () => { throw new Error('Date.now in core'); };
  performance.now = () => { throw new Error('performance.now in core'); };
  try {
    const s = runner.init({ difficulty: 'ace', seed: 31337, players: 1 }, 's1');
    play(s, { rng: countingRng(3), maxT: 40 });
    assert.ok(s.run.trip >= 1);
  } finally { Math.random = keep.random; Date.now = keep.now; performance.now = keep.perf; }
});

test('the tilt input is clamped to full tilt, a dead zone ignores a shaky hand, a bad number is refused', () => {
  const s = runner.init({ difficulty: 'rookie', seed: 1, players: 1 }, 's1'), rng = countingRng(1);
  runner.command(s, { t: 'pick', n: 1 }, ctxFor(0, rng));
  runner.command(s, { t: 'tilt', x: 3, y: 4 }, ctxFor(0, rng));
  runner.step(s, 2, ctxFor(0, rng));
  assert.ok(Math.abs(Math.hypot(s.tilt.x, s.tilt.y) - 1) < 1e-6, 'full tilt is 1');
  runner.command(s, { t: 'tilt', x: 0.01, y: 0.01 }, ctxFor(0, rng));
  runner.step(s, 1, ctxFor(1, rng));
  assert.ok(Math.hypot(s.tilt.x, s.tilt.y) < 1e-6, 'inside the dead zone counts as level');
  runner.command(s, { t: 'tilt', x: NaN, y: 0.5 }, ctxFor(1, rng));
  assert.ok(Number.isFinite(s.in.x));
});
