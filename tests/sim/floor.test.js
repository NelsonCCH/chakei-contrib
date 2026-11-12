// 樓面 claims under jittery links: two or three phones share the floor of a level with 傳菜 and 外賣
// (typhoon: three floor seats), claim the same bubbles in the same frame, forget claims, and ride deliveries out.
// The referee is the room's (core/coop/room.ts); the harness is tests/sim/floor.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runFloor } from './floor.js';

const CLAIM_IDLE_S = 8;   // core/work/floor.ts
const RACES = [{ at: 15 }, { at: 30 }, { at: 45 }, { at: 60 }];

for (const [shape, n] of [['4g', 2], ['bad', 3], [['lan', '4g', 'bad'], 3]]) {
  const name = Array.isArray(shape) ? shape.join('+') : shape;
  test(`race: every contested bubble has exactly one winner; the others hear 'taken' (${n} phones, ${name})`, () => {
    for (const seed of [1, 2]) {
      const r = runFloor({ seed, players: n, shape, sec: 80, races: RACES });
      assert.deepEqual(r.errs, [], `seed ${seed}: ${r.errs.slice(0, 3).join('; ')}`);
      const ran = r.log.races.filter(x => x.id);
      assert.ok(ran.length >= 3, `seed ${seed}: most races found a bubble to fight over (${ran.length})`);
      for (const x of ran) {
        assert.ok(x.sent.length >= 2, `${x.id}: at least two phones claimed it in the same frame`);
        assert.ok(x.first, `${x.id}: the referee gave it to someone`);
        assert.ok(x.sent.includes(x.first), `${x.id}: to one of the racers`);
        assert.ok(!x.nacked.includes(x.first), `${x.id}: the winner was not refused`);
        assert.deepEqual([...x.nacked].sort(), x.sent.filter(p => p !== x.first).sort(), `${x.id}: every loser was refused (${x.at}: ${x.holders.join(' ')})`);
      }
    }
  });
}

test('no ghost bubbles: a taken or finished task leaves every phone within a few ticks (bad links)', () => {
  for (const seed of [3, 4]) {
    const r = runFloor({ seed, players: 3, shape: ['bad', '4g', 'bad'], sec: 90, races: RACES, pick: 0.08 });
    assert.deepEqual(r.errs, []);
    assert.equal(r.log.ghosts.length, 0, `seed ${seed}: ghosts ${JSON.stringify(r.log.ghosts.slice(0, 3))} (bound ${Math.round(r.GHOST_MS)} ms)`);
    assert.ok(r.F.stats.claims > 20, `seed ${seed}: the floor was busy (${r.F.stats.claims} claims)`);
  }
});

test('timeout: a claim nobody works on goes back to the floor after the idle limit', () => {
  for (const seed of [5, 6]) {
    const r = runFloor({ seed, players: 2, shape: 'bad', sec: 70, forget: [{ at: 20, phone: 1 }, { at: 40, phone: 0 }] });
    assert.deepEqual(r.errs, []);
    assert.equal(r.log.forgets.length, 2);
    for (const f of r.log.forgets) {
      assert.ok(f.id && f.sawMine, `seed ${seed}: the forgotten claim was granted (${JSON.stringify(f)})`);
      assert.ok(f.back, `seed ${seed}: ${f.id} came back`);
      if (!f.back.gone && f.back.by === null) {
        const held = f.back.t - f.t;
        assert.ok(held >= CLAIM_IDLE_S - 0.5 && held <= CLAIM_IDLE_S + 2, `seed ${seed}: ${f.id} was held ${held.toFixed(2)} s`);
      }
    }
    assert.ok(r.F.stats.expired >= 2, `seed ${seed}: the referee counted the timeouts (${r.F.stats.expired})`);
  }
});

test('cover while away: a rider keeps the seat (no cover), the computer never adds a worker for them', () => {
  // seeds where a delivery comes up while each rider wants one (arrivals on floor levels with players moved once: the
  // old 7 and 8 now have no delivery free for the phones in 90 s; about one seed in four has none, before and after)
  for (const seed of [1, 3]) {
    const r = runFloor({ seed, players: 2, shape: '4g', sec: 90, ride: [{ at: 15, phone: 0 }, { at: 50, phone: 1 }], rideSec: 18 });
    assert.deepEqual(r.errs, []);
    assert.ok(r.log.rides.length >= 1, `seed ${seed}: someone rode out (${JSON.stringify(r.log.rides)})`);
    assert.ok(r.log.awayFrames > 60 * 10, `seed ${seed}: a rider was away for a while (${r.log.awayFrames} frames)`);
    assert.equal(r.log.awayCover, 0, 'no rider\'s seat was covered while they rode');
    assert.equal(r.log.cpuOver, 0, 'no more computer workers than computer floor seats');
    assert.ok(r.F.stats.drops >= 1, 'the run dropped its order');
  }
});
