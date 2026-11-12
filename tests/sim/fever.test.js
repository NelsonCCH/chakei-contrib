// 旺場 as a scheduled event (replaces the older combo fevers and the 大陣客 rush wave): exactly one
// fever per shift, CFG.fever.sec (40 s) long, whole inside the middle half of the shift, its start drawn from the shift's
// stream; inside it a heat curve (slow start, climax, short wind-down) brings customers closer and raises the tips; the
// page announces it from the shared clock, so every phone in a co-op room tells the same fever at the same time.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshCore, simPort } from './core.js';
import { runShift } from './shift.js';
import { runCoop } from './coop.js';

/** A fresh shop with the player at `station` and nobody arriving by themselves (G.nextSpawn far away). */
function shop({ station = 'waiter', seed = 7 } = {}) {
  const C = freshCore();
  C.setRng(C.mulberry32(seed)); C.setPort(simPort(C));
  C.setStation(station); C.setSlot('lunch'); C.setDiff('pro');
  C.newGame();
  C.G.nextSpawn = 1e9;
  return { C, G: C.G };
}
const play = (C, sec) => { for (let i = 0; i < Math.round(sec * 60) && C.G.running; i++) C.CORE_HOOK.update(1 / 60); };
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
/** The fever's on-intervals as a shift saw them: [[from, to], ...] from G.fever after each step. */
function feverSpans() {
  const spans = [];
  let was = false;
  return { spans, see(G) { if (G.fever && !was) spans.push([G.t, G.t]); if (G.fever) spans[spans.length - 1][1] = G.t; was = !!G.fever; } };
}

test('the curve: 40 s, slow and casual for the first 5 s, climax from 10 s to 32 s, an 8 s wind-down; data in CFG.fever', () => {
  const { C } = shop();
  const F = C.CFG.fever;
  assert.deepEqual([F.sec, F.from, F.to, F.gap, F.tip], [40, .25, .75, .6, 2]);
  const h = [0, 2.5, 5, 7.5, 10, 20, 32, 36, 39.9].map(C.heatAt);
  assert.deepEqual(h.map(x => Math.round(x * 1000) / 1000), [0, .125, .25, .625, 1, 1, 1, .5, .013]);
  for (let x = 0; x < 10; x += .25) assert.ok(C.heatAt(x + .25) >= C.heatAt(x), 'builds up to the climax');
  for (let x = 32; x < 39.75; x += .25) assert.ok(C.heatAt(x + .25) <= C.heatAt(x), 'winds down after it');
  assert.deepEqual(C.feverPeak(), [10, 32]);
  // outside the fever there is no heat; a tuned length stretches the same shape
  assert.deepEqual([C.feverHeat(60, 59.99), C.feverHeat(60, 100), C.feverHeat(null, 70), C.feverHeat(undefined, 70)], [0, 0, 0, 0]);
  C.CFG.fever.sec = 20;
  assert.ok(near(C.heatAt(5), 1) && near(C.heatAt(18), .5) && near(C.heatAt(2.5), .25), 'a 20 s fever: the same curve at half the time');
});

test('the heat brings customers closer and raises the tips, in proportion; a mistake breaks the combo but not the fever', () => {
  const { C, G } = shop();
  G.feverAt = 60;
  const gap = t => { C.setRng(C.mulberry32(3)); return C.spawnGap(t); };
  assert.ok(near(gap(59.99), gap(100.01)), 'the same gap before and after');
  // spawnGap's base itself is the same from 35 s to 135 s, so the ratio is the fever's multiplier alone
  assert.ok(near(gap(65) / gap(59.99), .9), 'ramp, heat .25: .9 of the gap');
  assert.ok(near(gap(75) / gap(59.99), .6), 'climax: .6 of the gap (the old rush wave)');
  assert.ok(near(gap(96) / gap(59.99), .8), 'wind-down, heat .5: .8');
  // tips: $1 / $2 / $3 / $5 from combo 3 / 6 / 9 / 12, times 1 + heat outside / at the climax / on the ramp
  assert.deepEqual([0, 2, 3, 5, 6, 8, 9, 11, 12, 30, 99].map(C.tipFor), [0, 0, 1, 1, 2, 2, 3, 3, 5, 5, 5]);
  const tipAt = t => { G.t = t; const t0 = G.tips | 0; C.good(); return (G.tips | 0) - t0; };
  for (let i = 0; i < 11; i++) tipAt(10);
  assert.deepEqual([tipAt(10), tipAt(75), tipAt(62.5), tipAt(96)], [5, 10, 6, 8], 'combo 12+: $5, x2 at the climax, x1.125 and x1.5 on the slopes');
  G.t = 75; C.juiceTick(); C.feverTick(C.rng); assert.equal(G.fever, true);
  G.mistakes++; C.juiceTick();
  assert.deepEqual([G.combo, G.fever], [0, true], 'a mistake breaks the combo; the fever runs on');
  assert.equal(G.revenue, G.tips, 'every tip went into revenue');
});

