// Whole shifts in memory on the shop's rules (src/core/), many seeds, every station and slot, the two kinds of
// level and the daily challenge: the books must stay straight throughout (tests/sim/ledger.js) and every shift must run
// to its end. About 150 shifts in ~10 s: `npm run sim` (and first in `npm test`). SIM_SEEDS=n for more seeds per case.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runShift } from './shift.js';

const SEEDS = Number(process.env.SIM_SEEDS) || 4;
const SLOTS = ['breakfast', 'lunch', 'dinner'];
const tally = {};

/** Every slot with its own shop, plus each level in its own slot; the daily challenge on every other own-shop shift. */
function cases(seed) {
  return SLOTS.flatMap(slot => [{ slot, level: null, daily: seed % 2 === 0 }, ...(slot === 'lunch' ? [{ slot, level: 'stall' }] : slot === 'dinner' ? [{ slot, level: 'night' }] : [])]);
}
function play(station, o = {}, seeds = SEEDS) {
  const out = [];
  let n = 0, served = 0, revenue = 0, made = 0;
  for (let seed = 1; seed <= seeds; seed++) for (const c of cases(seed)) {
    const s = seed * 1009 + n++, r = runShift({ seed: s, station, ...c, ...o });
    if (r.errs.length) out.push(`seed ${s} ${station} ${c.slot}${c.level ? ' ' + c.level : ''}${c.daily ? ' daily' : ''}${o.lazy ? ' lazy' : ''}:\n    ` + r.errs.join('\n    '));
    served += r.served; revenue += r.revenue; made += r.cups + r.dishes;
    for (const [k, v] of Object.entries(r.counts)) tally[k] = (tally[k] || 0) + v;
    for (const k of ['mistakes', 'angry']) tally[k] = (tally[k] || 0) + r[k];
    if (r.maxCombo >= 10) tally.fever = (tally.fever || 0) + 1;
  }
  assert.deepEqual(out, [], 'broken rules:\n' + out.join('\n'));
  return { n, served, revenue, made };
}

for (const station of ['waiter', 'bar', 'kitchen', 'till', 'all']) {
  test(`shifts at ${station === 'all' ? 'all four stations at once' : 'the ' + station}, the computer at the rest: books straight, one ending per customer, runs to the end`, () => {
    const { n, served, revenue, made } = play(station);
    // the bots really played: customers were served and paid, and the station's own work was done
    assert.ok(served > n * 5, `served ${served} in ${n} shifts`);
    assert.ok(revenue > n * 100, `revenue ${revenue} in ${n} shifts`);
    if (station === 'bar' || station === 'kitchen' || station === 'all') assert.ok(made > n * 5, `made ${made} cups and dishes in ${n} shifts`);
  });
}

test('a slow player at every station (customers give up, walk out at the till): books still straight', () => {
  for (const station of ['waiter', 'bar', 'kitchen', 'till', 'all']) play(station, { lazy: true }, Math.ceil(SEEDS / 2));
});

test('an octopus card that pays an under-charged total: the $1 written off counts as short (a ledger fault, not a rules one)', () => {
  // the 960-shift team run found "$1 short" shifts: an octopus customer keyed in $1 under the bill. Which seeds take that
  // path moves with every rule change (one moved all three of the first ones), so the path is set up on purpose: the
  // first bill at the player's till is made an octopus card that pays in full, and the bot keys it in $1 short.
  for (const [seed, diff] of [[8, 'rookie'], [21, 'pro'], [385, 'ace']]) {
    let armed = false;
    const r = runShift({ seed, station: 'till', slot: 'breakfast', diff, pace: .03, err: .06, before: C => {
      const G = C.G, c = G.cur;
      if (armed || !c || G.step !== 'total' || G.entry) return;
      armed = true; c.octo = true; c.octoShort = false;
      for (const ch of String(c.expect - 1)) C.tillKey(ch);
      C.tillKey('ok');
    } });
    assert.ok(armed, `seed ${seed}: no bill reached the till`);
    assert.deepEqual(r.errs, [], `seed ${seed} ${diff}`);
    assert.ok(r.octoShort >= 1 && r.loss >= 1, `seed ${seed}: the octopus under-charge was not written off (${r.octoShort}, loss ${r.loss})`);
  }
});

test('the shifts above reached every ending and the combo paths (or they prove nothing for them)', () => {
  for (const k of ['left', 'took', 'paid', 'aipaid', 'walkout', 'ghost', 'toPay', 'good', 'mistakes', 'angry', 'fever'])
    assert.ok(tally[k] > 0, `never reached: ${k} (${JSON.stringify(tally)})`);
});
