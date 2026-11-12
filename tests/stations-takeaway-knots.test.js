// The 外賣 knot library, in memory: 10 tiers of 10 knots graded by complexity. Each knot is
// measured exactly as the game draws it on a 390 x 844 phone (decoded, fitted to the tie area, resampled): path length,
// total turning, self-crossings and the combined score. The tiers must not overlap on the score, every tier's ten
// patterns must look different and come from at least five families, every family must turn up in several tiers, tier 1
// must be fair on a phone (wide trace band, strokes far apart, gentle curves), and the pick must be the same on every
// phone (tier from the state, the pattern kept in the tie). A session draws the patterns from a bag.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadStation, countingRng, ctxOf, run as runStation } from './helpers/stations.js';

const T = await loadStation('takeaway');
const R = T.tieRect(T.layout(130, 260), 3);
const lib = Array.from({ length: T.KNOT_TIERS }, (_, t) => Array.from({ length: T.KNOT_PATTERNS }, (_, p) => {
  const k = T.knotDef(t + 1, p), pts = T.knotPts(k, R);
  return { k, pts, m: T.knotMetrics(pts, R) };
}));

test('100 knots: 10 tiers of 10, each tier strictly more complex than the one before', () => {
  assert.equal(lib.flat().length, 100);
  const rows = [];
  for (let t = 0; t < lib.length; t++) {
    const s = lib[t].map(x => x.m.score), lo = Math.min(...s), hi = Math.max(...s);
    const avg = f => lib[t].reduce((a, x) => a + f(x.m), 0) / lib[t].length;
    rows.push(`tier ${t + 1}: score ${lo.toFixed(2)}-${hi.toFixed(2)}, mean length ${Math.round(avg(m => m.len))} px, turning ${avg(m => m.turn).toFixed(1)} laps, crossings ${avg(m => m.crossings).toFixed(1)}`);
    if (t) assert.ok(lo > Math.max(...lib[t - 1].map(x => x.m.score)), `tier ${t + 1} overlaps tier ${t}: ${rows.slice(-2).join(' / ')}`);
    for (const x of lib[t]) assert.ok(x.m.len > 0 && x.m.turn > 0 && Number.isFinite(x.m.score), `${t + 1}-${x.k.pat} measured`);
  }
  // the parts move with the tiers too: tier 10's knots are longer and turn more than tier 1's
  const mean = (t, f) => lib[t].reduce((a, x) => a + f(x.m), 0) / 10;
  assert.ok(mean(9, m => m.len) > 2 * mean(0, m => m.len), 'tier 10 at least twice as long as tier 1');
  assert.ok(mean(9, m => m.turn) > 3 * mean(0, m => m.turn), 'tier 10 turns at least three times as much as tier 1');
  console.log(rows.join('\n'));
});

test('each tier\'s ten knots look different (shape distance with mirror and turn ignored, and how each is built)', () => {
  for (const [t, tier] of lib.entries()) for (let i = 0; i < 10; i++) for (let j = i + 1; j < 10; j++) {
    const a = tier[i], b = tier[j], fam = a.k.fam === b.k.fam, d = T.shapeDist(a.pts, b.pts), min = fam ? 0.35 : 0.22, tag = `${t + 1}-${i} (${a.k.name}) and ${t + 1}-${j} (${b.k.name})`;
    // two of one name must differ in outline alone; otherwise corners, crossings, turns or ends may tell them apart
    if (fam && a.k.name === b.k.name) assert.ok(d >= min, `${tag} look alike: ${d.toFixed(3)} < ${min}`);
    else assert.ok(!T.looksAlike(a.pts, a.m, b.pts, b.m, min), `${tag} look alike: distance ${d.toFixed(3)}, corners ${a.m.corners}/${b.m.corners}, crossings ${a.m.crossings}/${b.m.crossings}`);
  }
  // a square and a pentagon have close outlines but are different drawings; the same knot turned over is alike
  const sq = lib.flat().find(x => x.k.name === '四方形'), pent = lib.flat().find(x => x.k.name === '五邊形打圈' || x.k.name === '六邊形');
  if (sq && pent) assert.ok(!T.looksAlike(sq.pts, sq.m, pent.pts, pent.m, 0.35));
  for (const x of [lib[0][0], lib[5][3], lib[9][9]]) {
    const flip = x.pts.map(([px, py, c]) => c ? [2 * R.x + R.w - px, py, 1] : [2 * R.x + R.w - px, py]);
    assert.ok(T.looksAlike(x.pts, x.m, flip, T.knotMetrics(flip, R), 0.22), `${x.k.name} mirrored is the same drawing`);
  }
});