test('exactly one fever per shift, 40 s, whole inside the middle half (45-135 s of 180), started on the shift\'s stream', () => {
  const starts = [];
  for (let s = 1; s <= 12; s++) {
    const station = ['waiter', 'bar', 'kitchen', 'till'][s % 4], f = feverSpans();
    const r = runShift({ seed: 300 + s * 11, station, slot: ['breakfast', 'lunch', 'dinner'][s % 3], before: C => f.see(C.G) });
    assert.deepEqual(r.errs, [], `seed ${s}`);
    const G = r.C.G;
    assert.equal(f.spans.length, 1, `seed ${s}: one fever: ${JSON.stringify(f.spans)}`);
    const [[a, b]] = f.spans;
    assert.ok(Math.abs(a - G.feverAt) < 1 && Math.abs(b - (G.feverAt + 40)) < 1, `seed ${s} (seen per frame; the ledger checks every step): on from ${a} to ${b}, feverAt ${G.feverAt}`);
    assert.ok(G.feverAt >= 45 && G.feverAt + 40 <= 135, `seed ${s}: inside the middle half: ${G.feverAt}`);
    assert.equal(G.fevers, 1);
    starts.push(G.feverAt);
  }
  // spread over the window, not pinned to one place
  assert.ok(Math.min(...starts) < 60 && Math.max(...starts) > 80, 'starts spread over 45-95 s: ' + starts.map(Math.round).join(' '));
  // the same seed, the same fever; a daily challenge draws it from the day's stream: the same for everyone that day
  assert.equal(runShift({ seed: 41, station: 'waiter', slot: 'lunch' }).C.G.feverAt, runShift({ seed: 41, station: 'waiter', slot: 'lunch' }).C.G.feverAt);
  const at = (seed, daily) => { const { C, G } = shop({ seed }); if (daily) G.drng = { a: 20261111 }; play(C, 1); return G.feverAt; };
  assert.notEqual(at(1), at(2), 'two phones\' own shifts: their own fevers');
  assert.equal(at(1, true), at(2, true), 'the same daily challenge: the same fever whatever the phone\'s own stream');
});

test('levels, party rounds and short shifts use the same rule; the tutorial has none', () => {
  // a level of the game and a party shop's 120 s 下午茶 round (middle half 30-90 s)
  for (const o of [{ lv: 'estate' }, { shop: 'mongkok', gameSec: 120 }]) {
    const f = feverSpans();
    const r = runShift({ seed: 77, station: 'waiter', slot: 'lunch', ...o, before: C => f.see(C.G) });
    assert.deepEqual(r.errs, [], JSON.stringify(o));
    const sec = r.C.CFG.gameSec, at = r.C.G.feverAt;
    assert.equal(f.spans.length, 1, JSON.stringify(o));
    assert.ok(at >= sec / 4 && at + 40 <= sec * 3 / 4, `${JSON.stringify(o)}: ${at} inside [${sec / 4}, ${sec * 3 / 4}]`);
  }
  // a 75 s 試食 bite cannot hold 40 s inside its middle half: the fever sits in the middle of it
  { const { C } = shop(); C.CFG.gameSec = 75; assert.equal(C.feverStart(() => .9), 17.5); }
  // the tutorial: no clock, no fever
  { const { C, G } = shop(); G.tut = true; play(C, 150); assert.deepEqual([G.feverAt, G.fever, G.fevers | 0], [null, undefined, 0]); }
});

