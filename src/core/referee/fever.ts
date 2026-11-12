// The shift's one fever (旺場): a scheduled event, not a combo reward. Once per shift, CFG.fever.sec
// long, placed whole inside the middle half of the shift; its heat (0..1) follows CFG.fever.curve: a slow, casual start,
// a climax, a short wind-down. Heat scales how close together customers come (spawnGap) and the tips (good). Every
// function here reads only G.t and G.feverAt (shared state), so the referee and every phone agree on the heat.
import { CFG } from '../data/menus';
import type { Rng } from '../rng';

/** When the fever starts (game s), one draw from the shift's stream: the fever lies whole in [from, to] of the shift
 *  (a shift too short for that, the 試食 bites, gets it in the middle). */
export function feverStart(r: Rng): number {
  const F = CFG.fever, x = r(), lo = CFG.gameSec * F.from, hi = CFG.gameSec * F.to - F.sec;
  return hi >= lo ? lo + (hi - lo) * x : Math.max(0, (CFG.gameSec - F.sec) / 2);
}
/** The curve's own length (its last point), stretched to CFG.fever.sec when that is tuned. */
const curveLen = (): number => CFG.fever.curve[CFG.fever.curve.length - 1]?.[0] ?? CFG.fever.sec;
/** Seconds into the fever at game time t, on CFG.fever.sec's scale; null outside it or with no fever (the tutorial). */
export function feverClock(at: number | null | undefined, t: number): number | null {
  if (at === null || at === undefined || t < at || t >= at + CFG.fever.sec) return null;
  return t - at;
}
/** The heat x seconds into the fever: the curve's points joined by straight lines. */
export function heatAt(x: number): number {
  const c = CFG.fever.curve, s = curveLen() / CFG.fever.sec, u = x * s;
  for (let i = 1; i < c.length; i++){
    const a = c[i - 1], b = c[i];
    if (a && b && u <= b[0]) return b[0] > a[0] ? a[1] + (b[1] - a[1]) * (u - a[0]) / (b[0] - a[0]) : b[1];
  }
  return 0;
}
/** The heat at game time t (0 outside the fever). */
export function feverHeat(at: number | null | undefined, t: number): number {
  const x = feverClock(at, t);
  return x === null ? 0 : heatAt(x);
}
/** Customers' gap multiplier at time t: 1 outside, CFG.fever.gap at full heat. */
export const feverGapMul = (S: GameState, t: number): number => 1 + (CFG.fever.gap - 1) * feverHeat(S.feverAt, t);
/** Tip multiplier now: 1 outside, CFG.fever.tip at full heat. */
export const feverTipMul = (S: GameState): number => 1 + (CFG.fever.tip - 1) * feverHeat(S.feverAt, S.t);
/** The climax, in seconds into the fever: the first and last points at full heat. */
export function feverPeak(): [number, number] {
  const s = CFG.fever.sec / curveLen(), full = CFG.fever.curve.filter(p => p[1] >= 1).map(p => p[0] * s);
  return [Math.min(...full), Math.max(...full)];
}
