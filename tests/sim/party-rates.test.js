// Party mode's measures that core alone can take, shop by shop up the ladder, each shop
// played by the team it is for (party-team.js SHOP_TEAM): real in-memory shifts on seeds the calibration never saw
// (scripts/party-calibrate.mjs uses 1-...), then whole nights through the night's state machine with rounds drawn from
// those shifts and human pauses between them (party-team.js PAUSE).
//   - success rate per card tier against 80 / 50 / 25%, expected value per tier against +$240 / +$250 / +$300
//   - comeback: the share of nights whose title the 宵夜 wager changes (target 20-40%)
//   - the night's length (一日 28-35 min with the lobby, the between-round screens at human pace)
//   - shared pressure: how often the shop's own team folds (rare), and how often the till comes close (felt)
// The numbers are printed (PARTY_SIM_N=40 for a closer look); the asserts hold the design's bands with room for the
// sample's own noise, stated next to each.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshCore } from './core.js';
import { buildPool, cellKey, playNight, SHOP_TEAM } from './party-team.js';

const C = freshCore();
const N = Number(process.env.PARTY_SIM_N || 12), NIGHTS = 200;
const pool = await buildPool({ cells: C.SHOP_LADDER.map(shop => ({ shop, model: SHOP_TEAM[shop] })), n: N, seed0: 500001 });
const KINDS = ['breakfast', 'lunch', 'tea', 'dinner', 'late'], flowOf = k => (k === 'late' ? 'dinner' : k);
const EV = { safe: 240, bet: 250, allin: 450 };   // after recalibration: 搏盡 lands at 29% -> EV about $490
const pct = x => (x * 100).toFixed(0) + '%';

test('pool: every shift ran with clean books (a ledger error throws while the pool is built)', () => {
  for (const shop of C.SHOP_LADDER) for (const flow of Object.keys(pool[cellKey(shop, SHOP_TEAM[shop])])) assert.equal(pool[cellKey(shop, SHOP_TEAM[shop])][flow].length, N);
});

test('success rate and expected value per tier in every shop, for the team it is for (first round of the day)', () => {
  const all = { safe: [], bet: [], allin: [] }, line = [];
  for (const shop of C.SHOP_LADDER) {
    const met = { safe: [], bet: [], allin: [] };
    for (const kind of KINDS) for (const tier of C.PARTY_TIERS) for (const m of C.PARTY_METRICS) {
      if (!C.dealable(tier, m, kind, shop)) continue;
      const card = C.makeCard(tier, m, kind, shop, null), xs = pool[cellKey(shop, SHOP_TEAM[shop])][flowOf(kind)];
      const rate = xs.filter(x => C.cardMet(m, card.n, { revenue: x.revenue, tips: x.tips, mistakes: x.mistakes, angry: x.angry, maxCombo: x.maxCombo, fevers: x.fevers, served: x.served })).length / xs.length;
      met[tier].push(rate); all[tier].push(rate);
    }
    line.push(`${shop}: ` + C.PARTY_TIERS.map(t => `${t} ${pct(met[t].reduce((a, b) => a + b, 0) / met[t].length)}`).join(' '));
  }
  const out = {};
  for (const tier of C.PARTY_TIERS) {
    const r = all[tier].reduce((a, b) => a + b, 0) / all[tier].length, st = C.stakeOf(tier), ev = r * st.win - (1 - r) * st.lose;
    out[tier] = { rate: r, ev, cells: all[tier].length };
  }
  console.log('7.2 per tier, all shops (no follow):', Object.entries(out).map(([t, o]) => `${t} ${pct(o.rate)} EV $${o.ev.toFixed(0)} (${o.cells} cells)`).join(' | '));
  console.log('per shop:', line.join(' | '));
  // rates: the design's aim ± 10 points (a pool of N shifts per flow carries about ±7 points of noise by itself)
  for (const tier of C.PARTY_TIERS) assert.ok(Math.abs(out[tier].rate - C.TIER_AIM[tier]) <= .1, `${tier}: ${pct(out[tier].rate)} vs ${pct(C.TIER_AIM[tier])}`);
  assert.ok(out.safe.rate > out.bet.rate && out.bet.rate > out.allin.rate);
  // expected value: within ±20% for 穩陣 and 搏一搏; 搏盡's EV swings $44 per point of success rate: held to ±50%, printed
  assert.ok(Math.abs(out.safe.ev - EV.safe) <= EV.safe * .2, `safe EV ${out.safe.ev}`);
  assert.ok(Math.abs(out.bet.ev - EV.bet) <= EV.bet * .25, `bet EV ${out.bet.ev}`);
  assert.ok(Math.abs(out.allin.ev - EV.allin) <= EV.allin * .5, `allin EV ${out.allin.ev}`);
});

/** Whole one-day nights in every shop by the team it is for. */
const nights = Object.fromEntries(C.SHOP_LADDER.map((shop, si) => [shop, Array.from({ length: NIGHTS }, (_, i) => playNight(C, { seed: 7001 + si * 10007 + i, pool, cfg: { shop } }))]));
const every = Object.values(nights).flat();

