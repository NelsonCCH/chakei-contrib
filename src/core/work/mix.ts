// The order-mix generator: where each free order line goes, so the prep seats (水吧 bar, 廚房 kitchen,
// 燒味 roast) carry the same seconds of work and none becomes the bottleneck. A line goes to the seat furthest behind its
// share once the line is added (stride scheduling over the load table's seconds, core/work/load.ts); seats within
// NEAR of the best are a tie, broken by one draw from the shift's stream, so the mix is not a fixed rotation and the
// same seed always gives the same customers (the room's Durable Object and a solo phone run this same code).
import type { Rng } from '../rng';
import { lineSec, type PrepSeat } from './load';

/** Seconds of prep work booked so far, per prep seat. */
export type PrepAcc = Record<PrepSeat, number>;
/** Target shares of the prep seconds (equal by default); a seat missing or at 0 gets no free lines. */
export type PrepShare = Partial<Record<PrepSeat, number>>;
/** A seat whose score is within this factor of the best is a tie. */
export const NEAR = 1.1;

/**
 * The seat for one free line among `cands`. Always draws exactly one number from `r`, so the stream stays in step
 * whatever the loads are. Returns null when no candidate has a share.
 */
export function pickPrep(acc: PrepAcc, share: PrepShare, cands: readonly PrepSeat[], slot: Slot, r: Rng): PrepSeat | null {
  const u = r();
  const ok = cands.filter(d => (share[d] ?? 0) > 0);
  if (!ok.length) return null;
  const score = (d: PrepSeat): number => (acc[d] + lineSec(d, slot)) / (share[d] ?? 1);
  const best = Math.min(...ok.map(score));
  const tie = ok.filter(d => score(d) <= best * NEAR);
  return tie[Math.min(tie.length - 1, Math.floor(u * tie.length))] ?? null;
}
/** Books a line's seconds on its seat. */
export function bookPrep(acc: PrepAcc, d: PrepSeat, slot: Slot, n = 1): void { acc[d] += n * lineSec(d, slot); }

/** How far (in lines of the food seat) the food seat may run ahead of or behind the bar before a diner's own choice is
 *  overridden. */
export const FOOD_SLACK = 1;
/**
 * Whether a dine-in diner orders food at seat `f`, the bar already booked for them: their own choice (`has`) unless the
 * food seat is more than FOOD_SLACK lines ahead of the bar (then drink only) or behind it (then a dish is added). Every
 * diner orders a drink, so this is the only way the bar and the food seats stay level on dine-in. Draws nothing.
 */
export function wantFood(acc: PrepAcc, share: PrepShare, f: PrepSeat, slot: Slot, has: boolean): boolean {
  const L = lineSec(f, slot), gap = acc[f] / (share[f] ?? 1) - acc.bar / (share.bar ?? 1);
  return has ? gap <= FOOD_SLACK * L : gap < -FOOD_SLACK * L;
}
