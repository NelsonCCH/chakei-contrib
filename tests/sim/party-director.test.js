// The party director (core/party/director.ts): every seat its own core work on a party night,
// along the night's curve, scaled by the players on its position; no seat waits on another; the round's money is the
// players' own work (core/party/pay.ts). The guards:
//   (a) one seat's player idle (helped, then covered by the computer): every other seat's work is unchanged within noise
//   (b) the work offered over a round follows the curve: busier at the peak than at the start and the end
//   (c) two players on a position get twice its pace; on a 樓面 shop one mid player on 樓面 keeps up
//       (parties served about as well as one mid player alone in 屋邨), two get about twice its work, neither idles
//   (d) the round's money adds up from each player's pay
//   (e) at the mid profile each seat's longest idle is at most 6 s (median of 3 seeds), every party shop and player count
// and the director is deterministic per seed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { longestIdle } from './idle.js';
import { freshCore } from './core.js';

const ROOT = join(import.meta.dirname, '..', '..');
const SEEDS = [51, 52, 53];
const C = freshCore();
const sum = (into, x) => { for (const [k, v] of Object.entries(x ?? {})) into[k] = (into[k] ?? 0) + v; return into; };

test('(e) idle gate: every seat idles at most 6 s at the mid profile (3-seed median), every party shop and player count', { timeout: 600000 }, () => {
  const r = spawnSync(process.execPath, [join(ROOT, 'scripts', 'idle-probe.mjs'), '--levels', '', '--seeds', '3', '--check', '6'], { encoding: 'utf8' });
  console.log(r.stdout.split('\n').filter(l => l.startsWith('|') || l.startsWith('over')).join('\n'));
  assert.equal(r.status, 0, r.stdout.slice(-1500) + r.stderr.slice(-500));
});

// the base rooms the next guards share: 地獄午市 with a full room (樓面 x2, 水吧, 廚房, 收銀, 燒味) and 機場 with five, 3 seeds each
const base = {};
const baseRoom = (shop, n, seed) => (base[`${shop}${n}${seed}`] ??= longestIdle({ mode: 'party', id: shop, n, seed }));

test('(a) one player idle: every other seat\'s work is unchanged within noise (the helpers, then the computer\'s cover)', { timeout: 300000 }, () => {
  const rows = [];
  for (const [shop, n, lazySeat, win] of [['hell', 6, 'kitchen', [20, 230]], ['hell', 6, 'floor1', [20, 230]], ['airport', 5, 'floor1', [60, 85]], ['airport', 5, 'bar', [60, 85]]]) {
    const b = {}, l = {};
    for (const seed of SEEDS) { sum(b, baseRoom(shop, n, seed).results); sum(l, longestIdle({ mode: 'party', id: shop, n, seed, lazy: { [lazySeat]: win } }).results); }
    for (const st of Object.keys(b)) {
      if (st === lazySeat || b[st] < 30) continue;   // too few results to read a change in (the sim's kitchen and bag hands are slow)
      const ratio = (l[st] ?? 0) / b[st];
      rows.push(`${shop} x${n} ${lazySeat} idle ${win.join('-')} s: ${st} ${b[st]} -> ${l[st] ?? 0} (${ratio.toFixed(2)})`);
      const tol = Math.max(0.25 * b[st], 2 * Math.sqrt(b[st]));   // a quarter, or two counting-noise sigmas on small counts
      assert.ok(Math.abs((l[st] ?? 0) - b[st]) <= tol, rows.at(-1));
    }
  }
  console.log(rows.join('\n'));
});

test('(b) the work offered follows the night\'s curve: the peak is busier than the start and the end', { timeout: 300000 }, () => {
  assert.ok(C.curve(0) < 0.7 && C.curve(0.6) >= 1.15 && C.curve(1) < 0.8, 'the curve: slow start, a peak over a mid player, a wind-down');
  const tot = Array(10).fill(0);
  for (const [shop, n] of [['hell', 6], ['airport', 5]]) for (const seed of SEEDS) {
    for (const v of Object.values(baseRoom(shop, n, seed).dir.off)) v.forEach((x, i) => { tot[i] += x; });
  }
  const peak = (tot[4] + tot[5] + tot[6] + tot[7]) / 4, start = tot[1], end = tot[9];
  console.log(`offered work by tenth of the round (mid s): ${tot.map(Math.round).join(' ')}; peak ${peak.toFixed(0)}, start ${start.toFixed(0)}, end ${end.toFixed(0)}`);
  assert.ok(peak >= 1.15 * start, `peak ${peak.toFixed(0)} vs start ${start.toFixed(0)}`);
  assert.ok(peak >= 1.15 * end, `peak ${peak.toFixed(0)} vs end ${end.toFixed(0)}`);
});

