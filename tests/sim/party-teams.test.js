// Party nights by teams that are not the shop's own: the shop ladder must be a
// ladder (the same team sinks more often and ends lower as it moves up), follow-the-team must pull a team's cards toward
// an even fight (a struggling team meets more cards than it would on fixed lines, a strong one fewer) while the strong
// team still ends higher, and nights with phones dropping out and coming back mid-round must stay sound.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshCore } from './core.js';
import { buildPool, playNight } from './party-team.js';

const C = freshCore();
const N = Number(process.env.PARTY_SIM_N_TEAMS || 6), NIGHTS = 120;
// the "human x1" team in the first four shops (the solo ladder's order); a first night and a practised
// group at 旺角晚市
const pool = await buildPool({
  cells: [
    { shop: 'estate', model: 'x1' }, { shop: 'central', model: 'x1' }, { shop: 'mongkok', model: 'x1' }, { shop: 'airport', model: 'x1' },
    { shop: 'mongkok', model: 'struggle' }, { shop: 'mongkok', model: 'fluent' },
  ], n: N, seed0: 610001,
});
const pct = x => (x * 100).toFixed(0) + '%';

test('the shop ladder is a ladder: the same team folds more and ends lower, shop by shop up', () => {
  const rows = [];
  let lastFold = -1, lastBank = Infinity;
  for (const shop of ['estate', 'central', 'mongkok', 'airport']) {   // the solo ladder's order
    const ns = Array.from({ length: NIGHTS }, (_, i) => playNight(C, { seed: 8500 + i, pool, cfg: { shop }, team: 'x1' }));
    for (const n of ns) assert.deepEqual(n.errs, []);
    const fold = ns.filter(n => n.s.bank < 0).length / NIGHTS, takings = ns.map(n => n.s.book.takings - n.s.book.rent).sort((a, b) => a - b)[NIGHTS >> 1];
    rows.push(`${shop}: folds ${pct(fold)}, median takings − rent $${takings}`);
    assert.ok(fold >= lastFold, `${shop}: folds ${pct(fold)} after ${pct(lastFold)}`);
    assert.ok(takings < lastBank, `${shop}: takings − rent $${takings} after $${lastBank}`);
    lastFold = fold; lastBank = takings;
  }
  console.log('x1 team up the ladder:', rows.join(' | '));
  assert.ok(lastFold > .2, 'a mid team at 機場茶記 sinks often: that shop is for better teams');
});

/** Cards met per night, and the same nights' cards on fixed lines (no follow): the dealt card's line at its tier's aim. */
function measure(model) {
  let met = 0, fixed = 0, n = 0;
  const banks = [];
  for (let i = 0; i < NIGHTS; i++) {
    const night = playNight(C, { seed: 8100 + i, pool, cfg: { shop: 'mongkok' }, team: model });
    assert.deepEqual(night.errs, []);
    banks.push(night.s.bank);
    for (const r of night.rounds) {
      n++; if (r.met) met++;
      const c = r.card, base = C.makeCard(c.tier, c.metric, r.kind, 'mongkok', null);
      if (C.cardMet(c.metric, base.n, r.report.team)) fixed++;
    }
  }
  banks.sort((a, b) => a - b);
  return { met: met / n, fixed: fixed / n, bank: banks[Math.floor(banks.length / 2)] };
}

test('follow the team: a first-night team meets more cards than on fixed lines, a practised team fewer; the practised team still ends higher', () => {
  const s = measure('struggle'), f = measure('fluent');
  console.log(`struggle: met ${pct(s.met)} (fixed lines ${pct(s.fixed)}), median till $${s.bank} | fluent: met ${pct(f.met)} (fixed lines ${pct(f.fixed)}), median till $${f.bank}`);
  assert.ok(s.met > s.fixed, 'the struggling team gets easier lines');
  assert.ok(f.met < f.fixed, 'the strong team gets harder lines');
  assert.ok(f.bank > s.bank, 'skill still shows in the till');
  const lines = C.titleLines(C.newNight(1, { shop: 'mongkok' }));
  assert.ok(C.titleIx(f.bank, lines) > C.titleIx(s.bank, lines), 'and on the title ladder');
});

test('nights with phones dropping and coming back, and seats changing, mid-round and between rounds: sound at every step, one to eight players', () => {
  let drives = 0;
  for (let i = 0; i < 40; i++) {
    const players = 1 + (i % 8);
    const night = playNight(C, { seed: 9100 + i, pool, cfg: { shop: 'mongkok', chooser: i % 5 === 0 ? 'host' : 'vote' }, team: 'struggle', players, churn: .3, moves: .3, check: true });
    assert.deepEqual(night.errs, [], `night ${i} (${players} players)`);
    drives += night.s.players.filter(p => p.rounds.length).length;
    const close = C.closeCard(night.s);
    for (const p of close.people) assert.ok(p.awards.length >= 1, `night ${i}: ${p.id} without an award`);
  }
  assert.ok(drives > 40);
});

test('two-day nights: ten rounds in the one shop, each round paying its rent, no doubled rounds', () => {
  const night = playNight(C, { seed: 31337, pool, cfg: { shop: 'mongkok', days: 2 }, team: 'x1', check: true });
  assert.deepEqual(night.errs, []);
  assert.equal(night.rounds.length, 10);
  assert.deepEqual([...new Set(night.rounds.map(r => `${r.day}:${r.shop}`))], ['1:mongkok', '2:mongkok']);
  for (const r of night.rounds) assert.equal(r.rent, C.rentFor(r.shop, r.kind));
  // a new day starts its lines fresh (no follow across the night's sleep)
  const d2 = night.rounds.find(r => r.day === 2);
  assert.equal(d2.card.last, null);
});
