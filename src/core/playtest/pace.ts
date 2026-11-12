// The playtest pace sliders: one value 1..10 per station that scales that station's
// whole pace on top of today's setting (the difficulty or the level). PACE_BASE (5) is today's setting exactly: every
// factor below is exactly 1 there and every station-own knob keeps the station's own value, so a shift that nobody
// touched plays as before. The panel that moves them (src/playtest/) exists only on the preview Worker.
//
// What each slider scales:
// - the shop's customer flow (spawn gap): the slider of flowStation(), the station this phone's player sits at;
// - patience, each where that station's customers wait: 落單/伙記 the queue and the order, 水吧 drinks, 廚房 food (and
//   how soon the stove burns), 收銀 paying, 燒味 斬料 walk-ins, 外賣 takeaway orders (both also their arrival rate);
// - the station's own knobs (core/playtest/knobs-*.ts): 傳菜 the floor plan's tier, 洗碗 / 燒味 their difficulty tier, 外賣 its
//   knot tier.
import { liveG } from '../state';

export type PaceStation = 'waiter' | 'bar' | 'kitchen' | 'till' | 'runner' | 'roast' | 'takeaway';
export const PACE_STATIONS: readonly PaceStation[] = ['waiter', 'bar', 'kitchen', 'till', 'runner', 'roast', 'takeaway'];
export const PACE_NAMES: Readonly<Record<PaceStation, string>> = {
  waiter: '落單/伙記', bar: '水吧', kitchen: '廚房', till: '收銀', runner: '傳菜', roast: '燒味', takeaway: '外賣',
};
export const isPaceStation = (x: unknown): x is PaceStation => PACE_STATIONS.some(s => s === x);
export const PACE_MIN = 1, PACE_MAX = 10, PACE_BASE = 5;
/** Each step of the slider makes the station this much faster (customers come this much closer, wait this much less). */
export const PACE_STEP = 1.15;

const pace: Record<PaceStation, number> = { waiter: 5, bar: 5, kitchen: 5, till: 5, runner: 5, roast: 5, takeaway: 5 };
export const paceOf = (st: PaceStation): number => pace[st];
export const paceAll = (): Readonly<Record<PaceStation, number>> => ({ ...pace });
export const clampPace = (v: number): number => Math.min(PACE_MAX, Math.max(PACE_MIN, Math.round(v)));
let moved = false;
/** Sets one slider; returns the value it had. */
export function setPace(st: PaceStation, v: number): number { const was = pace[st]; pace[st] = clampPace(v); if (pace[st] !== PACE_BASE) moved = true; return was; }
export function resetPace(): void { for (const s of PACE_STATIONS) pace[s] = PACE_BASE; }
/** Some slider has left PACE_BASE since the page loaded (until then the station-own knobs are never touched). */
export const paceEverMoved = (): boolean => moved;
export const paceTouched = (): boolean => PACE_STATIONS.some(s => pace[s] !== PACE_BASE);

/** Speed factor of value v: 1 at PACE_BASE, x1.15 a step (1: 0.57, i.e. 1.75 times as slow; 10: 2.01 times as fast). */
export const paceK = (v: number): number => v === PACE_BASE ? 1 : Math.pow(PACE_STEP, v - PACE_BASE);
/** Multiplier for a gap between arrivals at station `st` (a bigger slider: shorter gaps). Exactly 1 at PACE_BASE. */
export const gapMul = (st: PaceStation): number => pace[st] === PACE_BASE ? 1 : 1 / paceK(pace[st]);
/** Multiplier for a patience at station `st` (a bigger slider: customers give up sooner). Exactly 1 at PACE_BASE. */
export const patMul = (st: PaceStation): number => pace[st] === PACE_BASE ? 1 : 1 / paceK(pace[st]);

/** Tier steps from value v: 1-2 two easier, 3-4 one easier, 5-6 today's, 7-8 one harder, 9-10 two harder. */
export const tierShift = (v: number): number => v <= 2 ? -2 : v <= 4 ? -1 : v <= 6 ? 0 : v <= 8 ? 1 : 2;
/** The tier `tierShift(v)` steps from `base` in `tiers` (easiest first), held at the ends. */
export function shiftTier<T>(tiers: readonly T[], base: T, v: number): T {
  const i = tiers.indexOf(base); if (i < 0) return base;
  return tiers[Math.min(tiers.length - 1, Math.max(0, i + tierShift(v)))] ?? base;
}

/**
 * The station whose slider sets the shop's customer flow: the seat this phone's player holds (solo: the one station
 * played; co-op: the host's own seat, the referee's phone being the one that spawns customers), else the waiter.
 */
export function flowStation(): PaceStation {
  const r = liveG().roles;
  return PACE_STATIONS.find(s => r[s] === 'me') ?? 'waiter';
}
/** The customer-flow multiplier of the shift running now (spawnGap). */
export const flowGapMul = (): number => gapMul(flowStation());
