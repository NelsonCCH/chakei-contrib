// 樓面's two places on a party night: each place is a player, the computer
// or off, and the floor's load is budgeted per switched-on place.
//   - the night: a free place switches off and on, the last place on stays on, sitting at an off place switches it on,
//     a round's plan carries the layout and the room reads it (floorOn)
//   - the room: one player on 樓面1 with 樓面2 off gets one player's load and no computer help (no pool hand, no cover,
//     no helper); with 樓面2 on for the computer (the default), the computer covers the rest, as before
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { longestIdle } from './idle.js';
import { freshCore } from './core.js';

const C = freshCore();

test('the night: 樓面 places switch on and off, the last stays on, sitting switches one on, the plan carries it', () => {
  const N = C.partySeam(3, { shop: 'hell' });
  N.input({ k: 'join', player: 'a', name: 'a' }); N.input({ k: 'join', player: 'b', name: 'b' });
  const s0 = N.night();
  assert.deepEqual(C.floorOff(s0), [], 'default: both places on (樓面1 for a player, 樓面2 the computer\'s)');
  assert.ok(!('floor3' in s0.seats), 'two places only');
  N.input({ k: 'seat', player: 'a', seat: 'floor1' });
  assert.equal(N.input({ k: 'slot', player: 'a', seat: 'floor1', on: false })[0]?.why, 'that seat is taken', 'a seated place stays on');
  N.input({ k: 'slot', player: 'b', seat: 'floor2', on: false });
  assert.deepEqual(C.floorOff(N.night()), ['floor2']);
  assert.deepEqual(C.checkNight(N.night()), []);
  assert.equal(N.input({ k: 'slot', player: 'b', seat: 'bar', on: false })[0]?.why, 'no such seat', 'only 樓面 places switch');
  // a's place is the last one on once a stands up: it cannot be switched off
  N.input({ k: 'seat', player: 'a', seat: 'floor1' });
  assert.equal(N.input({ k: 'slot', player: 'a', seat: 'floor1', on: false })[0]?.why, 'one 樓面 place stays on');
  // sitting at the off place switches it on
  N.input({ k: 'seat', player: 'b', seat: 'floor2' });
  assert.deepEqual(C.floorOff(N.night()), []);
  N.input({ k: 'seat', player: 'b', seat: 'floor2' });
  N.input({ k: 'slot', player: 'b', seat: 'floor2', on: false });
  N.input({ k: 'seat', player: 'a', seat: 'floor1' });
  const plan = C.planOf(N.night());
  assert.deepEqual(plan.floorOff, ['floor2']);
  assert.equal(C.roomPartyShift(plan, { a: 'a' }).party.floorOn, 1, 'the room gets one switched-on place');
  assert.equal(C.roomPartyShift({ ...plan, floorOff: [] }, { a: 'a' }).party.floorOn, 2);
  assert.equal(C.partyOf({ shop: 'hell', sec: 240, round: 0, floorOn: 7 }).floorOn, 2, 'a message is clamped to the two places');
  assert.equal(C.partyOf({ shop: 'hell', sec: 240, round: 0 }).floorOn, undefined, 'an older message: as before');
});

test('the room: 1 player + 樓面2 off gets one player\'s load and no computer help; 樓面2 on for the computer is covered', { timeout: 300000 }, () => {
  const rows = [];
  for (const shop of ['central', 'hell']) {
    let alone = 0, helped = 0;
    for (const seed of [61, 62]) {
      const watch = (r) => { const t = r.room.C.G.floor?.tasks ?? []; return t.some(x => x.by !== null && x.by.startsWith('#cpu')); };
      let cpuSeenOff = false, cpuSeenOn = false;
      const off = longestIdle({ mode: 'party', id: shop, n: 1, seed, seats: ['floor1'], floorOn: 1, each: o => { if (watch(o)) cpuSeenOff = true; } });
      const on = longestIdle({ mode: 'party', id: shop, n: 1, seed, seats: ['floor1'], floorOn: 2, each: o => { if (watch(o)) cpuSeenOn = true; } });
      const work = r => r.report.players.reduce((x, p) => x + (p.floor ?? 0), 0);   // the player's 樓面 work, a mid player's seconds
      const help = r => ['waiter', 'runner'].reduce((x, k) => x + (r.dir.help[k] ?? 0), 0);
      assert.equal(cpuSeenOff, false, `${shop} seed ${seed}: no computer hand on 樓面 with 樓面2 off`);
      assert.equal(off.floor.cpu, 0, `${shop} seed ${seed}: the computer did no floor task`);
      assert.equal(help(off), 0, `${shop} seed ${seed}: no helper on 樓面`);
      assert.ok(cpuSeenOn && on.floor.cpu > 0, `${shop} seed ${seed}: the computer's place covers (${on.floor.cpu} tasks)`);
      alone += work(off); helped += work(on);
      rows.push(`${shop} seed ${seed}: player's 樓面 work off ${work(off)} s / on ${work(on)} s; computer tasks off ${off.floor.cpu} / on ${on.floor.cpu}; helper off ${help(off)} / on ${help(on)}; idle off ${off.idle.floor1?.toFixed(1)} s`);
    }
    // one player's load either way: the player's own work is about the same, only the computer's part goes
    const ratio = alone / Math.max(1, helped);
    rows.push(`${shop}: player's work off / on x${ratio.toFixed(2)}`);
    assert.ok(ratio >= 0.75 && ratio <= 1.33, rows.at(-1));
  }
  console.log(rows.join('\n'));
});
