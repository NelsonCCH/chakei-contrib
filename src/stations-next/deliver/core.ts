// 送外賣 deliver station core: a top-down three-lane endless runner on a bicycle. Each tap of 加速 is
// one gear step up (a step change in speed, not a ramp) up to the top gear, where a rocket pushes the bike. Left / right
// change lane. Cars, minibuses and buses ride the lanes ahead; hitting one is a crash: a short penalty while the rider
// picks the bike up, then back to gear 0 and slow again. Slow and safe, or fast and risky; the cost is time away from
// the shop. A run carries 1-3 takeaway orders: one drop point (a building with the order number) per order along the
// road, then the road loops back to the shop, which ends the run. Every order has a countdown (the food going cold); an
// order dropped after it ran out is still delivered, flagged cold.
//
// Pure (contract.ts rules): time comes in as dt (a fixed 1/120 s inner step), randomness from ctx.rng (the traffic), the
// state is plain JSON. World units: metres along the road (`pos`, the rider's front-to-back centre), lanes 0..2 across.
//
// Work seam: the referee sends `{ kind: 'run', orders: [{ gid, no, left }] }` (1-3 orders, `left` = seconds until cold)
// and `{ kind: 'cancel' }`. A run that arrives during a run waits in `queue` and starts TUNE.homeT s after the rider is
// back. In lab mode (`selfFeed`, the default) the `start` command makes up n orders.
import type { BotModule, Difficulty, RefEvent, ShiftConfig, StationCtx, StationModule, StationStatus } from '../contract';
import { deliverBot } from './bot';

export const LANES = 3;
export type CarKind = 'taxi' | 'minibus' | 'bus';
export interface TierTune {
  tier: number;
  /**
   * Traffic comes in rows: 1 or 2 vehicles side by side, front edges level. The clear road between one row's
   * rear and the next row's front is a quick gap (share `quickP`, uniform in [qMin, qMax]) or breathing room ([bMin,
   * bMax]); a gap too short for the lane change the next row asks for is stretched to the shortest one a skilled rider
   * makes at the top gear (reachGap), so a quick run of rows is a run of fast lane changes, never a dead end.
   */
  qMin: number; qMax: number; bMin: number; bMax: number; quickP: number;
  /** Share of rows with two vehicles side by side (exactly one lane stays open). */
  pairP: number;
  /** Share of buses among the vehicles. */
  busP: number;
  /** Seconds a vehicle blinks before it changes lane, and the share of single-vehicle rows whose vehicle changes lane. */
  tele: number; chgP: number;
  /** Road length of a one-order run (shop -> drop -> back to the shop), and metres added per extra order. */
  base: number; extra: number;
}
const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;
const r2 = (x: number): number => Math.round(x * 100) / 100;
function tierRow(tier: number): TierTune {
  const k = (tier - 1) / 7;
  return {
    tier, qMin: 4, qMax: 10, bMin: Math.round(lerp(34, 20, k)), bMax: Math.round(lerp(60, 38, k)), quickP: r2(lerp(0.2, 0.55, k)),
    pairP: r2(lerp(0.15, 0.6, k)), busP: r2(lerp(0.08, 0.35, k)), tele: r2(lerp(1.2, 0.6, k)), chgP: r2(lerp(0.05, 0.3, k)),
    base: Math.round(lerp(705, 930, k) / 5) * 5, extra: Math.round(lerp(250, 280, k) / 5) * 5,
  };
}

