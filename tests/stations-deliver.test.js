// 送外賣 deliver station core (src/stations-next/deliver/core.ts), in memory: the bot rides whole runs on many seeds and
// tiers (every order dropped once, one `back` per run); run time grows with the orders but a 3-order run beats three
// 1-order runs; a crash puts the gear back to 0; the referee seam (run events, queue, cancel, cold orders); purity (no
// clock, no Math.random); the state survives a JSON hand-over mid-run and the run continues identically; the bag trade and the
// door picker of multi-bag runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadStation, countingRng, ctxFor } from './helpers/stations-sim.js';

const core = await loadStation('deliver');
const botMod = await loadStation('deliver', 'bot');
const { deliver, TUNE, CRASH_T, init } = core;
const STEP = 1 / 60;

/** Rides with a bot until `until` (default: the rider is back) or maxT; returns { results, t }. */
function ride(s, { rng, t = 0, maxT = t + 400, bot = deliver.bot.next, until = st => st.st === 'home' || st.st === 'idle', results = [] } = {}) {
  while (t < maxT) {
    const ctx = ctxFor(t, rng);
    const c = bot(s, ctx); if (c) results.push(...deliver.command(s, c, ctx));
    results.push(...deliver.step(s, STEP, ctx));
    t += STEP;
    invariants(s);
    if (until(s, t)) break;
  }
  return { results, t };
}
function invariants(s) {
  assert.ok(s.gear >= 0 && s.gear < TUNE.gears.length, 'gear in range');
  assert.ok(s.x >= 0 && s.x <= 2 && Number.isInteger(s.lane) && s.lane >= 0 && s.lane <= 2, 'on the road');
  if (s.st === 'crash') assert.equal(s.gear, 0, 'no gear while down');
  // one lane is always open: no three vehicles side by side
  for (const c of s.cars) {
    const near = s.cars.filter(d => Math.abs(d.y - c.y) < (d.len + c.len) / 2);
    const lanes = new Set(near.flatMap(d => [d.lane, d.to]));
    assert.ok(lanes.size < 3, 'never a wall of traffic');
  }
}
const runEv = (orders) => ({ kind: 'run', orders });

test('the bot rides runs on many seeds and tiers: every order dropped exactly once, back once per run', () => {
  for (let tier = 1; tier <= 8; tier++) {
    for (let k = 0; k < 4; k++) {
      const seed = 500 + tier * 97 + k * 13, rng = countingRng(seed), n = 1 + (k % 3);
      const s = init({ difficulty: 'pro', seed, players: 2, tier, selfFeed: false });
      assert.equal(deliver.status(s, ctxFor(0, rng)).waiting, 0, 'nothing to do yet');
      const orders = Array.from({ length: n }, (_, i) => ({ gid: 100 + i, no: 20 + i, left: 60 }));
      deliver.onEvent(s, runEv(orders), ctxFor(0, rng));
      assert.equal(s.st, 'ride');
      assert.equal(deliver.status(s, ctxFor(0, rng)).waiting, 1, 'waiting while a run is on');
      const { results } = ride(s, { rng });
      const dropped = results.filter(r => r.kind === 'dropped'), back = results.filter(r => r.kind === 'back');
      assert.equal(back.length, 1, `tier ${tier} seed ${seed}: back once`);
      assert.deepEqual(dropped.map(r => r.gid).sort(), orders.map(o => o.gid).sort(), 'each order dropped exactly once');
      assert.ok(results.indexOf(back[0]) > results.indexOf(dropped.at(-1)), 'back after the last drop');
      assert.equal(back[0].crashes, results.filter(r => r.kind === 'crash').length, 'back counts the crashes');
      assert.ok(Math.abs(back[0].secs - s.run.t) < 1e-9 && back[0].secs > 10, 'back carries the run time');
      assert.equal(s.st, 'home');
      assert.equal(deliver.status(s, ctxFor(0, rng)).waiting, 0, 'not waiting once back');
    }
  }
});