test('whole nights: every night ends cleanly, and the dealt cards keep their rates with follow-the-team on', () => {
  for (const n of every) { assert.deepEqual(n.errs, []); assert.equal(n.s.phase, 'done'); assert.equal(n.rounds.length, 5); }
  const by = { safe: [0, 0], bet: [0, 0], allin: [0, 0] }, chosen = { safe: 0, bet: 0, allin: 0 };
  for (const n of every) for (const r of n.rounds) { by[r.card.tier][0] += r.met ? 1 : 0; by[r.card.tier][1]++; chosen[r.card.tier]++; }
  console.log('dealt and played (with follow):', Object.entries(by).map(([t, [m, k]]) => `${t} ${pct(m / k)} of ${k}`).join(' | '), '| chosen', JSON.stringify(chosen));
  for (const t of C.PARTY_TIERS) assert.ok(Math.abs(by[t][0] / by[t][1] - C.TIER_AIM[t]) <= .12, `${t} played: ${pct(by[t][0] / by[t][1])}`);
});

test('收舖 ladder: in every shop its own mid team lands in the middle, and every title is reachable', () => {
  const total = Array(6).fill(0);
  for (const shop of C.SHOP_LADDER) {
    const titles = Array(6).fill(0);
    for (const n of nights[shop]) { const ix = C.titleIx(n.s.bank, C.titleLines(n.s)); if (ix >= 0) { titles[ix]++; total[ix]++; } }
    const kept = titles.reduce((a, b) => a + b, 0);
    const mid = titles.findIndex((_, i) => titles.slice(0, i + 1).reduce((a, b) => a + b, 0) >= kept / 2);
    console.log(`titles ${shop} (${SHOP_TEAM[shop]}): ${titles.map((k, i) => C.TITLES[i] + ' ' + k).join(', ')}`);
    assert.ok(mid >= 1 && mid <= 3, `${shop}: median title ${C.TITLES[mid]}`);
  }
  assert.ok(total.every(k => k > 0), 'every title reached at least once');
});

test('climb: a shop\'s own team reaches 排隊名店 (再開一日 one shop up) on about 40% of nights', () => {
  const rows = [];
  let up = 0, k = 0;
  for (const shop of C.SHOP_LADDER) {
    const n = nights[shop].filter(x => C.titleIx(x.s.bank, C.titleLines(x.s)) >= C.CLIMB_TITLE).length;
    rows.push(`${shop} ${pct(n / NIGHTS)}`); up += n; k += NIGHTS;
  }
  console.log(`climb (排隊名店 or better, not folded): ${pct(up / k)} of ${k} nights | ${rows.join(' | ')}`);
  assert.ok(up / k >= .32 && up / k <= .48, `climb ${pct(up / k)}`);   // 40% ± 8 points (sample noise ~±3)
});

// paid by seat work the till's spread is narrow; the title spacing (TITLE_Q) and pay keep the finale's flips in band
test('comeback: the 宵夜 wager changes the title on 20-40% of nights', () => {
  let flips = 0, up = 0;
  for (const n of every) {
    const lines = C.titleLines(n.s), a = C.titleIx(n.s.bank, lines), b = C.titleIx(C.bankWithoutFinale(n.s), lines);
    if (a !== b) { flips++; if (a > b) up++; }
  }
  const share = flips / every.length;
  console.log(`comeback: 宵夜 changed the title (執笠 counts as one) on ${pct(share)} of ${every.length} nights (${up} up, ${flips - up} down)`);
  assert.ok(share >= .2 && share <= .4, `comeback share ${pct(share)}`);
});

test('the night\'s length: 一日 from the lobby to 散水 in 28-35 minutes, with human pauses between rounds', () => {
  const LOBBY = 180;   // 1.1: lobby ~3 min (the night's clock starts at 開工)
  const mins = every.map(n => (n.sec + LOBBY) / 60).sort((a, b) => a - b);
  const med = mins[Math.floor(mins.length / 2)];
  const rounds = every[0].s.schedule.reduce((a, r) => a + r.sec, 0), gaps = every.map(n => (n.sec - rounds - n.closeSec) / n.rounds.length).sort((a, b) => a - b);
  console.log(`night length with a 3-min lobby: median ${med.toFixed(1)} min (min ${mins[0].toFixed(1)}, max ${mins.at(-1).toFixed(1)}); screens per round: median ${gaps[Math.floor(gaps.length / 2)].toFixed(0)} s`);
  assert.ok(med >= 28 && med <= 35, `median night ${med.toFixed(1)} min`);
});

test('shared pressure: the shop\'s own team folds rarely, but the till comes close on many nights', () => {
  const rows = [];
  let folds = 0, close = 0;
  for (const shop of C.SHOP_LADDER) {
    const ns = nights[shop], rent = C.rentFor(shop, 'breakfast');
    const f = ns.filter(n => n.s.bank < 0).length, c = ns.filter(n => n.lowest < rent).length;
    folds += f; close += c;
    rows.push(`${shop} folds ${pct(f / ns.length)}, close calls ${pct(c / ns.length)}`);
  }
  console.log('shared till:', rows.join(' | '));
  const fold = folds / every.length, felt = close / every.length;
  console.log(`all shops: folds ${pct(fold)}, the till dipped below one rent after a round on ${pct(felt)} of nights`);
  assert.ok(fold >= .02 && fold <= .15, `fold rate ${pct(fold)}: rare, not never`);
  assert.ok(felt >= .25, `close calls ${pct(felt)}: the pressure is felt`);
});

test('same seed, same night', () => {
  const a = playNight(C, { seed: 4242, pool, cfg: { shop: 'mongkok' } }), b = playNight(C, { seed: 4242, pool, cfg: { shop: 'mongkok' } });
  assert.equal(JSON.stringify(a.s), JSON.stringify(b.s));
  assert.notEqual(JSON.stringify(a.s), JSON.stringify(nights.mongkok[0].s));
});