test('visible variety: every tier draws from at least seven families, all 17 families turn up, each in several tiers', () => {
  const fams = new Set(lib.flat().map(x => x.k.fam)), tiersOf = {};
  assert.ok(fams.size >= 17, `families: ${[...fams]}`);
  for (const [t, tier] of lib.entries()) {
    const fs = new Set(tier.map(x => x.k.fam));
    assert.ok(fs.size >= 7, `tier ${t + 1}: only ${fs.size} families (${[...fs]})`);
    for (const f of fs) tiersOf[f] = (tiersOf[f] ?? 0) + 1;
  }
  for (const f of fams) assert.ok(tiersOf[f] >= 3, `${f} only in ${tiersOf[f]} tiers`);
  console.log(Object.entries(tiersOf).map(([f, n]) => `${f} ${n}`).join(', '));
  // the shape distance itself: the same drawing turned, mirrored or traced backwards is 0; a different one is not
  const k = lib[4][0].pts, turned = k.map(([x, y]) => [-y, x]), mirrored = k.map(([x, y]) => [-x, y]);
  assert.ok(T.shapeDist(k, turned) < 0.02 && T.shapeDist(k, mirrored) < 0.02 && T.shapeDist(k, k.slice().reverse()) < 0.02);
});

test('tier 1 is fair on a phone: the widest band, strokes well apart, nothing sharper or tighter than 新人 allows', () => {
  const band = T.knotBand(1), rookie = T.TUNE.diff.rookie;
  assert.ok(band >= rookie.band, `tier 1 band ${band} >= 新人's ${rookie.band}`);
  for (let t = 1; t < 10; t++) assert.ok(T.knotBand(t + 1) <= T.knotBand(t), 'bands never widen with the tier');
  const rules = { ...rookie, gap: band * 1.05, lenK: [0, 1e9], maxCross: 1e9 };
  for (const x of lib[0]) assert.equal(T.checkPath(x.pts, rules, R).why, '', `1-${x.k.pat} ${x.k.name} breaks a finger rule`);
});

test('today\'s difficulties sit at three rising tiers; the tier and the order seed pick the knot, the same on every phone', () => {
  const b = T.KNOT_TUNE.base;
  assert.ok(b.rookie < b.pro && b.pro < b.ace, JSON.stringify(b));
  for (const d of ['rookie', 'pro', 'ace']) {
    const run = () => {
      const rng = countingRng(7), s = T.takeaway.init({ difficulty: d, seed: 7, players: 1 }, 's1');
      assert.equal(s.knot, b[d]);
      // pack the first slip by hand state, then press 綁袋
      for (let i = 0; i < 2000 && !s.orders.length; i++) T.takeaway.step(s, 1 / 60, ctxOf(i / 60, rng));
      return s;
    };
    const a = run(), c = run();
    assert.equal(a.orders[0].seed, c.orders[0].seed, 'same run, same order seed');
  }
  // the pick itself: a state handed to another phone keeps the tie spec and draws the same path
  const rng = countingRng(3), s = T.takeawayDrill.init({ difficulty: 'pro', seed: 3, players: 1 }, 's1');
  for (let i = 0; i < 120 && !s.tie; i++) T.takeawayDrill.step(s, 1 / 60, ctxOf(i / 60, rng));
  assert.ok(s.tie, 'the drill starts a tie');
  assert.equal(s.tie.tier, b.pro);
  const copy = JSON.parse(JSON.stringify(s));
  assert.equal(T.validate(copy), true);
  assert.deepEqual(T.tiePath(copy.tie).pts, T.tiePath(s.tie).pts);
  assert.deepEqual(T.tiePath(s.tie).pts, T.knotPts(T.knotDef(s.tie.tier, s.tie.pat), s.tie.R));
});