test('a run grows with its orders, but three orders take well under three one-order runs', () => {
  for (const tier of [2, 4, 7]) {
    const mean = n => {
      let sum = 0;
      for (let k = 0; k < 6; k++) {
        const seed = 70 + k * 31 + tier, rng = countingRng(seed), s = init({ difficulty: 'pro', seed, players: 1, tier });
        deliver.command(s, { t: 'start', n }, ctxFor(0, rng));
        const { results } = ride(s, { rng });
        sum += results.find(r => r.kind === 'back').secs;
      }
      return sum / 6;
    };
    const one = mean(1), two = mean(2), three = mean(3);
    assert.ok(one < two && two < three, `tier ${tier}: ${one.toFixed(1)} < ${two.toFixed(1)} < ${three.toFixed(1)}`);
    assert.ok(three < 2 * one, `tier ${tier}: three orders (${three.toFixed(1)} s) < two one-order runs (${(2 * one).toFixed(1)} s)`);
    assert.ok(one > 20 && one < 40, `tier ${tier}: a one-order run at the bot's mid pace is about 30 s (${one.toFixed(1)})`);
  }
});

test('a crash: the result, gear back to 0, the pick-up, then riding again from slow; a careless rocket rider crashes', () => {
  const rng = countingRng(9), s = init({ difficulty: 'pro', seed: 9, players: 1 });
  deliver.command(s, { t: 'start', n: 1 }, ctxFor(0, rng));
  for (let g = 0; g < 4; g++) { deliver.command(s, { t: 'gear' }, ctxFor(0, rng)); deliver.step(s, 0.2, ctxFor(0, rng)); }
  assert.equal(s.gear, 4, 'four taps, four gears');
  deliver.command(s, { t: 'gear' }, ctxFor(0, rng)); deliver.command(s, { t: 'gear' }, ctxFor(0, rng));
  assert.equal(s.gear, 5, 'a second tap inside the cooldown is ignored');
  s.cars = [{ id: 1, k: 'bus', len: TUNE.kinds.bus.len, lane: s.lane, to: s.lane, x: s.lane, y: s.pos + 9, tele: 0, dec: true, col: 0 }];
  const res = deliver.step(s, 0.5, ctxFor(1, rng));
  assert.deepEqual(res.map(r => r.kind), ['crash']);
  assert.equal(s.st, 'crash'); assert.equal(s.gear, 0); assert.equal(s.run.crashes, 1);
  assert.deepEqual(deliver.command(s, { t: 'gear' }, ctxFor(1, rng)), []); assert.equal(s.gear, 0, 'no gears while down');
  deliver.step(s, CRASH_T + 0.05, ctxFor(1.5, rng));
  assert.equal(s.st, 'ride'); assert.equal(s.gear, 0, 'back on the bike at gear 0');
  assert.ok(s.safeT > 0, 'a short blink of safety');
  // the bot at the rocket with slow reactions on the densest tier
  let crashes = 0;
  for (let k = 0; k < 4; k++) {
    const seed = 300 + k, r = countingRng(seed), b = botMod.makeDeliverBot({ gear: 5, skill: 0.3 });
    const t = init({ difficulty: 'ace', seed, players: 1, tier: 8 });
    deliver.command(t, { t: 'start', n: 1 }, ctxFor(0, r));
    crashes += ride(t, { rng: r, bot: b }).results.filter(x => x.kind === 'crash').length;
  }
  assert.ok(crashes >= 4, `crashes happen (${crashes})`);
});

