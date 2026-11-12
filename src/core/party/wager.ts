// The three-card wager before each round: the metric pool, the line per tier, follow the
// team, dealing, who wins the vote, what a card pays, and the shared till's rent. Pure functions over plain data.
//
// Lines come from the bot (2.3): lines.ts holds, per shop, round flow and metric, the 21-point quantiles of what the
// shop's own bot team (PARTY_SHOPS `for`) did in real in-memory shifts at the shop's pace (scripts/party-calibrate.mjs).
// A tier's line is the value such a team reaches with the tier's aim (80 / 50 / 25%). Reuses the career's metrics,
// tiers, met test and card text.
import { targetMet, targetText } from '../career/targets';
import { cash } from '../util';
import type { TargetMetric, TargetTier } from '../career/targets';
import { CAP_METRICS, DEAL_SLACK, FOLLOW_CAP, FOLLOW_SHARE, METRIC_MIN, METRIC_STEP, PARTY_METRICS, PARTY_SHOPS, RENT_Q, RENT_STEP, SHOP_LADDER, TIER_AIM, TWISTS, stakeOf } from './config';
import { PARTY_Q } from './lines';
import type { LineKind } from './lines';
import { partyDraw } from './rand';
import type { Card, PartyMetric, RoundKind, RoundReport, Twist, Wager } from './types';

export const PARTY_TIERS: readonly TargetTier[] = ['safe', 'bet', 'allin'];

/** The calibration flow a round reads its lines from. */
export function lineKind(kind: RoundKind): LineKind {
  if (kind === 'late') return 'dinner';
  return kind;
}
const isCap = (m: PartyMetric): boolean => CAP_METRICS.includes(m);
const isCareer = (m: PartyMetric): m is TargetMetric => m === 'rev' || m === 'clean' || m === 'calm' || m === 'combo';

/** The quantile table for one cell; an unknown shop falls back to 旺角晚市, a missing table to a flat zero line. */
export function quantilesOf(shop: string, kind: RoundKind, metric: PartyMetric): readonly number[] {
  const byShop = PARTY_Q[shop] ?? PARTY_Q['mongkok'];
  return byShop?.[lineKind(kind)][metric] ?? [0, 0];
}

/** A round's rent and running costs at this shop: the shop's own team's takings at RENT_Q. */
export function rentFor(shop: string, kind: RoundKind): number {
  const id = SHOP_LADDER.find(x => x === shop), q = (id ? PARTY_SHOPS[id].rentQ : undefined) ?? RENT_Q;
  return Math.max(RENT_STEP, Math.round(qAt(quantilesOf(shop, kind, 'rev'), q) / RENT_STEP) * RENT_STEP);
}
/** The float the till opens the night with: the shop's `float` times the first round's rent. */
export function startTill(shop: string, first: RoundKind): number {
  const id = SHOP_LADDER.find(x => x === shop), float = id ? PARTY_SHOPS[id].float : 1;
  return Math.round(rentFor(shop, first) * float / RENT_STEP) * RENT_STEP;
}

/** The value at quantile u (0-1), linear between the table's points. */
export function qAt(q: readonly number[], u: number): number {
  const n = q.length - 1;
  if (n <= 0) return q[0] ?? 0;
  const x = Math.min(1, Math.max(0, u)) * n, i = Math.min(n - 1, Math.floor(x));
  const a = q[i] ?? 0, b = q[i + 1] ?? a;
  return a + (b - a) * (x - i);
}
/** The lowest u with Q(u) >= x (0 below the table, 1 above it). */
export function uAtLeast(q: readonly number[], x: number): number {
  const n = q.length - 1;
  if (n <= 0 || x <= (q[0] ?? 0)) return 0;
  for (let i = 0; i < n; i++) {
    const a = q[i] ?? 0, b = q[i + 1] ?? a;
    if (b >= x) return (i + (b > a ? (x - a) / (b - a) : 1)) / n;
  }
  return 1;
}
/** The highest u with Q(u) <= x (0 below the table, 1 above it). */
export function uAtMost(q: readonly number[], x: number): number {
  const n = q.length - 1;
  if (n <= 0 || x >= (q[n] ?? 0)) return 1;
  for (let i = n; i > 0; i--) {
    const a = q[i - 1] ?? 0, b = q[i] ?? a;
    if (a <= x) return (i - 1 + (b > a ? (x - a) / (b - a) : 0)) / n;
  }
  return 0;
}

