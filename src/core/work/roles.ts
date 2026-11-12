// Which stations a shop has, and how hard each is (built
// with the workload model). A level (ui/levels.ts LEVELS) or a party shop declares `roles`: the extra stations
// it has beside the shop's four, each with a tier. A station in `roles` runs whether or not a player sits at it (the
// computer covers it) and its customers are the shop's. The tier is one scale for every role, 1 (just introduced) to
// ROLE_TIER_MAX (修羅場), mapped here onto each station's own knob, so a level says "傳菜 tier 3" and not a maze name.
//
// The ladder (ROLE_INTRO): one new role a main level (傳菜 2, 外賣 3 bagging / 4 with deliveries, 燒味 6; all at
// 7, every one at the top on 修羅場); a role's tier on the main ladder is 1 + (levels since its introduction), level 7
// one more, 修羅場 the maximum (roleTierAt). The bonus groups take one themed role each, its tier counted the same way
// within the group's own order. tests/sim/roles.test.js holds the data to these rules.
import { must } from '../util';

export const ROLE_TIER_MAX = 8;
/**
 * Main-ladder level (LEVELS[id].n) where each role first appears. 外賣 bags from 3 (洗碗 is gone,
 * so its level-3 intro goes to the next role, 外賣, a level earlier than before); deliveries (送外賣) from its tier 2
 * (DELIVER_TIER: level 4). 燒味 stays at 6.
 */
export const ROLE_INTRO: Readonly<Record<ExtraKind, number>> = { runner: 2, takeaway: 3, roast: 6 };
/** The 外賣 tier from which some takeaway orders are delivered (送外賣): main level 4, a bonus group's second 外賣 level. */
export const DELIVER_TIER = 2;
/**
 * 樓面: the floor is 伙記's seat from level 1 (seating and order-taking) and gains its tasks along
 * the ladder. 傳 and 包 join with their roles (ROLE_INTRO runner / takeaway). The two floor-only tasks, each with its own
 * lesson: 執枱 (the clearing mini-game; before it, a dirty table is the old one-tap clean) joins at 中環 with 傳,
 * 送外賣 at level 4 (DELIVER_TIER on the main ladder).
 */
export type FloorLesson = 'clear' | 'deliver';
export const FLOOR_LESSONS: readonly FloorLesson[] = ['clear', 'deliver'];
export const FLOOR_INTRO: Readonly<Record<FloorLesson, number>> = { clear: 2, deliver: 4 };
export const isFloorLesson = (v: unknown): v is FloorLesson => v === 'clear' || v === 'deliver';
/**
 * 傳菜 and 外賣 are 樓面 tasks, not seats: no seat picker, strip or lobby row lists them; a
 * shift that has their stations runs the floor, whose seats take their work (core/coop/referee.ts refStart floorSeats).
 * Their lessons stay (one per task). The other extra kinds are roles of their own.
 */
export const isFloorTask = (k: string): boolean => k === 'runner' || k === 'takeaway';
/** Does a shift with these extra stations need the floor (any of them a floor task)? */
export const needsFloor = (extra: readonly string[]): boolean => extra.some(isFloorTask);
/** The 傳菜 floor plan for each tier (runner maze.ts tiers; 'first' is the simplest). */
export const RUNNER_FLOOR = ['first', 'first', 'rookie', 'rookie', 'pro', 'pro', 'ace', 'ace'] as const;
/** The 燒味 cutting tier (TUNE.cut 0..3: pieces, snap, guides) for each tier. */
export const ROAST_CUT: readonly number[] = [0, 0, 1, 1, 2, 2, 3, 3];
/** The 外賣 knot tier (knot library 1..10) for each tier. */
export const KNOT_TIER: readonly number[] = [2, 3, 4, 5, 6, 7, 8, 10];

const clampTier = (t: number): number => Math.min(ROLE_TIER_MAX, Math.max(1, Math.round(t)));
/** Index into a per-tier table. */
export const byTier = <T>(table: readonly T[], tier: number): T => must(table[clampTier(tier) - 1], 'tier ' + String(tier));

/** A role's tier on main-ladder level `n` (1..7), or null when the role has not been introduced there. */
export function roleTierAt(kind: ExtraKind, n: number): number | null {
  const i = ROLE_INTRO[kind];
  if (n < i) return null;
  return clampTier(n <= 6 ? 1 + n - i : 2 + 6 - i);
}
/** The extra stations a level has, in a fixed order (absent `roles`: none, the shop's four only). */
export function levelRoles(L: { roles?: Partial<Record<ExtraKind, number>> } | undefined | null): ExtraKind[] {
  const r = L?.roles; if (!r) return [];
  return (['runner', 'roast', 'takeaway'] as const).filter(k => (r[k] ?? 0) > 0);
}
/** A level's tier for a role (null: the level does not have it). */
export const levelTier = (L: { roles?: Partial<Record<ExtraKind, number>> } | undefined | null, k: ExtraKind): number | null => L?.roles?.[k] ?? null;