test('referee seam: orders sorted by urgency, cold when late, a run during a run waits, cancel ends it', () => {
  const rng = countingRng(4), s = init({ difficulty: 'rookie', seed: 4, players: 2, selfFeed: false });
  deliver.command(s, { t: 'start', n: 2 }, ctxFor(0, rng));
  assert.equal(s.st, 'idle', 'no made-up orders when the shop feeds the station');
  deliver.onEvent(s, runEv([{ gid: 1, no: 11, left: 80 }, { gid: 2, no: 12, left: -1 }, { bad: 1 }]), ctxFor(0, rng));
  assert.deepEqual(s.run.orders.map(o => o.gid), [2, 1], 'the one going cold first is dropped first');
  deliver.onEvent(s, runEv([{ gid: 3, no: 13, left: 50 }]), ctxFor(0, rng));
  assert.equal(s.queue.length, 1, 'a run sent while riding waits');
  const a = ride(s, { rng });
  assert.deepEqual(a.results.filter(r => r.kind === 'dropped').map(r => [r.gid, r.cold]), [[2, true], [1, false]]);
  assert.equal(s.st, 'home');
  assert.equal(deliver.status(s, ctxFor(a.t, rng)).waiting, 1, 'still waiting: a run is queued');
  const b = ride(s, { rng, t: a.t, until: st => st.st === 'ride' });
  assert.ok(b.t - a.t >= TUNE.homeT - 0.05, 'the queued run starts after a short stop at the shop');
  assert.deepEqual(s.run.orders.map(o => o.gid), [3]);
  ride(s, { rng, t: b.t, until: st => st.pos > 60 });
  deliver.onEvent(s, { kind: 'cancel' }, ctxFor(0, rng));
  assert.equal(s.st, 'idle'); assert.equal(s.run, null); assert.equal(deliver.status(s, ctxFor(0, rng)).waiting, 0);
  assert.deepEqual(deliver.step(s, 1, ctxFor(0, rng)), [], 'nothing after cancel');
});

test('a hand-over by value mid-run (JSON) continues the run identically', () => {
  for (const tier of [3, 8]) {
    const seed = 4242 + tier, s = init({ difficulty: 'pro', seed, players: 1, tier }), rng = countingRng(seed);
    const bot = botMod.makeDeliverBot({ gear: 5, skill: 0.6 });
    deliver.command(s, { t: 'start', n: 3 }, ctxFor(0, rng));
    const a0 = ride(s, { rng, bot, until: st => st.pos > 120 && st.cars.length > 1 });
    const copy = JSON.parse(JSON.stringify(s));
    assert.ok(deliver.validate(copy), 'the copy passes validate');
    assert.equal(JSON.stringify(copy), JSON.stringify(s), 'the state is plain JSON');
    const n0 = rng.n;
    const a = ride(s, { rng, bot, t: a0.t }), b = ride(copy, { rng: countingRng(seed, n0), bot, t: a0.t });
    assert.equal(JSON.stringify(b.results), JSON.stringify(a.results), `tier ${tier}: the same results`);
    assert.equal(JSON.stringify(copy), JSON.stringify(s), `tier ${tier}: the same state at the end`);
    assert.ok(a.results.some(r => r.kind === 'back'));
  }
});

test('validate refuses broken hand-overs', () => {
  const rng = countingRng(5), s = init({ difficulty: 'pro', seed: 5, players: 1 });
  deliver.command(s, { t: 'start', n: 2 }, ctxFor(0, rng));
  ride(s, { rng, until: st => st.cars.length > 0 });
  assert.ok(deliver.validate(JSON.parse(JSON.stringify(s))));
  for (const bad of [null, 1, {}, { ...s, v: 2 }, { ...s, st: 'nap' }, { ...s, gear: 9 }, { ...s, lane: 3 }, { ...s, run: null }, { ...s, cars: [{ id: 1 }] },
    { ...s, run: { ...s.run, orders: [{ gid: 1 }] } }, { ...s, queue: [[{ gid: 'x' }]] }, { ...s, pos: NaN }])
    assert.equal(deliver.validate(bad), false, JSON.stringify(bad)?.slice(0, 60));
});

test('the core is pure: no clock and no Math.random while it runs', () => {
  const keep = { random: Math.random, now: Date.now, perf: performance.now };
  Math.random = () => { throw new Error('Math.random in core'); };
  Date.now = () => { throw new Error('Date.now in core'); };
  performance.now = () => { throw new Error('performance.now in core'); };
  try {
    const rng = countingRng(3), s = init({ difficulty: 'ace', seed: 3, players: 1 });
    deliver.command(s, { t: 'start', n: 3 }, ctxFor(0, rng));
    const { results } = ride(s, { rng, bot: botMod.makeDeliverBot({ gear: 5, skill: 0.5 }) });
    assert.ok(results.some(r => r.kind === 'back'));
  } finally { Math.random = keep.random; Date.now = keep.now; performance.now = keep.perf; }
});

