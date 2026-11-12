// What the new seats' own work does to the shift's score: 傳菜, 洗碗, 燒味 and
// 外賣 feed 連擊 and 少出錯 from their own results, as the shop's four do (a right job good(), a wrong one a mistake that
// breaks the combo), and a walk-out counts against the seat that caused it. Counted only while a player drives the seat
// (xMe: here or a teammate), never the computer, as the four count only under me().
import { liveG } from '../state';
import { CORE_HOOK } from '../hooks';
import { xMe } from './extras';
import { tallyMiss } from '../coop/tally';   // a party round's mistakes per person

/**
 * The roast counter's quality for a dish done right: the station's two-star line (stations-next/roast/core.ts
 * TUNE.stars[1]; tests/sim/seat-score.test.js keeps them equal). Below it the customer pays less and it is a mistake.
 */
export const ROAST_GOOD_Q = 70;
/** A takeaway bag handed over with fewer stars than this (wrong item, missing extras, a spill, a slow tie, late: one
 *  star each, stations-next/takeaway/core.ts judge) went out wrong. */
export const BAG_GOOD_STARS = 2;

/** A job the seat got right: 連擊 +1 (and its tip), as a right order, plate, cup or bill does at the four. */
export function seatGood(k: ExtraKind): void { if (xMe(k)) CORE_HOOK.good(); }
/** A job the seat got wrong: one mistake (少出錯), the combo broken at once (in the room's referee no page notices it). */
export function seatMiss(k: ExtraKind, n = 1): void {
  if (!xMe(k) || n <= 0) return;
  liveG().mistakes += n; tallyMiss(k, n); CORE_HOOK.breakCombo();
}
/** A customer the seat lost (冇人嬲走): one walk-out, the combo broken. */
export function seatAngry(k: ExtraKind): void {
  if (!xMe(k)) return;
  liveG().angry++; CORE_HOOK.breakCombo();
}
/** A slip that is neither a mistake nor a walk-out at the shop (a piece lost to the sink's pile): the combo breaks. */
export function seatBreak(k: ExtraKind): void { if (xMe(k)) CORE_HOOK.breakCombo(); }
/** Money the seat's own work booked (the roast counter's dish, a bag's worth plus its tip): G.seatRev. */
export function seatTake(k: ExtraKind, n: number): void {
  if (!xMe(k) || !(n > 0)) return;
  const r = liveG().seatRev ??= {};
  r[k] = Math.round(((r[k] ?? 0) + n) * 10) / 10;
}
/** Dishes the 傳菜 seat put on their tables hot (G.runHot): its own measure, never the shop's takings, which
 *  include the computer's 外賣 and 燒味 sales. */
export function seatHot(n: number): void {
  if (!xMe('runner') || !(n > 0)) return;
  const S = liveG(); S.runHot = (S.runHot ?? 0) + n;
}

/** Seconds a bag stood ready at the bell before it counts as a customer the 外賣 seat lost (收工仲未交嘅單). */
export const BAG_LATE = 60;
/**
 * The bell (endShift): takeaway bags that stood ready for BAG_LATE seconds and were never handed over are walk-outs of
 * the 外賣 seat. Without it a seat that packs nothing loses no one in a 3-minute shift: an order's patience
 * (150 s and up) outlasts it.
 */
export function seatsClose(): void {
  const S = liveG();
  for (const g of S.groups) if (g.take && g.via === 'pack' && g.readyAt !== undefined && S.t - g.readyAt >= BAG_LATE) seatAngry('takeaway');
}