const KIND_LEN: Record<CarKind, { len: number }> = { taxi: { len: 4.4 }, minibus: { len: 6.2 }, bus: { len: 11.5 } };
const DIFF_TIER: Record<Difficulty, number> = { rookie: 2, pro: 4, ace: 7 };
export const TUNE = {
  /**
   * m/s per gear; gear 0 is the slow start after a crash, the last gear is the rocket. Traffic closes in fast
   * at every gear (closing speed gear - vTraffic: 5 / 11 / 17 / 24 / 31 / 44 m/s); the roads are long to match, so a
   * run takes a sensible time. The rocket's 44 is the most
   * that leaves a skilled rider with 3 bags time to see a row, react and slide one lane before it (reachGap).
   * The screen shows 43 m ahead everywhere (not 39), so the top two gears are 1.09x a 39 m view's: closing
   * 34 / 48 (gear 4 37, rocket 51 m/s), the rocket with the same ~6% slack on the sight limit (43 - 0.9) / 0.82 s = 51.3.
   */
  gears: [8, 14, 20, 27, 37, 51] as const,
  /** Seconds between two gear steps (a tap faster than this is ignored), with one bag. */
  gearCd: 0.18,
  /**
   * The bag load trade (the 傳菜 tray's): by bags on the run (1, 2, 3), more bags pay a bigger tip
   * bonus but the bike handles slower: it slides across lanes slower and steps up gears slower.
   */
  bags: { bonus: [1, 1.3, 1.6], lane: [1, 0.8, 0.65], gearCd: [1, 1.35, 1.7] },
  /** Lanes per second the bike slides across, and the vehicles. */
  laneRate: 7, carLaneRate: 2.2,
  /** The bike's length (m) and how much lane overlap counts as a hit (lanes). */
  riderLen: 1.8, hitW: 0.62,
  /** The traffic's speed (m/s): always slower than the bike's slowest gear. */
  vTraffic: 3,
  /** Crash phases (s): the fall, lying there, lifting the bike, getting back on. */
  crash: { fall: 0.45, lie: 0.35, lift: 0.6, mount: 0.4 },
  /** Seconds after getting back on in which nothing can hit the rider (it blinks). */
  safe: 1.0,
  /** Traffic is made this far ahead and dropped this far behind (m); none near the shop at either end. */
  ahead: 90, behind: 25, clearStart: 30, clearEnd: 35,
  /**
   * The reach guard. `view`: metres of road every screen shows ahead of the rider (ui.ts sizes the
   * scene from it, view + 1 m for the edge, zooming out on a short scene such as the floor job's; a page test checks
   * the phones and the floor job's frame). `react` and `tap`: a skilled player's
   * reaction to a new row and the gap between two taps, from the human model (tests/sim/human.js PROFILES.skilled:
   * react, 1 / stream; a test keeps them equal). `margin`: the stretch on the shortest gap. `minGap`: the shortest clear
   * road between two rows.
   */
  reach: { view: 43, react: 0.6, tap: 1 / 11, margin: 1.08, minGap: 3 },
  /**
   * The rocket's gamble: a bag dropped after riding at least `share` of its leg (from the shop or the last
   * drop) at the top gear without a crash in that leg pays its tip x `tip` (the referee's dropOff). A crash costs the
   * time, the speed and that bag's rocket tip.
   */
  rocket: { share: 0.5, tip: 2 },
  kinds: KIND_LEN,
  /** The first drop sits at this share of the one-order road; the rest follow `extra` m apart. */
  lead: 0.5,
  /** Lab orders go cold after the time to their drop at gear `pace`, plus `slack` s. */
  lab: { pace: 2, slack: 5 },
  /** A queued run starts this long after the rider is back at the shop (s). */
  homeT: 2.5,
  tiers: [1, 2, 3, 4, 5, 6, 7, 8].map(tierRow),
  /** Free play: the difficulty's tier. */
  diffTier: DIFF_TIER,
};
export const TOP = TUNE.gears.length - 1;
export const DT = 1 / 120;
export const CRASH_T = TUNE.crash.fall + TUNE.crash.lie + TUNE.crash.lift + TUNE.crash.mount;