// One player tied 川 three or four times in one session. A session draws each tier's knots from a
// shuffled bag (no repeat until the bag is empty) and never the same family twice in a row, also across a refill and
// when the tier changes.
const famOf = (t, p) => T.knotDef(t, p).fam;
const distinctFams = t => new Set(Array.from({ length: T.KNOT_PATTERNS }, (_, p) => famOf(t, p))).size;

test('the knot bag: a tier of ten families gives each of its ten knots once per ten draws, no family twice running', () => {
  for (let t = 1; t <= T.KNOT_TIERS; t++) {
    const b = T.newKnotBag(), rng = countingRng(t * 101), seq = Array.from({ length: 200 }, () => T.drawKnot(b, t, Math.floor(rng.next() * 1e6)));
    for (let i = 1; i < seq.length; i++) assert.notEqual(famOf(t, seq[i]), famOf(t, seq[i - 1]), `tier ${t}: ${famOf(t, seq[i])} twice running at draw ${i}`);
    if (distinctFams(t) === T.KNOT_PATTERNS) {
      for (let i = 0; i + T.KNOT_PATTERNS <= seq.length; i += T.KNOT_PATTERNS) assert.equal(new Set(seq.slice(i, i + T.KNOT_PATTERNS)).size, T.KNOT_PATTERNS, `tier ${t}: draws ${i}..${i + 9} ${seq.slice(i, i + 10)}`);
    } else {
      // a tier that repeats a family (9, 10): a knot comes back only after several others, and every knot turns up
      for (let i = 0; i < seq.length; i++) for (let j = i + 1; j < Math.min(seq.length, i + T.KNOT_PATTERNS / 2); j++) assert.notEqual(seq[j], seq[i], `tier ${t}: knot ${seq[i]} again after ${j - i} draws`);
      assert.equal(new Set(seq).size, T.KNOT_PATTERNS, `tier ${t}: every knot drawn`);
    }
  }
});

test('the knot bag across tier changes (the 試玩 slider): no family twice running, each tier still without quick repeats', () => {
  const b = T.newKnotBag(), rng = countingRng(5), seq = [];
  for (let i = 0; i < 600; i++) { const t = 3 + Math.floor(rng.next() * 4), p = T.drawKnot(b, t, Math.floor(rng.next() * 1e6)); seq.push([t, p, famOf(t, p)]); }
  for (let i = 1; i < seq.length; i++) assert.notEqual(seq[i][2], seq[i - 1][2], `family ${seq[i][2]} twice running at draw ${i}`);
  for (let t = 3; t <= 6; t++) {
    const mine = seq.filter(x => x[0] === t).map(x => x[1]);
    for (let i = 0; i < mine.length; i++) for (let j = i + 1; j < Math.min(mine.length, i + 5); j++) assert.notEqual(mine[j], mine[i], `tier ${t}: knot ${mine[i]} again after ${j - i} of its draws`);
  }
});

test('a session of shifts at the 外賣 seat: the bag carries over, so 川 (or any knot) is not tied again until the tier went round', () => {
  T.resetKnotBag();
  const ties = [];
  for (let k = 0; k < 4; k++) {   // four shifts in one session (one page), the bot packing and tying
    const s = T.takeaway.init({ difficulty: 'rookie', seed: 40 + k, players: 1 }, 's1');
    runStation(T.takeaway, s, countingRng(40 + k), { secs: T.TUNE.shift + 5 });
    ties.push(...s.ties);
  }
  const tier = T.KNOT_TUNE.base.rookie;
  assert.ok(ties.length >= 12, `ties ${ties.length}`);
  assert.ok(ties.every(t => t.tier === tier));
  for (let i = 1; i < ties.length; i++) assert.notEqual(ties[i].fam, ties[i - 1].fam, `${ties[i].name} twice running`);
  for (let i = 0; i + T.KNOT_PATTERNS <= ties.length; i += T.KNOT_PATTERNS) assert.equal(new Set(ties.slice(i, i + T.KNOT_PATTERNS).map(t => t.pat)).size, T.KNOT_PATTERNS, `ties ${i}..${i + 9}: ${ties.slice(i, i + 10).map(t => t.name)}`);
  const chuan = ties.filter(t => t.name === '川').length;
  assert.ok(chuan <= Math.ceil(ties.length / T.KNOT_PATTERNS), `川 tied ${chuan} times in ${ties.length} ties`);
  T.resetKnotBag();
});