/** The chance a mid team meets line n on this metric (count metrics get a half-step continuity correction). */
export function chanceOf(metric: PartyMetric, n: number, q: readonly number[]): number {
  const c = METRIC_STEP[metric] === 1 ? .5 : 0;
  return isCap(metric) ? uAtMost(q, n + c) : 1 - uAtLeast(q, n - c);
}

/** The line whose chance is closest to `aim`, on the metric's step and never under its minimum. */
export function lineFor(metric: PartyMetric, aim: number, q: readonly number[]): number {
  const step = METRIC_STEP[metric], x = qAt(q, isCap(metric) ? aim : 1 - aim), base = Math.floor(x / step) * step;
  let best = Math.max(METRIC_MIN[metric], base), bestD = Infinity;
  for (const k of [-1, 0, 1, 2]) {
    const n = Math.max(METRIC_MIN[metric], base + k * step), d = Math.abs(chanceOf(metric, n, q) - aim);
    if (d < bestD - 1e-9) { best = n; bestD = d; }
  }
  return best;
}

/** Where a value sits for this metric, 0 (worst) to 1 (best): for a cap, fewer is better. */
export function goodness(metric: PartyMetric, v: number, q: readonly number[]): number {
  const u = (uAtLeast(q, v) + uAtMost(q, v)) / 2;
  return isCap(metric) ? 1 - u : u;
}

/** The team's number for a metric. */
export function metricValue(metric: PartyMetric, team: RoundReport['team']): number {
  switch (metric) {
    case 'rev': return team.revenue;
    case 'clean': return team.mistakes;
    case 'calm': return team.angry;
    case 'combo': return team.maxCombo;
    case 'tips': return team.tips;
    case 'fever': return team.fevers;
  }
}
/** Did the team meet the card? The career's four go through the career's own test. */
export function cardMet(metric: PartyMetric, n: number, team: RoundReport['team']): boolean {
  if (isCareer(metric)) return targetMet(metric, n, { revenue: team.revenue, mistakes: team.mistakes, angry: team.angry, maxCombo: team.maxCombo });
  return metricValue(metric, team) >= n;
}
/** The card's words (the career's for its four metrics). */
export function cardText(metric: PartyMetric, n: number): string {
  if (metric === 'rev') return `全隊人工做到 ${cash(n)}`;   // the round's money is the seats' pay, not the till's takings
  if (isCareer(metric)) return targetText(metric, n);
  if (metric === 'tips') return `貼士儲到 ${cash(n)}`;
  return n === 1 ? '入一次旺場' : `入 ${String(n)} 次旺場`;
}
/** "上一更你哋做咗 $2,300". */
export function lastText(metric: PartyMetric, v: number): string {
  switch (metric) {
    case 'rev': return `上一更你哋人工 ${cash(v)}`;
    case 'tips': return `上一更貼士 ${cash(v)}`;
    case 'clean': return `上一更出錯 ${String(v)} 次`;
    case 'calm': return `上一更嬲走 ${String(v)} 個`;
    case 'combo': return `上一更連擊 ${String(v)}`;
    case 'fever': return `上一更入咗 ${String(v)} 次旺場`;
  }
}

/** Last scored round, as follow-the-team reads it. */
export interface FollowFrom { kind: RoundKind; shop: string; team: RoundReport['team'] }

/** The success chance a tier's line is set for: the tier's aim, moved halfway toward last round's result (capped). */
export function aimFor(tier: TargetTier, metric: PartyMetric, last: FollowFrom | null): number {
  const aim = TIER_AIM[tier];
  if (!last) return aim;
  const u = goodness(metric, metricValue(metric, last.team), quantilesOf(last.shop, last.kind, metric));
  const move = Math.max(-FOLLOW_CAP, Math.min(FOLLOW_CAP, FOLLOW_SHARE * (u - .5)));
  return Math.max(.05, Math.min(.95, aim - move));
}

