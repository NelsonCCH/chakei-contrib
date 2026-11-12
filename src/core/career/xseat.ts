// Solo at an extra seat: one player plays 傳菜 runner, 燒味 roast or 外賣 takeaway for a whole
// shift, the computer covers the shop's four stations. It is a room of one without the room (a room of one is
// the way to play an extra seat alone, minus the network): this phone becomes the referee with a send that goes
// nowhere, the extra station is on (G.extra), and the player drives its seat. The station runs through its plugin
// (core/coop/plugins/<kind>.ts, stepped by coopStep) and its screen is the seat view (ui/seat.ts), exactly as in co-op.
import { liveG, bump, curLevel } from '../state';
import { levelRoles, isFloorTask } from '../work/roles';
import { floorLevel } from '../work/floor';
import { workSpecFor } from '../work/spec';
import { PORT } from '../env';
import { refStart, setDriver, referee } from '../coop/referee';
import { SOLO_ORDER } from './solo';

/** This phone's player id in a solo seat shift (the referee's own seat). */
export const SOLO_ME = 'me';

/**
 * Starts the solo seat shift on the shift just made (after newGame / careerStart): the four shop stations go to the
 * computer, `kind` (and any other `extras`) is switched on, and the player sits at `kind`. `now`: the page clock in ms.
 */
export function soloSeatStart(kind: ExtraKind, now: number, extras: readonly ExtraKind[] = [kind]): void {
  const S = liveG();
  for (const st of SOLO_ORDER) S.roles[st] = 'ai';
  // the computer does not work the tea pot: a shift that was made for the bar opens with a full pot (as handOver does)
  if (S.phase === 'prep'){ S.phase = 'open'; S.pot = { level: PORT.potCap(), st: 'ready', until: 0, pulls: 0 }; }
  S.xseat = kind;
  // the level's own stations run too, the computer at each but this one
  const list = [...new Set([kind, ...extras, ...(S.tut ? [] : levelRoles(curLevel()))])];
  // a 樓面 level's 傳菜 / 外賣 are the floor's tasks: the computer has the floor seats
  const nFloor = !S.tut && !isFloorTask(kind) && floorLevel(curLevel()) ? workSpecFor(S.level).floor : 0;
  refStart({ room: 'solo', me: SOLO_ME, name: '我', send: () => {}, seed: 1, round: 1, now, extraSeats: list, floorSeats: nFloor });
  setDriver(kind, { type: 'player', player: SOLO_ME }, 'claim');
  bump();
}
/** A solo seat shift is running on this phone (its referee is the solo one). */
export const soloSeatOn = (): boolean => referee()?.room === 'solo';

/**
 * A level whose `roles` add stations played at one of the shop's four: the shift runs on a referee of one,
 * like a solo seat shift, so the level's extra stations run with the computer at each. Nothing happens on a level
 * without roles (unless 伙記 plays its 樓面 there) or off a level. In a lesson only a 樓面 task's own lesson
 * (S.tutF: 執枱, 送外賣) starts: the floor with one seat, the player's, and no computer cover. Returns whether it started.
 * `at`: where the player is, 'floor' (樓面) or 'shop' (one of the other three); 'off' runs no floor, the old shop with
 * 傳菜 / 外賣 as computer seats (the four's sims, tests/sim/shift.js, keep that meaning; the game never asks for it).
 */
export function soloShopStart(now: number, at: 'floor' | 'shop' | 'off' = 'off'): boolean {
  const S = liveG(), extras = S.tut ? [] : levelRoles(curLevel());
  // 樓面: on a floor level (every main-ladder level) the floor runs whichever seat the player picked, since
  // 傳菜 and 外賣 are its tasks, never seats of their own; solo 樓面 is its first player, the computer
  // has the other floor seats
  const nFloor = S.tut ? (S.tutF ? 1 : 0) : at !== 'off' && floorLevel(curLevel()) ? workSpecFor(S.level).floor : 0;
  if (!extras.length && !nFloor) return false;
  refStart({ room: 'solo', me: SOLO_ME, name: '我', send: () => {}, seed: 1, round: 1, now, extraSeats: extras, floorSeats: nFloor });
  if (nFloor && (at === 'floor' || S.tut)) setDriver('floor1', { type: 'player', player: SOLO_ME }, 'claim');
  bump(); return true;
}
