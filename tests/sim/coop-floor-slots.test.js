// The co-op room's 樓面 places (from a bug seen in play): the room lobby seats 樓面1 and 樓面2, each a
// player, the computer or off, budgeted as the party lobby's. The owner's start message carries the
// switched-on places (`floorOn`, 1-2) and the room makes exactly that many floor seats (core/coop/room.ts roomShiftOf):
// one player on 樓面1 with 樓面2 off has no computer floor help at all (core/work/floor.ts floorShareNow: every floor
// seat a player's -> the players' share is 1); 樓面2 the computer's covers the rest as before. 傳菜 / 外賣 are never seats.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshCore } from './core.js';
import { runFloor } from './floor.js';
import { LEVELS } from './levels.js';

const C = freshCore();
const start = (lv, extra = {}) => ({ level: lv, lv: LEVELS[lv], slot: LEVELS[lv].slot, diff: 'pro', extra: [], port: { rank: 2, rlv: {}, names: {} }, ...extra });

test('the start message: floorOn is the floor seats (1-2, clamped); without it the level\'s own count; no floor, no floorOn', () => {
  const seated = { floor1: { player: 'a', name: 'a' } };
  assert.equal(C.roomShiftOf(start('typhoon', { floorOn: 1 }), seated).floor, 1);
  assert.equal(C.roomShiftOf(start('typhoon', { floorOn: 2 }), seated).floor, 2);
  assert.equal(C.roomShiftOf(start('typhoon', { floorOn: 9 }), seated).floor, 2, 'never a 樓面3');
  assert.equal(C.roomShiftOf(start('typhoon', { floorOn: 1 }), seated).floorOn, 1, 'kept for a restart (roomRestore re-reads the saved shift)');
  assert.equal(C.roomShiftOf(start('typhoon'), seated).floor, C.workSpecFor('typhoon').floor, 'an older page: as before');
  // a level without the floor keeps the single 伙記 seat whatever the message says
  const nf = Object.keys(LEVELS).find(id => !C.floorLevel(LEVELS[id]));
  assert.ok(nf, 'a level without 樓面');
  const sh = C.roomShiftOf(start(nf, { floorOn: 2 }), {});
  assert.equal(sh.floor, undefined); assert.equal(sh.floorOn, undefined);
});

test('one player on 樓面1, 樓面2 off: no computer floor help; 樓面2 the computer\'s: covered; no 傳菜 / 外賣 seat', { timeout: 120000 }, () => {
  const rows = [];
  for (const lv of ['typhoon', 'mongkok']) for (const seed of [1, 2]) {
    const off = runFloor({ seed, lv, players: 1, mid: true, sec: 150, shape: 'clean', floorOn: 1 });
    const on = runFloor({ seed, lv, players: 1, mid: true, sec: 150, shape: 'clean', floorOn: 2 });
    for (const r of [off, on]) {
      assert.deepEqual(r.errs, []);
      const keys = Object.keys(r.room.C.referee().seats);
      assert.ok(!keys.includes('runner') && !keys.includes('takeaway') && !keys.includes('waiter'), `${lv}: seats ${keys}`);
      assert.ok(!keys.includes('floor3'), `${lv}: no third floor seat`);
    }
    const floorSeats = r => Object.values(r.room.C.referee().seats).filter(s => s.kind === 'floor').map(s => s.driver.type);
    assert.deepEqual(floorSeats(off), ['player'], `${lv} seed ${seed}: 樓面2 off -> one floor seat, the player's`);
    assert.deepEqual(floorSeats(on), ['player', 'computer'], `${lv} seed ${seed}: 樓面2 the computer's`);
    assert.equal(off.F.stats.cpu, 0, `${lv} seed ${seed}: the computer did no floor task with 樓面2 off`);
    assert.ok(!off.F.tasks.some(x => x.by && x.by.startsWith('#cpu')), `${lv} seed ${seed}: no computer hand on the floor`);
    assert.ok(on.F.stats.cpu > 0, `${lv} seed ${seed}: 樓面2 the computer's covers (${on.F.stats.cpu} tasks)`);
    rows.push(`${lv} seed ${seed}: computer floor tasks off ${off.F.stats.cpu} / on ${on.F.stats.cpu}; served off ${off.S.served} / on ${on.S.served}`);
  }
  console.log(rows.join('\n'));
});