/** One card for a tier and metric this round. */
export function makeCard(tier: TargetTier, metric: PartyMetric, kind: RoundKind, shop: string, last: FollowFrom | null): Card {
  const aim = aimFor(tier, metric, last), n = lineFor(metric, aim, quantilesOf(shop, kind, metric)), st = stakeOf(tier);
  return { tier, metric, n, text: cardText(metric, n), win: st.win, lose: st.lose, last: last ? metricValue(metric, last.team) : null, aim };
}

/** Can this metric carry this tier here (its line can land near the tier's aim)? */
export function dealable(tier: TargetTier, metric: PartyMetric, kind: RoundKind, shop: string): boolean {
  const q = quantilesOf(shop, kind, metric), aim = TIER_AIM[tier];
  return Math.abs(chanceOf(metric, lineFor(metric, aim, q), q) - aim) <= DEAL_SLACK;
}

/**
 * Deals three cards, one per tier, each a different metric, from the night's stream. The hardest tier
 * picks first (it has the fewest metrics that fit). Returns the cards in display order (穩陣, 搏一搏, 搏盡) and the stream.
 */
export function dealCards(rs: number, kind: RoundKind, shop: string, last: FollowFrom | null): { cards: Card[]; rs: number } {
  const used: PartyMetric[] = [], byTier: Partial<Record<TargetTier, Card>> = {};
  let s = rs;
  for (const tier of ['allin', 'bet', 'safe'] as const) {
    const free = PARTY_METRICS.filter(m => !used.includes(m)), fit = free.filter(m => dealable(tier, m, kind, shop));
    const pool = fit.length ? fit : free, d = partyDraw(s);
    s = d.next;
    const metric = pool[Math.floor(d.x * pool.length)] ?? 'rev';
    used.push(metric);
    byTier[tier] = makeCard(tier, metric, kind, shop, last);
  }
  const cards = PARTY_TIERS.map(t => byTier[t]).filter((c): c is Card => c !== undefined);
  return { cards, rs: s };
}

/** The 搏盡 twist for a round. */
export function drawTwist(rs: number): { twist: Twist; rs: number } {
  const d = partyDraw(rs);
  return { twist: TWISTS[Math.floor(d.x * TWISTS.length)] ?? 'rush', rs: d.next };
}

/**
 * Which card wins: the most votes; a tie goes to the host's card if the host voted for one of the tied
 * cards, otherwise to the safest of them; no votes at all is 穩陣. `crowd` is the onlookers' single shared vote.
 */
export function resolveVote(votes: readonly number[], host: number | null, ncards: number): number {
  const tally = Array.from({ length: ncards }, () => 0);
  for (const v of votes) if (Number.isInteger(v) && v >= 0 && v < ncards) tally[v] = (tally[v] ?? 0) + 1;
  const top = Math.max(0, ...tally);
  if (top === 0) return 0;
  const tied = tally.flatMap((n, i) => n === top ? [i] : []);
  if (host !== null && tied.includes(host)) return host;
  return tied[0] ?? 0;
}

/** The onlookers' one vote: their most-voted card, or none on a tie. */
export function crowdVote(votes: readonly number[]): number | null {
  const tally = new Map<number, number>();
  for (const v of votes) tally.set(v, (tally.get(v) ?? 0) + 1);
  let best: number | null = null, top = 0, tie = false;
  for (const [v, n] of tally) { if (n > top) { best = v; top = n; tie = false; } else if (n === top) tie = true; }
  return tie ? null : best;
}

/** Money a card moves: + win or − loss, doubled with the 孤注一擲 token (宵夜 doubles nothing: no pledges). */
export function cardPay(card: Card, met: boolean, token: boolean): number {
  return ((met ? card.win : -card.lose) * (token ? 2 : 1)) + 0;   // + 0: a missed 穩陣 is 0, not -0
}

/** An empty vote over freshly dealt cards. */
export function openWager(cards: Card[]): Wager {
  return { cards, votes: {}, token: [], allAt: null, chosen: null, tokenOn: false, twist: null };
}