export type DeliverSt = 'idle' | 'ride' | 'crash' | 'home';
export interface Car {
  id: number; k: CarKind; len: number;
  /** Lane it is in (or leaving), lane it is going to, and its drawn lane position (float). */
  lane: number; to: number; x: number;
  y: number;
  /** Blinker seconds left before it moves to `to`; dec: its lane change has started (or it has none). */
  tele: number; dec: boolean;
  /** The lane it will change to when it comes into view (-1: it keeps its lane). Set when its row is made. */
  plan: number;
  /** Paint variant (looks only). */
  col: number;
}
export interface Order {
  gid: number; no: number;
  /** Seconds until cold (counts down through the run; <= 0: cold). */
  left: number; left0: number;
  /** Where its drop building stands (m from the shop). */
  y: number;
  done: boolean; cold: boolean;
  /** Dropped on the rocket (TUNE.rocket: at least `share` of its leg at the top gear, no crash in it): tip x TUNE.rocket.tip. */
  fast: boolean;
  /** Run time it was dropped at. */
  doneAt: number;
}
export interface Run {
  /** Road length: the rider is back at the shop at pos >= len. */
  len: number;
  /** Run time so far (s), crashes so far. */
  t: number; crashes: number;
  orders: Order[];
  /** The current leg (from the shop or the last drop): where it started, and metres of it ridden at the top gear. */
  legFrom: number; legTop: number;
  /** Crashes before this leg began: a crash in the leg loses its rocket tip. */
  legCr: number;
}
export interface Summary { secs: number; crashes: number; orders: { gid: number; no: number; cold: boolean; left: number; fast: boolean }[] }
export interface QOrder { gid: number; no: number; left: number }
/** A sound or a screen effect the screen plays once (it remembers the last id it played). */
export interface Cue { id: number; k: 'go' | 'gear' | 'rocket' | 'lane' | 'crash' | 'up' | 'drop' | 'cold' | 'back' }
export interface DeliverState {
  v: 1; tier: number; selfFeed: boolean;
  st: DeliverSt;
  /** The run on the road (null when none has started yet, or after cancel). Kept after `back` for the summary. */
  run: Run | null;
  /** Runs sent while riding: each starts after the one before is back. */
  queue: QOrder[][];
  /** Rider: metres from the shop, target lane, drawn lane position, gear, gear cooldown. */
  pos: number; lane: number; x: number; gear: number; gearCd: number;
  /** Crash clock (0..CRASH_T while st = crash), the side the rider fell to, blink time after getting back on. */
  crashT: number; side: number; safeT: number;
  /**
   * Traffic: the vehicles, the rear edge of the last row made (m), the lanes a rider can be in as that row goes by (the
   * lanes no steady vehicle of it holds: the next row is made reachable from each), and the vehicle counter.
   */
  cars: Car[]; rowRear: number; rowFrom: number[]; carN: number;
  /** The last run's summary card (set at `back`). */
  last: Summary | null;
  homeT: number; made: number; runs: number;
  /**
   * Fed mode, waiting at the door: the bags this rider could take (the first is the one they picked up) and
   * how many they chose (0: not yet). Set by the `door` event; the run's `run` event clears it.
   */
  door: { bags: QOrder[]; want: number } | null;
  clock: number; acc: number; idleFor: number; cueN: number; cues: Cue[];
}
export type DeliverCmd = { t: 'lane'; d: -1 | 1 } | { t: 'gear' } | { t: 'start'; n: number } | { t: 'load'; n: number };
export type DeliverResult =
  | { kind: 'dropped'; at: number; gid: number; cold: boolean; fast: boolean }
  | { kind: 'crash'; at: number }
  | { kind: 'back'; at: number; secs: number; crashes: number }
  /** Fed mode: the rider chose to take n bags from the door (the referee claims them; the run starts when all are theirs). */
  | { kind: 'load'; at: number; n: number };
export interface DeliverConfig extends ShiftConfig { tier?: number; selfFeed?: boolean }

export const clamp = (v: number, a: number, b: number): number => v < a ? a : v > b ? b : v;
export const tierOf = (s: DeliverState): TierTune => TUNE.tiers[clamp(Math.round(s.tier), 1, 8) - 1] ?? tierRow(4);
export const speedOf = (s: DeliverState): number => s.st === 'ride' ? TUNE.gears[clamp(s.gear, 0, TOP)] ?? 0 : 0;
export const riding = (s: DeliverState): boolean => s.st === 'ride' || s.st === 'crash';
/** Bags on the road now (1 when none: the handling of an empty bike). */
export const bagsOf = (s: DeliverState): number => clamp(s.run && riding(s) ? s.run.orders.length : 1, 1, 3);
const bagK = (a: readonly number[], n: number): number => a[clamp(n, 1, 3) - 1] ?? 1;
/** Tip multiplier for a run of n bags. */
export const bagBonus = (n: number): number => bagK(TUNE.bags.bonus, n);
/** Tip multiplier for a bag dropped on the rocket (Order.fast). */
export const rocketBonus = (fast: boolean): number => fast ? TUNE.rocket.tip : 1;
/** Road length and drop positions for n orders on tier t. */
export function roadFor(t: TierTune, n: number): { len: number; drops: number[] } {
  const lead = t.base * TUNE.lead;
  return { len: t.base + (n - 1) * t.extra, drops: Array.from({ length: n }, (_, i) => lead + i * t.extra) };
}
/** Does a vehicle cover lane L (in it, sliding through it, or about to move into it)? */
export const covers = (c: Car, L: number): boolean => Math.abs(c.x - L) < 0.9 || c.lane === L || c.to === L;