test('told on screen as it starts, at its climax and as it ends, each once, between the busy and the quiet toasts', () => {
  const { C, G } = shop();
  G.feverAt = 60;
  C.juiceTick(); C.drainFx();
  const said = [];
  for (let t = 0; t <= 140; t += .5) {
    G.t = t; C.juiceTick();
    for (const e of C.drainFx()) if (e.k === 'toast') said.push([t, e.msg]); else if (e.k === 'fever') said.push([t, 'fever ' + e.on]);
  }
  assert.deepEqual(said, [[35.5, '繁忙時間嚟喇！'], [60, 'fever true'], [70, '旺場高峰！頂住！'], [100, 'fever false'], [135.5, '靜返少少，執吓手尾']]);
});

test('a mid player feels the climax as a stretch, not a collapse: more work waiting at the waiter, few walk-outs (printed)', () => {
  const F = freshCore().CFG.fever;
  const run = gap => {
    let over = 0, all = 0, served = 0, out = 0;
    for (let s = 1; s <= 4; s++) {
      let last = 0;
      const r = runShift({ seed: 500 + s * 17, station: 'waiter', slot: 'lunch', diff: 'pro', human: 'mid', cfg: { fever: { ...F, gap } },
        before: C => { const dt = C.G.t - last; last = C.G.t; all += dt; if (C.stationLoad('waiter').n >= 4) over += dt; } });
      assert.deepEqual(r.errs, []);
      served += r.cust.served; out += r.cust.walkouts;
    }
    return { over: over / all, pct: 100 * served / (served + out) };
  };
  const without = run(1), fever = run(F.gap);
  console.log(`waiter, mid player, 4 shifts: 4+ jobs waiting ${(100 * without.over).toFixed(0)}% of the shift without the fever's crowd, ${(100 * fever.over).toFixed(0)}% with it; served ${without.pct.toFixed(0)}% -> ${fever.pct.toFixed(0)}%`);
  assert.ok(fever.over > without.over, 'the climax piles up work');
  assert.ok(fever.over - without.over >= .03 && fever.over - without.over <= .3, 'a stretch: some overload, not most of the shift');
  assert.ok(fever.pct >= 80, 'not a collapse: a mid player still serves 80%+ ' + fever.pct.toFixed(1));
});

test('co-op: the referee schedules it, every phone has the same feverAt and announces it at the same game time', () => {
  for (const seed of [4, 5]) {
    const said = {}, peaks = {};
    const r = runCoop({ seed, seats: ['waiter', 'bar', 'kitchen', 'till'], shape: '4g',
      each: ({ phones }) => { for (const ph of phones) if (ph.alive) ph.C.juiceTick(); },
      onFx: (ph, e) => {
        if (e.k === 'fever') (said[ph.id] ??= []).push([e.on, ph.C.G.t]);
        if (e.k === 'toast' && /旺場高峰/.test(e.msg)) (peaks[ph.id] ??= []).push(ph.C.G.t);
      } });
    assert.deepEqual(r.errs, [], 'seed ' + seed);
    const at = r.S.feverAt;
    assert.ok(at >= 45 && at <= 95, `seed ${seed}: ${at}`);
    assert.equal(r.S.fevers, 1);
    for (const p of r.phones) {
      assert.equal(p.C.G.feverAt, at, `seed ${seed}: ${p.id} has the referee's fever`);
      const s = said[p.id] ?? [];
      assert.deepEqual(s.map(x => x[0]), [true, false], `seed ${seed}: ${p.id} told it start and end once: ${JSON.stringify(s)}`);
      // a phone's clock runs a little ahead or behind the referee's (CLOCK_AHEAD_S), never by a frame more
      assert.ok(Math.abs(s[0][1] - at) < .3 && Math.abs(s[1][1] - (at + 40)) < .3, `seed ${seed}: ${p.id} on time: ${JSON.stringify(s)} vs ${at}`);
      assert.equal((peaks[p.id] ?? []).length, 1, `seed ${seed}: ${p.id} told the climax once`);
    }
  }
});