test('the bag trade: 3 bags pay a bigger tip but the bike slides lanes and steps up gears slower than with 1', () => {
  assert.deepEqual([1, 2, 3].map(core.bagBonus), [1, 1.3, 1.6]);
  assert.equal(core.bagBonus(5), 1.6, 'clamped to 3 bags');
  const handling = n => {
    const rng = countingRng(9), s = init({ difficulty: 'rookie', seed: 9, players: 1, tier: 1 });
    deliver.command(s, { t: 'start', n }, ctxFor(0, rng));
    let t = 0;
    while (s.st !== 'ride' && t < 10) { deliver.step(s, STEP, ctxFor(t, rng)); t += STEP; }
    assert.equal(s.st, 'ride'); assert.equal(core.bagsOf(s), n);
    deliver.command(s, { t: 'gear' }, ctxFor(t, rng));
    const gearCd = s.gearCd;
    const from = s.x, d = s.lane > 0 ? -1 : 1;
    deliver.command(s, { t: 'lane', d }, ctxFor(t, rng));
    let slide = 0;
    while (Math.abs(s.x - s.lane) > 1e-6 && slide < 5) { deliver.step(s, STEP, ctxFor(t, rng)); t += STEP; slide += STEP; }
    assert.ok(Math.abs(s.x - from) > 0.99, 'the bike reached the next lane');
    return { gearCd, slide };
  };
  const one = handling(1), three = handling(3);
  assert.ok(three.gearCd > one.gearCd * 1.5, `gear step: ${three.gearCd} vs ${one.gearCd}`);
  assert.ok(three.slide > one.slide * 1.3, `lane slide: ${three.slide} vs ${one.slide}`);
});

test('the door (fed mode): bags offered, one choice of 1-3 reported once, the run clears the door', () => {
  const rng = countingRng(6), s = init({ difficulty: 'pro', seed: 6, players: 2, selfFeed: false }), c = ctxFor(0, rng);
  const bags = [{ gid: 1, no: 11, left: 80 }, { gid: 2, no: 12, left: 60 }];
  assert.deepEqual(deliver.command(s, { t: 'load', n: 1 }, c), [], 'no door, no choice');
  deliver.onEvent(s, { kind: 'door', bags: [...bags, { bad: 1 }] }, c);
  assert.deepEqual(s.door, { bags, want: 0 }, 'only well-formed bags');
  assert.ok(deliver.validate(JSON.parse(JSON.stringify(s))));
  assert.deepEqual(deliver.command(s, { t: 'load', n: 3 }, c), [], 'not more bags than are at the door');
  assert.deepEqual(deliver.command(s, { t: 'load', n: 0 }, c), []);
  assert.deepEqual(deliver.command(s, { t: 'load', n: 2 }, c), [{ kind: 'load', at: 0, n: 2 }]);
  assert.equal(s.door.want, 2);
  assert.deepEqual(deliver.command(s, { t: 'load', n: 1 }, c), [], 'one choice per door');
  deliver.onEvent(s, { kind: 'door', bags: bags.slice(0, 1) }, c);
  assert.equal(s.door.want, 1, 'a bag gone from the door: the choice shrinks with it');
  deliver.onEvent(s, runEv(bags.slice(0, 1)), c);
  assert.equal(s.door, null, 'the run starts: off the door');
  assert.equal(s.st, 'ride');
  deliver.onEvent(s, { kind: 'door', bags }, c);
  assert.equal(s.door, null, 'no door while riding');
  assert.equal(deliver.validate({ ...s, door: { bags: [{ gid: 'x' }], want: 0 } }), false);
  // the bot picks its load at the door, then rides the run it is given
  const b = init({ difficulty: 'pro', seed: 7, players: 2, selfFeed: false });
  deliver.onEvent(b, { kind: 'door', bags: [...bags, { gid: 3, no: 13, left: 90 }] }, c);
  assert.deepEqual(botMod.makeDeliverBot({ gear: 3, skill: 0.85, bags: 2 })(b, c), { t: 'load', n: 2 });
  assert.deepEqual(deliver.bot.next(b, c), { t: 'load', n: 1 }, 'the default bot takes one bag');
});
