// The third star as a skill measure. The player's own station keeps
// one running average a shift; the third star asks for it to be under (or, at the kitchen, the dishes over) a line.
// Observation only: nothing in the rules reads these fields, so a comparison of rule states can leave them out.
// The new seats (傳菜, 洗碗, 燒味, 外賣) have their own measure, timed where their own hands decide it.
import { liveG, me } from '../state';
import { isExtraKind, xMe } from './extras';

export type SpeedStation = StationId | ExtraKind;
/** What each station's number means (the end card and the goal text show it). */
export const SPEED_WHAT: Record<SpeedStation, string> = {
  waiter: '坐低到落單', bar: '落單到出飲品', kitchen: '落單到出碟', till: '每張單收錢',
  runner: '每碟上枱', roast: '落單到斬好上碟', takeaway: '齊貨到交袋',
};

/**
 * The third star's lines: seconds on average, lower is better, except the kitchen in free play, which counts dishes
 * plated (its ticket time is mostly queue and does not separate a fluent cook from a slow one there). The waiter,
 * bar and till lines are where the sim's human "mid" profile passes about 65% of shifts (free play
 * 熟手 own shop, levels pooled at their own pace); a first-timer rarely passes, a skilled player nearly always. The
 * kitchen lines are set by hand: the sim's kitchen bot cooks one meal at a time and cannot measure them.
 * Free play measured at its pace (熟手 gap 2.2): waiter 16 -> 14.5 s, bar 33 -> 25 s, till kept.
 * The new seats' lines, the same way (scripts/xseat-calibrate.mjs: the mid profile alone at the seat, its 65th
 * percentile, levels pooled / own shop 熟手 lunch). 傳菜's time is mostly its floor's length, so it has a line per floor
 * plan instead (RUNNER_STAR3); the runner entries here are only the fallback before its station is set up.
 * All re-measured the same way (16 seeds) with the levels' stations on, the cutting and the
 * 外賣 hand; the kitchen kept as above. The new seats again (32 seeds); 傳菜 is now 每碟上枱, the trip's seconds
 * per dish carried, and on a level each new seat reads its own level's line (STAR3_LEVEL), these are the fallback.
 */
export const STAR3: Record<'free' | 'level', Record<SpeedStation, number>> = {
  free: { waiter: 14, bar: 27, kitchen: 27, till: 9.5, runner: 8, roast: 22, takeaway: 21 },
  level: { waiter: 14, bar: 25.5, kitchen: 29, till: 9, runner: 11.5, roast: 25.5, takeaway: 24.5 },
};
/**
 * 傳菜's line per floor plan in free play (stations-next/runner/maze.ts tiers), 每碟上枱 seconds: the mid
 * profile's 65th percentile on that floor, at least the station's bot at full pace there (its slowest shift). The sims'
 * every profile drives the tray with that bot, so they cannot tell a fluent hand from a slow one here; a fuller tray is
 * fewer seconds a dish, so carrying more a trip helps the star (the old per-table time punished it).
 */
export const RUNNER_STAR3: Record<string, number> = { first: 6.5, rookie: 8, pro: 11.5, ace: 11 };   // xseat-calibrate, 32 seeds
/**
 * The new seats' third-star lines per level, seconds: pooled lines were out of a mid player's reach on the busy
 * levels (外賣 43 s on 年廿八 against 24.5) and free on the quiet ones. Each is the mid profile's 65th percentile on that
 * level (scripts/xseat-calibrate.mjs, 32 seeds, rounded up to the half second); 傳菜's at least the station's bot at full
 * pace on that level (its slowest shift), since the sims drive the tray with that bot at every profile and cannot tell
 * the two hands apart there. Free play keeps STAR3.free (傳菜: RUNNER_STAR3 per floor).
 */