function cue(s: DeliverState, k: Cue['k']): void { s.cues.push({ id: ++s.cueN, k }); if (s.cues.length > 16) s.cues.shift(); }

export function init(cfg: DeliverConfig): DeliverState {
  const tier = clamp(Math.round(cfg.tier ?? TUNE.diffTier[cfg.difficulty]), 1, 8);
  return {
    v: 1, tier, selfFeed: cfg.selfFeed ?? true, st: 'idle', run: null, queue: [],
    pos: 0, lane: 1, x: 1, gear: 0, gearCd: 0, crashT: 0, side: 1, safeT: 0,
    cars: [], rowRear: TUNE.clearStart, rowFrom: [0, 1, 2], carN: 0, last: null, homeT: 0, made: 0, runs: 0, door: null,
    clock: 0, acc: 0, idleFor: 0, cueN: 0, cues: [],
  };
}

/** Starts a run with these orders: the one going cold first is dropped first. */
function startRun(s: DeliverState, qs: readonly QOrder[]): void {
  const sorted = qs.map((q, i) => ({ q, i })).sort((a, b) => a.q.left - b.q.left || a.i - b.i).map(x => x.q);
  const { len, drops } = roadFor(tierOf(s), sorted.length);
  s.run = { len, t: 0, crashes: 0, orders: sorted.map((q, i) => ({ gid: q.gid, no: q.no, left: q.left, left0: q.left, y: drops[i] ?? len / 2, done: false, cold: false, fast: false, doneAt: 0 })), legFrom: 0, legTop: 0, legCr: 0 };
  s.st = 'ride'; s.pos = 0; s.lane = 1; s.x = 1; s.gear = 0; s.gearCd = 0; s.crashT = 0; s.safeT = 0;
  s.cars = []; s.rowRear = TUNE.clearStart; s.rowFrom = [0, 1, 2]; s.homeT = 0; s.runs++; s.door = null;
  cue(s, 'go');
}
/** Lab orders: made-up numbers, each going cold after the ride to its drop at gear TUNE.lab.pace plus some slack. */
function labOrders(s: DeliverState, n: number, ctx: StationCtx): QOrder[] {
  const { drops } = roadFor(tierOf(s), n), v = TUNE.gears[TUNE.lab.pace] ?? 11, nos: number[] = [];
  return drops.map(y => {
    let no = 1 + Math.floor(ctx.rng.next() * 98);
    while (nos.includes(no)) no = no % 99 + 1;
    nos.push(no);
    return { gid: ++s.made, no, left: Math.ceil(y / v) + TUNE.lab.slack };
  });
}

/* ---------- traffic: rows, each reachable from the one before ---------- */
/** Seconds the bike takes to slide one lane with n bags. */
export const slideT = (bags: number): number => 1 / (TUNE.laneRate * bagK(TUNE.bags.lane, bags));
/** The closing speed at the top gear (m/s): the fastest the traffic comes at the rider. */
export const closeTop = (): number => (TUNE.gears[TOP] ?? 0) - TUNE.vTraffic;
/**
 * The shortest clear road (m) between two rows that lets a skilled rider at the top gear with `bags` bags move d lanes
 * between them; Infinity when the screen does not show the next row early enough for it at all. Two limits, both at
 * the top gear's closing speed v (TUNE.reach):
 * - sight: the next row comes into view `view` m ahead; the rider must see it, react and slide d lanes before its
 *   front reaches the bike's front: (view - riderLen / 2) / v >= react + d x slide;
 * - gap: the rider leaves its lane only once the bike is past the row before, and must be in the new lane before the
 *   next row's front: (gap - riderLen) / v >= tap + d x slide (`tap`: the timing slack of a planned tap; a second tap
 *   comes `tap` after the first, inside the first lane's slide, so the slide does not stop). Stretched by `margin`.
 */
