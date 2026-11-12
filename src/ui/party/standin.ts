// The playtest page's stand-in for the referee's round (site/party.html): a round report drawn from the bot calibration,
// and the fake players' moves. Not part of the screens and not a rule of the night: it only plays the other side.
//
// The team's numbers come from the card lines' own table (core/party/lines.ts: 21-point quantiles of 960 real in-memory
// team shifts, "human x1" bots at all four stations, scripts/party-calibrate.mjs): one luck draw per round places the team
// on every metric's quantile with a little noise per metric, so a round looks like a real shift of that flow and
// shop. 'good' and 'bad' pin the luck high or very low (bad also wipes the takings, so the till falls below the rent).
import { PARTY_SEATS, isPartyFloor } from '../../core/party/config';
import { allReady } from '../../core/party/night';
import { quantilesOf, qAt } from '../../core/party/wager';
import type { NightState, PartyEvent, PlayerId, PlayerRoundStats, RoundPlan, RoundReport, SeatId, StationReport } from '../../core/party/types';

export type Luck = 'auto' | 'good' | 'bad';

/** Mulberry32: the page's own seeded stream (the night keeps its own). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Who drove which seat for how long this round, from the round start and the 'drive' hand-overs. */
export class DriveLog {
  private open: Record<SeatId, { player: PlayerId; from: number } | null> = {};
  private done: Record<SeatId, Record<PlayerId, number>> = {};
  constructor(seats: Record<SeatId, PlayerId | null>, t: number) {
    for (const [seat, p] of Object.entries(seats)) { this.done[seat] = {}; this.open[seat] = p === null ? null : { player: p, from: t }; }
  }
  drive(seat: SeatId, player: PlayerId | null, t: number): void {
    this.close(seat, t);
    this.open[seat] = player === null ? null : { player, from: t };
  }
  private close(seat: SeatId, t: number): void {
    const o = this.open[seat], d = this.done[seat] ?? (this.done[seat] = {});
    if (o) d[o.player] = (d[o.player] ?? 0) + Math.max(0, t - o.from);
    this.open[seat] = null;
  }
  /** Ends the round at t: per seat, each player's seconds. */
  end(t: number): Record<SeatId, Record<PlayerId, number>> {
    for (const seat of Object.keys(this.open)) this.close(seat, t);
    return this.done;
  }
}

const SEAT_MEASURES: Record<string, { key: string; label: string; per: number }[]> = {
  waiter: [{ key: 'slips', label: '單寫啱', per: 1 }, { key: 'seatSec', label: '平均落單秒', per: 0 }],
  bar: [{ key: 'cups', label: '出咗杯數', per: 1.4 }, { key: 'redo', label: '重做', per: 0 }],
  kitchen: [{ key: 'dishes', label: '出咗碟數', per: 1.1 }, { key: 'burnt', label: '燶咗', per: 0 }],
  till: [{ key: 'bills', label: '埋咗單', per: .8 }, { key: 'exact', label: '找啱晒', per: .6 }],
  floor: [{ key: 'jobs', label: '做咗', per: 1.2 }],   // 樓面: each of its two places is one player's part
};
const BEST: Record<string, string> = { waiter: '一張單寫齊六個人', bar: '一壺茶出咗 9 杯', kitchen: '連續 5 碟冇燶', till: '$500 找啱晒' };
const clamp01 = (x: number): number => Math.max(0.001, Math.min(.999, x));