export const STAR3_LEVEL: Record<string, Record<ExtraKind, number>> = {
  estate: { runner: 5, roast: 19, takeaway: 22.5 },
  central: { runner: 6.5, roast: 26, takeaway: 24.5 },
  mongkok: { runner: 5.5, roast: 24, takeaway: 16 },
  airport: { runner: 7.5, roast: 27, takeaway: 21.5 },
  typhoon: { runner: 7.5, roast: 30, takeaway: 21 },
  newyear: { runner: 11, roast: 26.5, takeaway: 44.5 },
  latenight: { runner: 10, roast: 32, takeaway: 43.5 },
  bingsutt: { runner: 11.5, roast: 21, takeaway: 22 },
  village: { runner: 7.5, roast: 21.5, takeaway: 22.5 },
  silver: { runner: 9, roast: 22.5, takeaway: 21 },
  kwc: { runner: 10.5, roast: 22.5, takeaway: 23.5 },
  milktea: { runner: 10, roast: 25.5, takeaway: 32.5 },
  fastmilk: { runner: 5, roast: 22, takeaway: 22.5 },
  hangwan: { runner: 9, roast: 22, takeaway: 21 },
  sixties: { runner: 8, roast: 23, takeaway: 21.5 },
  daipaidong: { runner: 9.5, roast: 22.5, takeaway: 20.5 },
  halloween: { runner: 10.5, roast: 31, takeaway: 23 },
  hell: { runner: 11, roast: 39, takeaway: 33.5 },
};
let runnerFloor: () => string | null = () => null;
/** The runner plugin says which floor plan this shift's tray runs on (core/coop/plugins/runner.ts). */
export function setRunnerFloor(f: () => string | null): void { runnerFloor = f; }

/** A player (here or a teammate) drives the seat: the four through G.roles as me() reads them, a new seat as xMe(). */
const drives = (st: SpeedStation): boolean => isExtraKind(st) ? xMe(st) : me(st);

/**
 * One finished job at `st`, `sec` after it started (core/coop/results.ts, where the referee applies the station's result).
 * Counted only while a player drives the station, never the computer: on the referee that is its own
 * player's seat or a teammate's (G.roles 'me' / 'remote'), on a teammate's phone its own seat (the prediction the next
 * keyframe confirms). G.spd is shared, so every phone sees the referee's count; a seat that changes hands keeps one count.
 */
export function noteSpeed(st: SpeedStation, sec: number, n = 1): void {
  const S = liveG();
  if (!drives(st)) return;
  const a = (S.spd ??= {})[st] ??= [0, 0];
  a[0] += n; a[1] += Math.max(0, sec);   // n jobs in `sec` (傳菜 counts the dishes one leg of its trip carried)
}

export interface SpeedGoal {
  st: SpeedStation; kind: 'avg' | 'count';
  /** The line: seconds (avg) or dishes (count). */
  need: number;
  /** The shift's number so far: average seconds (null before the first job) or dishes plated. */
  have: number | null;
  ok: boolean;
}
/** The third-star measure of station `st` this shift (`level`: the level lines). */
export function speedGoal(st: SpeedStation, level: boolean): SpeedGoal {
  const S = liveG(), fl = st === 'runner' ? runnerFloor() : null;
  // a new seat on a level: that level's own line; else 傳菜's floor line in free play, else the pooled one
  const own = level && isExtraKind(st) && S.level ? STAR3_LEVEL[S.level]?.[st] : undefined;
  const need = own ?? (!level && fl !== null ? RUNNER_STAR3[fl] : undefined) ?? STAR3[level ? 'level' : 'free'][st];
  if (st === 'kitchen' && !level) return { st, kind: 'count', need, have: S.dishes, ok: S.dishes >= need };
  const a = S.spd?.[st], have = a && a[0] ? a[1] / a[0] : null;
  return { st, kind: 'avg', need, have, ok: have !== null && have <= need };
}
/** Every seat has a speed measure (the new seats too). */
export const isSpeedStation = (st: string): st is SpeedStation => st === 'waiter' || st === 'bar' || st === 'kitchen' || st === 'till' || isExtraKind(st);
