// One seat list for progress: every progress screen and award (a level's ✓ row,
// 加盟分店, the 圖鑑 gold card, mastery titles, the first-shift bonus, the training count, the daily challenge) counts
// seats from here, never from its own array of the four. tests/sim/seat-score.test.js holds progress code to that.
// Which new seats a level has is the level's `roles` (core/work/roles.ts levelRoles), read here, not listed again.
import { EXTRA_KINDS, isExtraKind } from '../referee/extras';
import { levelRoles, ROLE_INTRO, FLOOR_INTRO, isFloorTask, type FloorLesson } from '../work/roles';
import { must } from '../util';

/** The shop's own four (every level and shop has them), in the order the game has always listed them (STATIONS). */
const SHOP4: readonly StationId[] = ['waiter', 'kitchen', 'bar', 'till'];
export type Seat = StationId | ExtraKind;
/** Every seat a player can hold: the shop's four, then the new seats, in the pickers' order. A function, not a
 *  constant: nothing here reads another module at load time (core modules may be loaded one by one, by name). */
export const seats = (): readonly Seat[] => [...SHOP4, ...EXTRA_KINDS];
export const shopSeat = (s: string): s is StationId => SHOP4.some(x => x === s);
export const isSeat = (s: string): s is Seat => shopSeat(s) || isExtraKind(s);
/**
 * The seats a level's progress counts (its ✓ row, 加盟分店, the 圖鑑 gold card): the shop's four plus every new seat
 * the level has (its `roles`, levelRoles). A level without `roles` counts the four, as before.
 */
export function levelSeats(L: Level | undefined): Seat[] {
  return [...SHOP4, ...levelRoles(L).filter(k => !isFloorTask(k))];   // 傳菜 / 外賣 are 樓面's tasks
}
/** The seats a player can sit at: the four and the roles, never a 樓面 task. */
export const roleSeats = (): readonly Seat[] => seats().filter(s => !isFloorTask(s));

/**
 * A new role reaches the player with the main ladder: its 員工培訓
 * lesson, and its seat once learned, open when the main-ladder level that introduces it (ROLE_INTRO) is open, i.e. a
 * main level just below it, or any above, has a star. A save that already learned the role keeps it (`tutDone`).
 * `mainLevels`: the main ladder's levels, id and number.
 */
export function roleOpen(k: ExtraKind, tutDone: Record<string, unknown> | undefined, levelStars: Record<string, number> | undefined, mainLevels: readonly { id: string; n: number }[]): boolean {
  if (tutDone?.[k]) return true;
  return mainLevels.some(l => l.n >= ROLE_INTRO[k] - 1 && (levelStars?.[l.id] ?? 0) >= 1);
}
/** A 樓面 task's own lesson (執枱, 送外賣) opens as a role's does: learned, or its level (FLOOR_INTRO) reached. */
export function floorLessonOpen(k: FloorLesson, tutDone: Record<string, unknown> | undefined, levelStars: Record<string, number> | undefined, mainLevels: readonly { id: string; n: number }[]): boolean {
  if (tutDone?.[k]) return true;
  return mainLevels.some(l => l.n >= FLOOR_INTRO[k] - 1 && (levelStars?.[l.id] ?? 0) >= 1);
}
/**
 * The new seats a picker offers: on a level, only the stations the level has (its `roles`) that the player has
 * open; off the levels (the own shop, a free-play room), every open one. `open`: roleOpen for this player.
 */
export function seatsOffered(L: Level | undefined | null, open: (k: ExtraKind) => boolean): ExtraKind[] {
  return (L ? levelRoles(L) : EXTRA_KINDS).filter(k => !isFloorTask(k) && open(k));   // never a 樓面 task
}

/**
 * A new seat is open for the daily challenge once the player has learned it (員工培訓) and passed the main-ladder level
 * that introduces it (ROLE_INTRO) with at least one star. `mainLevels`: the main ladder's levels, id and number.
 */
export function dailyOpen(k: ExtraKind, tutDone: Record<string, unknown> | undefined, levelStars: Record<string, number> | undefined, mainLevels: readonly { id: string; n: number }[]): boolean {
  if (!tutDone?.[k]) return false;
  return mainLevels.some(l => l.n === ROLE_INTRO[k] && (levelStars?.[l.id] ?? 0) >= 1);
}
/**
 * The daily challenge's seat from the day's draw `u` (0..1, the same for everybody): one of every seat. A player for whom
 * the drawn new seat is not open yet (dailyOpen) gets one of the shop's four from the same draw instead, so everybody
 * with that seat open plays it, and a fresh save only ever gets the four (lead's call).
 */
export function dailySeat(u: number, open: (k: ExtraKind) => boolean): Seat {
  const all = roleSeats(), i = Math.min(all.length - 1, Math.floor(u * all.length)), s = must(all[i], 'daily seat');
  return shopSeat(s) || open(s) ? s : must(SHOP4[i % SHOP4.length], 'daily fallback');
}
/** Seats that are gone (洗碗): old daily rows of theirs stay stored but are never on the board. */
export const RETIRED_SEATS: readonly string[] = ['wash'];
/**
 * The daily board ranked per seat (lead's call): takings, one seat's own takings and the sink's points do not
 * compare, so each seat the day was played at has its own list. A row stored without a seat (or an unknown one) counts
 * as `four`, the seat that day's draw gives for the shop's four (dailySeat with nothing open). Each list best first, at
 * most `top`; the lists in seats() order, `first` (the viewer's seat today) ahead of the rest. A row of a retired seat
 * (RETIRED_SEATS) is dropped: its points are not the four's takings (the Worker leaves them out too).
 */
export function boardBySeat<R extends { station: string; revenue: number }>(rows: readonly R[], four: Seat, first: Seat, top = 20): { seat: Seat; rows: R[] }[] {
  const by = new Map<Seat, R[]>();
  for (const r of rows) { if (RETIRED_SEATS.includes(r.station)) continue; const s = isSeat(r.station) ? r.station : four; by.set(s, [...(by.get(s) ?? []), r]); }
  const order = [first, ...seats().filter(s => s !== first)];
  return order.filter(s => by.has(s)).map(s => ({ seat: s, rows: [...(by.get(s) ?? [])].sort((a, b) => b.revenue - a.revenue).slice(0, top) }));
}
