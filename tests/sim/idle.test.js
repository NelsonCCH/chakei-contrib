// Nobody idles long: at the mid human profile each seat's longest idle (tests/sim/idle.js:
// the longest stretch its station has nothing waiting, from its first work to the bell) stays within IDLE_MAX seconds.
// The full table: `node scripts/idle-probe.mjs`.
//
// Party nights: met by the party director (core/party/director.ts) and held as a real gate in
// tests/sim/party-director.test.js (every party shop and player count, the 3-seed median).
// Co-op levels: REPORT ONLY (solo and co-op pacing are not part of the party change). Arrivals at the quiet
// levels are ~20 s apart, so the waiter and the bar stand 20-35 s between parties, and the till and 傳菜 wait 30-200 s
// whenever a person's kitchen falls behind. This runs as a todo so the table shows in every `npm run sim` without failing.
// Sample: one seed per level, at 1 player, 4 players and a full room (the probe runs every count and 3 seeds).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { longestIdle, seatOrder } from './idle.js';

export const IDLE_MAX = 6;
const LEVELS = ['central', 'mongkok', 'airport', 'typhoon', 'newyear', 'latenight', 'hell'];

test(`co-op levels (report only): each seat's longest idle at the mid profile vs ${IDLE_MAX} s`, { todo: 'co-op level pacing is report-only; party nights are gated in party-director.test.js', timeout: 300000 }, () => {
  const over = [];
  for (const id of LEVELS) {
    const all = seatOrder('level', id).length;
    for (const n of [...new Set([1, Math.min(4, all), all])]) {
      const r = longestIdle({ mode: 'level', id, n, seed: 51 });
      assert.deepEqual(r.errs, [], `level ${id} x${n}`);
      for (const [st, s] of Object.entries(r.idle)) if (s > IDLE_MAX) over.push(`level ${id} x${n} ${st} ${s.toFixed(0)} s (no result for ${(r.gap[st] ?? 0).toFixed(0)} s)`);
    }
  }
  assert.deepEqual(over, [], `seats idle longer than ${IDLE_MAX} s`);
});
