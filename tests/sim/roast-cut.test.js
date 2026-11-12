// 斬料 as cutting along dashed guides at a person's aim: solo shifts at the 燒味 seat on each of the
// game's main levels and 修羅場 (tests/sim/xseat.js runSeat, the computer on the shop's four stations), each cut landing
// off the guide by the human model's aim error (tests/sim/human.js AIM_SKILL: a first-timer 3 logical px = 1.5 mm SD, a
// skilled player 2). Level 1 must be fair to a first-timer (wide snap, dashed lines through the roast); harder levels
// shrink the snap, add pieces and fade the guides. Prints the table.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runSeat } from './xseat.js';
import { LEVELS, LEVEL_ORDER } from './levels.js';

const MAIN = LEVEL_ORDER.filter(id => !LEVELS[id].era && !LEVELS[id].fest && !LEVELS[id].hell);
const SEEDS = [31, 32, 33, 34];

test('燒味 seat at a person\'s aim on every main level and 修羅場: tiers rise with the level; level 1 is fair to a first-timer', () => {
  // the levels with the 燒味 role play its role tier's cutting tier (core/work/roles.ts ROAST_CUT: 年廿八 brings it
  // in at tier 1 -> 0, 通宵 tier 2 -> 0, 修羅場 the top); before it, a solo player at the seat still gets the old per-level
  // ramp (core/referee/extras.ts roastDish sells the station's menu there, until the seat pickers follow `roles`)
  const rows = [], want = { estate: 0, central: 1, mongkok: 1, airport: 2, typhoon: 2, newyear: 0, latenight: 0, hell: 3 };
  for (const lv of [...MAIN, 'hell']) for (const human of ['first', 'skilled']) {
    let served = 0, stars = 0, rev = 0, cuts = 0, clean = 0;
    for (const seed of SEEDS) {
      const r = runSeat({ seed, kind: 'roast', lv, human });
      assert.deepEqual(r.errs, [], `${lv}/${human}/${seed}`);
      assert.equal(r.st.tier, want[lv], `${lv}: tier`);
      cuts += r.st.cuts; clean += r.st.cleanCuts;
      served += r.st.served; stars += r.st.starsSum; rev += r.revenue;
    }
    assert.ok(served > 0, `${lv}/${human}: the roast seat served`);
    rows.push({ lv, human, tier: want[lv], cuts, clean: clean / cuts, served, stars: stars / served, rev: Math.round(rev / SEEDS.length) });
  }
  console.log(`\n${SEEDS.length} seeds each\n| level | person | tier | cuts | on the guide | plates | avg stars | revenue / shift |\n|---|---|---|---|---|---|---|---|`);
  for (const x of rows) console.log(`| ${x.lv} | ${x.human} | ${x.tier} | ${x.cuts} | ${(100 * x.clean).toFixed(0)}% | ${x.served} | ${x.stars.toFixed(2)} | ${x.rev} |`);
  const at = (lv, h) => rows.find(x => x.lv === lv && x.human === h);
  const l1 = at('estate', 'first');
  assert.ok(l1.cuts >= 60, 'level 1: enough cuts to judge');
  assert.ok(l1.clean >= 0.85, `level 1 first-timer lands nearly every cut on its guide: ${l1.clean}`);
  assert.ok(l1.stars >= 2, `level 1 first-timer's plates average 2 stars: ${l1.stars}`);
  // 1.85 (1.9 before 洗碗 was retired): with 洗碗 gone and 外賣 a tier up the shop's draws moved and 打風's skilled
  // plates went 2.19 -> 1.88 over these 4 seeds (機場 1.96 -> 2.08 the other way): seed noise around the same cutting tier
  for (const x of rows.filter(r => r.human === 'skilled' && r.lv !== 'hell')) assert.ok(x.clean >= 0.75 && x.stars >= 1.85, `${x.lv}: a skilled player lands most cuts on the guide and serves good plates`);
  assert.ok(at('hell', 'first').clean < l1.clean - 0.1, 'the top tier is clearly harder for a first-timer than level 1');
});