export function reachGap(d: number, bags: number): number {
  const R = TUNE.reach, v = closeTop(), slide = d * slideT(bags);
  if (d <= 0) return R.minGap;
  if ((R.view - TUNE.riderLen / 2) / v < R.react + slide) return Infinity;
  return Math.max(R.minGap, (TUNE.riderLen + v * (R.tap + slide)) * R.margin);
}
/**
 * The shortest gap before a row whose open lanes are `free`, for a rider who may be in any of `from`: from each lane
 * the nearest open lane counts, and the worst start decides. Infinity: some start cannot reach any open lane.
 */
export function rowNeed(from: readonly number[], free: readonly number[], bags: number): number {
  let need = TUNE.reach.minGap;
  for (const a of from) need = Math.max(need, Math.min(...free.map(b => reachGap(Math.abs(a - b), bags))));
  return need;
}
const ALL_LANES: readonly number[] = [0, 1, 2];
function kindRoll(t: TierTune, r: number): CarKind { return r < t.busP ? 'bus' : r < t.busP + (1 - t.busP) * 0.45 ? 'minibus' : 'taxi'; }
interface RowPlan { lanes: number[]; plan: number; kinds: CarKind[] }
/** The lanes a row blocks (its vehicles' lanes and the lane a changer moves to) and the lanes no steady vehicle holds. */
function rowLanes(p: RowPlan): { free: number[]; from: number[] } {
  const blocked = new Set([...p.lanes, ...(p.plan >= 0 ? [p.plan] : [])]), steady = p.plan >= 0 ? [] : p.lanes;
  return { free: ALL_LANES.filter(L => !blocked.has(L)), from: ALL_LANES.filter(L => !steady.includes(L)) };
}
function rollRow(t: TierTune, ctx: StationCtx): RowPlan {
  const n = ctx.rng.next() < t.pairP ? 2 : 1, lanes = [0, 1, 2];
  for (let i = lanes.length - 1; i > 0; i--) { const j = Math.floor(ctx.rng.next() * (i + 1)), a = lanes[i] ?? 0; lanes[i] = lanes[j] ?? 0; lanes[j] = a; }
  const take = lanes.slice(0, n), kinds = take.map(() => kindRoll(t, ctx.rng.next()));
  let plan = -1;
  const first = take[0] ?? 1;
  if (n === 1 && ctx.rng.next() < t.chgP) {
    const d = ctx.rng.next() < 0.5 ? -1 : 1, to = first + d >= 0 && first + d < LANES ? first + d : first - d;
    plan = to;
  }
  return { lanes: take, plan, kinds };
}
/**
 * Makes rows ahead of the rider up to TUNE.ahead: each row is rolled (1 or 2 vehicles, maybe a lane changer), re-rolled
 * when the screen could not show it early enough to reach from the row before (a few tries, then a single steady vehicle
 * in a lane no start needs, always reachable since one-lane moves fit the sight limit), and placed after a quick or a
 * breathing gap, stretched to what the move from the row before needs (rowNeed at the top gear and the run's bags).
 */