test('(c) two players on a position get twice its pace (a shared position, 樓面\'s floor seats)', () => {
  const X = freshCore();
  X.newGame();
  const G = X.G;
  G.party = { shop: 'estate', sec: 240, round: 0, twist: null }; G.t = 120;
  G.roles = { floor1: 'remote', bar: 'ai' };
  const one = X.pace('floor1');
  G.roles = { floor1: 'remote', floor2: 'remote', bar: 'ai' };
  const two = X.pace('floor1');
  assert.ok(Math.abs(two - 2 * one) < 1e-9, `one ${one}, two ${two}`);
  assert.equal(X.playersOn('floor2'), 2);
  G.roles = { bar: 'remote' };
  assert.equal(X.pace('bar'), X.curve(0.5), 'one player at the bar: the curve itself');
});

test('(c) 樓面: one mid player keeps up; two get about twice the floor work; neither idles past the gate', { timeout: 300000 }, () => {
  const served = r => { const t = r.report.team; return t.served / Math.max(1, t.served + t.angry); };
  const med = xs => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const ref = med(SEEDS.map(seed => served(longestIdle({ mode: 'party', id: 'estate', n: 1, seed }))));
  const rows = [];
  for (const shop of ['central', 'hell']) {
    let one = 0, two = 0;
    const idle = [], sv = [];
    for (const seed of SEEDS) {
      const a = longestIdle({ mode: 'party', id: shop, n: 1, seed, seats: ['floor1'] }), b = longestIdle({ mode: 'party', id: shop, n: 2, seed, seats: ['floor1', 'floor2'] });
      const work = r => r.report.players.reduce((x, p) => x + (p.floor ?? 0), 0);   // 樓面 work done, in a mid player's seconds
      one += work(a); two += work(b);
      idle.push(Math.max(a.idle.floor1 ?? 0, b.idle.floor1 ?? 0, b.idle.floor2 ?? 0)); sv.push(served(a));
    }
    const ratio = two / Math.max(1, one);
    rows.push(`${shop}: 樓面 work (mid s) one ${one}, two ${two} (x${ratio.toFixed(2)}); served with one ${(100 * med(sv)).toFixed(0)}% (屋邨 alone ${(100 * ref).toFixed(0)}%); longest idle ${med(idle).toFixed(1)} s`);
    assert.ok(ratio >= 1.6 && ratio <= 2.4, rows.at(-1));
    assert.ok(med(sv) >= ref - 0.1, rows.at(-1));
    assert.ok(med(idle) <= 6, rows.at(-1));
  }
  console.log(rows.join('\n'));
});

test('(d) the round\'s money adds up from each player\'s pay at their own seats', { timeout: 120000 }, () => {
  for (const [shop, n] of [['airport', 4], ['hell', 6], ['estate', 1]]) {
    const r = baseRoom(shop, n, 51), rep = r.report;
    assert.ok(rep, 'a report');
    const slot = 'lunch', jobs = {}, mistakes = {};
    let seatSec = 0;
    for (const st of rep.stations) {
      if (st.kind === 'floor') { seatSec += st.drivers.reduce((a, d) => a + d.sec, 0); continue; }   // 樓面: each player's own seconds (p.floor)
      const all = st.drivers.reduce((a, d) => a + d.sec, 0), n = st.measures.find(m => m.key === 'jobs')?.value ?? 0;
      seatSec += all;
      for (const d of st.drivers) { (jobs[st.seat] ??= {})[d.player] = (jobs[st.seat]?.[d.player] ?? 0) + (all ? n * d.sec / all : 0); }
    }
    for (const p of rep.players) mistakes[p.player] = p.mistakes;
    let total = 0;
    for (const p of rep.players) {
      let v = (p.floor ?? 0) * C.jobPay('floor', slot); for (const [st, per] of Object.entries(jobs)) v += (per[p.player] ?? 0) * C.jobPay(st, slot);
      const want = Math.max(0, Math.round(v - p.mistakes * C.MISTAKE_PAY));
      assert.ok(Math.abs(p.pay - want) <= 1, `${shop} ${p.player}'s pay ${p.pay} vs ${want}`);   // 樓面's seconds are reported rounded
      total += p.pay;
    }
    const money = Math.round(total * C.TEAM_SEATS / Math.max(1, seatSec / 240));
    assert.equal(rep.team.revenue, money, `${shop} x${n}: the round's money is the players' pay summed, scaled to a team of four`);
    assert.ok(rep.team.sales > 0, 'the till\'s takings stay as a display');
    console.log(`${shop} x${n}: pay ${rep.players.map(p => `${p.player} $${p.pay}`).join(', ')} -> round $${rep.team.revenue} (till takings $${Math.round(rep.team.sales)})`);
  }
});

test('the director is deterministic per seed', { timeout: 120000 }, () => {
  const a = longestIdle({ mode: 'party', id: 'mongkok', n: 5, seed: 7 }), b = longestIdle({ mode: 'party', id: 'mongkok', n: 5, seed: 7 });
  assert.deepEqual(a.dir, b.dir);
  assert.deepEqual(a.report, b.report);
});