/** A round report for the plan, as the referee would send it. */
export function standinReport(plan: RoundPlan, drove: Record<SeatId, Record<PlayerId, number>>, luck: Luck, r: () => number): RoundReport {
  const base = luck === 'good' ? .8 + r() * .18 : luck === 'bad' ? .02 : r();
  const at = (metric: Parameters<typeof quantilesOf>[2], good: boolean): number => {
    const u = clamp01(base + (r() - .5) * .2);
    return Math.round(qAt(quantilesOf(plan.shop, plan.kind, metric), good ? u : 1 - u));
  };
  const revenue = luck === 'bad' ? Math.round(r() * 40) : at('rev', true), tips = luck === 'bad' ? 0 : at('tips', true);
  const team = { revenue, tips, mistakes: at('clean', false) + (luck === 'bad' ? 6 : 0), angry: at('calm', false) + (luck === 'bad' ? 4 : 0), maxCombo: at('combo', true), fevers: at('fever', true), served: Math.round(revenue / 45), sales: Math.round(revenue * 1.1) };   // sales: the till's takings, a display
  const seats = Object.keys(plan.seats).length ? Object.keys(plan.seats) : [...PARTY_SEATS];
  const stations: StationReport[] = seats.map(seat => {
    const kind = isPartyFloor(seat) ? 'floor' : seat.split('#')[0] ?? seat, u = clamp01(base + (r() - .5) * .5);
    const stars = u > .75 ? 3 : u > .45 ? 2 : u > .2 ? 1 : 0;
    const measures = (SEAT_MEASURES[kind] ?? []).map(m => ({ key: m.key, label: m.label, value: m.per ? Math.round(team.served * m.per * (.6 + u * .5)) : m.key === 'seatSec' ? Math.round((30 - u * 18) * 10) / 10 : Math.round((1 - u) * 4) }));
    const drivers = Object.entries(drove[seat] ?? {}).filter(([, sec]) => sec > 0).map(([player, sec]) => ({ player, sec: Math.round(sec * 10) / 10 }));
    return { seat, kind, stars, measures, best: stars === 3 ? BEST[kind] ?? null : null, drivers };
  });
  const players: PlayerRoundStats[] = [];
  for (const st of stations) for (const d of st.drivers) {
    const done = Math.max(0, Math.round((st.measures[0]?.value ?? 0) * d.sec / plan.sec)), miss = Math.round(team.mistakes / Math.max(1, seats.length));
    players.push({ player: d.player, done, avgSec: done ? Math.round(d.sec / done * 10) / 10 : 0, mistakes: miss, burnt: st.kind === 'kitchen' ? Math.round(r() * 3) : 0,
      exact: st.kind === 'till' ? Math.round(done * .6) : 0, helps: Math.round(r() * 3), hurries: Math.round(r() * 4), streak: Math.max(0, done - miss * 3),
      pay: Math.round(revenue * d.sec / (plan.sec * Math.max(4, seats.length))) });   // their share of the round's pay
  }
  return { round: plan.round, team, stations, players };
}

/**
 * What the fake players do on their own (the page's 其他人自動): vote after a beat, tap 下一步, tap 我準備好 when seated,
 * and (when the boss is a fake) start the countdown once everyone is ready. Everyone but `skip` (the phone being looked
 * at). One move per call, so presses look like people.
 */
export function fakeMove(s: NightState, fakes: readonly PlayerId[], skip: PlayerId, r: () => number): PartyEvent | null {
  for (const [i, id] of fakes.entries()) {
    const p = s.players.find(q => q.id === id);
    if (!p?.present || id === skip) continue;
    const after = 1.5 + i * .7;
    if (s.phase === 'vote' && s.wager && s.phaseT >= after && s.wager.votes[id] === undefined && (s.cfg.chooser === 'vote' || s.host === id)) {
      const x = r();
      return { k: 'vote', player: id, card: x < .4 ? 0 : x < .8 ? 1 : 2 };
    }
    if (s.phase === 'endcard' && s.phaseT >= after + 2 && !s.taps.includes(id)) return { k: 'next', player: id };
    if (s.phase === 'ready' && p.seat !== null && s.phaseT >= after && !s.taps.includes(id)) return { k: 'ready', player: id, on: true };
  }
  if (s.phase === 'ready' && s.host !== null && s.host !== skip && fakes.includes(s.host) && s.phaseT >= 2 && allReady(s)) return { k: 'start', player: s.host };
  return null;
}