function spawn(s: DeliverState, run: Run, ctx: StationCtx): void {
  const t = tierOf(s), bags = bagsOf(s);
  while (s.rowRear < s.pos + TUNE.ahead) {
    const roll = ctx.rng.next() < t.quickP ? t.qMin + ctx.rng.next() * (t.qMax - t.qMin) : t.bMin + ctx.rng.next() * (t.bMax - t.bMin);
    let p = rollRow(t, ctx), need = rowNeed(s.rowFrom, rowLanes(p).free, bags);
    for (let k = 0; k < 6 && !Number.isFinite(need); k++) { p = rollRow(t, ctx); need = rowNeed(s.rowFrom, rowLanes(p).free, bags); }
    if (!Number.isFinite(need)) {
      const L = ALL_LANES.find(x => !s.rowFrom.includes(x)) ?? 1;
      p = { lanes: [L], plan: -1, kinds: ['taxi'] }; need = rowNeed(s.rowFrom, rowLanes(p).free, bags);
    }
    const front = s.rowRear + Math.max(roll, need);
    if (front > run.len - TUNE.clearEnd) { s.rowRear = 1e9; return; }   // the road home is clear: no more rows (JSON-safe, not Infinity)
    let rear = front;
    p.lanes.forEach((lane, i) => {
      const k = p.kinds[i] ?? 'taxi', len = TUNE.kinds[k].len, col = Math.floor(ctx.rng.next() * 4);
      s.cars.push({ id: ++s.carN, k, len, lane, to: lane, x: lane, y: front + len / 2, tele: 0, dec: p.plan < 0, plan: p.plan, col });
      rear = Math.max(rear, front + len);
    });
    s.rowRear = rear; s.rowFrom = rowLanes(p).from;
  }
}
function moveCars(s: DeliverState, dt: number): void {
  const t = tierOf(s), see = s.pos + TUNE.reach.view;
  s.rowRear += TUNE.vTraffic * dt;
  for (const c of s.cars) {
    c.y += TUNE.vTraffic * dt;
    if (c.to !== c.lane) {
      if (c.tele > 0) c.tele = Math.max(0, c.tele - dt);
      else {
        const dir = Math.sign(c.to - c.x), nx = c.x + dir * TUNE.carLaneRate * dt;
        if ((dir > 0 && nx >= c.to) || (dir < 0 && nx <= c.to) || dir === 0) { c.x = c.to; c.lane = c.to; } else c.x = nx;
      }
    } else if (!c.dec && c.y - c.len / 2 <= see) {
      // a lane changer starts blinking as it comes into view: its row was made with both lanes blocked
      c.dec = true;
      if (c.plan >= 0 && c.plan < LANES && c.plan !== c.lane) { c.to = c.plan; c.tele = t.tele; }
    }
  }
  s.cars = s.cars.filter(c => c.y > s.pos - TUNE.behind);
}

/* ---------- the ride ---------- */
/** Metres of free road ahead in each lane (-1: a vehicle is beside the rider in that lane). */
export function clearance(s: DeliverState): number[] {
  const front = s.pos + TUNE.riderLen / 2, back = s.pos - TUNE.riderLen / 2;
  return Array.from({ length: LANES }, (_, L) => {
    let best = 1e9;
    for (const c of s.cars) {
      if (!covers(c, L) || c.y + c.len / 2 < back) continue;
      const d = c.y - c.len / 2 - front;
      best = Math.min(best, d < 0 ? -1 : d);
    }
    return best;
  });
}
/** The lane with the most open road, the nearer one on a tie. */
function openLane(s: DeliverState): number {
  const clr = clearance(s);
  let best = s.lane;
  for (let L = 0; L < LANES; L++) {
    const a = clr[L] ?? -1, b = clr[best] ?? -1;
    if (a > b + 0.5 || (Math.abs(a - b) <= 0.5 && Math.abs(L - s.x) < Math.abs(best - s.x))) best = L;
  }
  return best;
}
function slide(s: DeliverState, dt: number): void {
  if (s.x === s.lane) return;
  const dir = Math.sign(s.lane - s.x), nx = s.x + dir * TUNE.laneRate * bagK(TUNE.bags.lane, bagsOf(s)) * dt;
  s.x = (dir > 0 ? nx >= s.lane : nx <= s.lane) ? s.lane : nx;
}
function crash(s: DeliverState, run: Run, c: Car, ctx: StationCtx, out: DeliverResult[]): void {
  s.st = 'crash'; s.crashT = 0; s.gear = 0; s.gearCd = 0;
  s.side = c.x > s.x ? -1 : c.x < s.x ? 1 : s.x <= 1 ? 1 : -1;
  s.pos = Math.min(s.pos, c.y - c.len / 2 - TUNE.riderLen / 2 - 0.3);
  s.lane = clamp(Math.round(s.x), 0, LANES - 1); s.x = s.lane;
  run.crashes++;
  cue(s, 'crash');
  out.push({ kind: 'crash', at: ctx.t });
}
function sub(s: DeliverState, dt: number, ctx: StationCtx, out: DeliverResult[]): void {
  const run = s.run;
  if (s.st === 'home') {
    if (s.queue.length) { s.homeT += dt; if (s.homeT >= TUNE.homeT) { const q = s.queue.shift(); if (q) startRun(s, q); } }
    return;
  }
  if (!run || !riding(s)) return;
  run.t += dt;
  for (const o of run.orders) if (!o.done) o.left -= dt;
  if (s.gearCd > 0) s.gearCd = Math.max(0, s.gearCd - dt);
  if (s.safeT > 0) s.safeT = Math.max(0, s.safeT - dt);
  moveCars(s, dt);
  if (s.st === 'crash') {
    const c = TUNE.crash, liftEnd = c.fall + c.lie + c.lift, was = s.crashT;
    s.crashT += dt;
    // the bike is up: the rider walks it to the lane with the most open road (never back into a pocket behind a car
    // with another beside it), and slides across while getting on
    if (was < liftEnd && s.crashT >= liftEnd) s.lane = openLane(s);
    if (s.crashT >= liftEnd) slide(s, dt);
    if (s.crashT >= CRASH_T) { s.st = 'ride'; s.crashT = 0; s.safeT = TUNE.safe; s.x = s.lane; cue(s, 'up'); }
    return;
  }
  // slide toward the target lane, roll forward at the gear's speed
  slide(s, dt);
  const step = speedOf(s) * dt;
  s.pos += step;
  if (s.gear === TOP) run.legTop += step;
  spawn(s, run, ctx);
  if (s.safeT <= 0) {
    for (const c of s.cars) {
      if (Math.abs(c.x - s.x) < TUNE.hitW && Math.abs(c.y - s.pos) < (c.len + TUNE.riderLen) / 2) { crash(s, run, c, ctx, out); return; }
    }
  }
  for (const o of run.orders) {
    if (o.done || s.pos < o.y) continue;
    o.done = true; o.cold = o.left <= 0; o.doneAt = run.t;
    o.fast = run.legTop >= TUNE.rocket.share * (o.y - run.legFrom) && run.crashes === run.legCr;
    run.legFrom = o.y; run.legTop = 0; run.legCr = run.crashes;
    cue(s, o.cold ? 'cold' : 'drop');
    out.push({ kind: 'dropped', at: ctx.t, gid: o.gid, cold: o.cold, fast: o.fast });
  }
  if (s.pos >= run.len) {
    s.st = 'home'; s.gear = 0; s.cars = []; s.homeT = 0; s.pos = run.len;
    s.last = { secs: run.t, crashes: run.crashes, orders: run.orders.map(o => ({ gid: o.gid, no: o.no, cold: o.cold, left: o.left, fast: o.fast })) };
    cue(s, 'back');
    out.push({ kind: 'back', at: ctx.t, secs: run.t, crashes: run.crashes });
  }
}

