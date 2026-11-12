// The human-speed player (tests/sim/human.js) and the pace it sets for the levels.
// The calibration itself is scripts/human-pace.mjs; these checks pin what the levels promise on fresh seeds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runShift } from './shift.js';
import { runCoop } from './coop.js';
import { LEVELS, LEVEL_ORDER } from './levels.js';

const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;

test('levels.js reads the game\'s own levels (ui/levels.ts): every level has a pace, a patience, tables and a menu', () => {
  assert.ok(LEVEL_ORDER.length >= 18);
  assert.equal(LEVEL_ORDER[0], 'estate');
  for (const id of LEVEL_ORDER) {
    const L = LEVELS[id];
    assert.ok(L.gap > 0 && L.pat > 0 && L.lay.tables.length && L.menu.length, id);
  }
});

test('a level installs as the game installs it: its tables, its menu and its slot', () => {
  const r = runShift({ seed: 3, station: 'waiter', lv: 'newyear', human: 'mid' });
  assert.deepEqual(r.errs, []);
  const G = r.C.G;
  assert.equal(G.tables.length, LEVELS.newyear.lay.tables.length);
  assert.equal(G.slot, 'dinner');
  assert.equal(G.level, 'newyear');
});

test('the human model: a first-timer presses less often and earns less than a skilled player and the bot', () => {
  const per = {};
  for (const human of ['first', 'skilled', undefined]) {
    const rs = [1, 2, 3].map(seed => runShift({ seed, station: 'waiter', lv: 'central', human }));
    for (const r of rs) assert.deepEqual(r.errs, []);
    per[human ?? 'bot'] = { rev: mean(rs.map(r => r.revenue)), taps: human ? mean(rs.map(r => r.human.waiter.taps)) : null };
  }
  assert.ok(per.first.taps < per.skilled.taps, JSON.stringify(per));
  // at this pace the shop, not the hands, limits a skilled player or the bot, so those two land close together
  assert.ok(per.first.rev < per.skilled.rev && per.first.rev < per.bot.rev, JSON.stringify(per));
});

// Level 1 is set so a first-timer at the waiter serves nearly everyone, with time to spare, alone and in a room
// with computer teammates; the top of the ladder pushes a skilled player.
test('level 1 (estate): a first-timer waiter serves >= 90% with few walk-outs and idle moments, solo and co-op', () => {
  const solo = [11, 12, 13, 14].map(seed => runShift({ seed, station: 'waiter', lv: 'estate', human: 'first' }));
  const coop = [21, 22, 23].map(seed => runCoop({ seed, seats: ['waiter'], lv: 'estate', human: { 0: 'first' } }));
  for (const r of [...solo, ...coop]) assert.deepEqual(r.errs, []);
  const pct = rs => mean(rs.map(r => r.cust.servedPct)), walk = rs => mean(rs.map(r => r.cust.walkouts));
  const idle = rs => mean(rs.map(r => r.human.waiter.idle / r.human.waiter.clock));
  assert.ok(pct(solo) >= 90 && pct(coop) >= 90, `served solo ${pct(solo).toFixed(1)}% co-op ${pct(coop).toFixed(1)}%`);
  assert.ok(walk(solo) <= 1.5 && walk(coop) <= 1.5, `walk-outs solo ${walk(solo)} co-op ${walk(coop)}`);
  assert.ok(idle(solo) >= .05, `idle share ${idle(solo).toFixed(2)}`);
});

test('the top of the ladder (地獄午市) pushes a skilled waiter: walk-outs happen', () => {
  const rs = [31, 32, 33].map(seed => runShift({ seed, station: 'waiter', lv: 'hell', human: 'skilled' }));
  for (const r of rs) assert.deepEqual(r.errs, []);
  const pct = mean(rs.map(r => r.cust.servedPct));
  assert.ok(pct < 95, `skilled at hell served ${pct.toFixed(1)}%`);
});