/* ---------- the StationModule ---------- */
function command(s: DeliverState, cmd: DeliverCmd, ctx: StationCtx): DeliverResult[] {
  if (cmd.t === 'lane') {
    if (s.st !== 'ride' || Math.abs(cmd.d) !== 1) return [];
    const L = clamp(s.lane + cmd.d, 0, LANES - 1);
    if (L !== s.lane) { s.lane = L; cue(s, 'lane'); }
    return [];
  }
  if (cmd.t === 'gear') {
    if (s.st !== 'ride' || s.gearCd > 0 || s.gear >= TOP) return [];
    s.gear++; s.gearCd = TUNE.gearCd * bagK(TUNE.bags.gearCd, bagsOf(s));
    cue(s, s.gear === TOP ? 'rocket' : 'gear');
    return [];
  }
  if (cmd.t === 'load') {
    // fed mode, at the door: the choice goes to the referee; the screen shows it until the run starts
    const d = s.door;
    if (s.selfFeed || riding(s) || !d || d.want > 0 || !Number.isInteger(cmd.n) || cmd.n < 1 || cmd.n > Math.min(3, d.bags.length)) return [];
    d.want = cmd.n;
    return [{ kind: 'load', at: ctx.t, n: cmd.n }];
  }
  // lab mode only: a run with n made-up orders, from the shop
  if (!s.selfFeed || riding(s) || !Number.isInteger(cmd.n) || cmd.n < 1 || cmd.n > 3) return [];
  startRun(s, labOrders(s, cmd.n, ctx));
  return [];
}
function step(s: DeliverState, dt: number, ctx: StationCtx): DeliverResult[] {
  const out: DeliverResult[] = [];
  if (!(dt > 0)) return out;
  s.acc += dt; s.clock += dt;
  s.idleFor = riding(s) || s.queue.length ? 0 : s.idleFor + dt;
  while (s.acc >= DT) { sub(s, DT, ctx, out); s.acc -= DT; }
  return out;
}
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isQOrder = (x: unknown): x is QOrder => isObj(x) && num(x.gid) && num(x.no) && num(x.left);
function onEvent(s: DeliverState, ev: RefEvent): void {
  if (ev.kind === 'cancel') {
    s.st = 'idle'; s.run = null; s.queue = []; s.cars = []; s.gear = 0; s.gearCd = 0; s.crashT = 0; s.safeT = 0; s.pos = 0; s.lane = 1; s.x = 1; s.homeT = 0; s.door = null;
    return;
  }
  if (ev.kind === 'door') {
    // the bags at the door this rider may take (empty or not an array: off the door); a choice already made stays
    if (!Array.isArray(ev.bags) || riding(s)) { s.door = null; return; }
    const bags = ev.bags.filter(isQOrder).slice(0, 3).map(q => ({ gid: q.gid, no: q.no, left: q.left }));
    if (!bags.length) { s.door = null; return; }
    const want = typeof ev.want === 'number' && Number.isInteger(ev.want) ? clamp(ev.want, 0, bags.length) : s.door ? Math.min(s.door.want, bags.length) : 0;
    s.door = { bags, want };
    return;
  }
  if (ev.kind !== 'run' || !Array.isArray(ev.orders)) return;
  const qs = ev.orders.filter(isQOrder).slice(0, 3).map(q => ({ gid: q.gid, no: q.no, left: q.left }));
  if (!qs.length) return;
  if (riding(s)) s.queue.push(qs); else startRun(s, qs);
}
function status(s: DeliverState): StationStatus {
  const waiting = riding(s) || s.queue.length ? 1 : 0;
  return { waiting, idleFor: s.idleFor, load: waiting };
}
const ST: readonly string[] = ['idle', 'ride', 'crash', 'home'];
const KINDS: readonly string[] = ['taxi', 'minibus', 'bus'];
const isCar = (c: unknown): boolean => isObj(c) && num(c.id) && typeof c.k === 'string' && KINDS.includes(c.k) && num(c.len) && num(c.lane) && num(c.to) && num(c.x) && num(c.y) && num(c.tele) && typeof c.dec === 'boolean' && num(c.plan);
const isOrder = (o: unknown): boolean => isObj(o) && num(o.gid) && num(o.no) && num(o.left) && num(o.left0) && num(o.y) && typeof o.done === 'boolean' && typeof o.cold === 'boolean' && typeof o.fast === 'boolean';
function validate(x: unknown): x is DeliverState {
  if (!isObj(x) || x.v !== 1 || !num(x.tier) || typeof x.selfFeed !== 'boolean' || typeof x.st !== 'string' || !ST.includes(x.st)) return false;
  for (const k of ['pos', 'lane', 'x', 'gear', 'gearCd', 'crashT', 'side', 'safeT', 'rowRear', 'carN', 'homeT', 'made', 'runs', 'clock', 'acc', 'idleFor', 'cueN']) if (!num(x[k])) return false;
  if (!Array.isArray(x.rowFrom) || !x.rowFrom.every(L => Number.isInteger(L) && L >= 0 && L < LANES)) return false;
  if (!Array.isArray(x.cars) || !x.cars.every(isCar) || !Array.isArray(x.cues) || !Array.isArray(x.queue) || !x.queue.every(q => Array.isArray(q) && q.every(isQOrder))) return false;
  if (typeof x.gear !== 'number' || x.gear < 0 || x.gear > TOP || typeof x.lane !== 'number' || x.lane < 0 || x.lane >= LANES) return false;
  const r = x.run;
  if (r !== null && !(isObj(r) && num(r.len) && num(r.t) && num(r.crashes) && num(r.legFrom) && num(r.legTop) && num(r.legCr) && Array.isArray(r.orders) && r.orders.every(isOrder))) return false;
  if ((x.st === 'ride' || x.st === 'crash') && r === null) return false;
  const d = x.door;
  if (d !== null && !(isObj(d) && Array.isArray(d.bags) && d.bags.every(isQOrder) && num(d.want))) return false;
  return x.last === null || isObj(x.last);
}
export const deliverBotModule: BotModule<DeliverState, DeliverCmd> = { next: (s, ctx) => deliverBot(s, ctx) };
export const deliver: StationModule<DeliverState, DeliverCmd, DeliverResult> = {
  kind: 'deliver', init, command, step, onEvent, status, bot: deliverBotModule, validate,
};
